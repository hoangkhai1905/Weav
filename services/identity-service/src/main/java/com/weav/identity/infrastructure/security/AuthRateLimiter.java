package com.weav.identity.infrastructure.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;

@Component
public final class AuthRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(AuthRateLimiter.class);
    private static final String KEY_PREFIX = "identity:ratelimit:";

    // Fixed window: first hit sets the TTL; returns {count, remaining ttl in ms}.
    private static final DefaultRedisScript<List> HIT_SCRIPT = new DefaultRedisScript<>("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
              redis.call('PEXPIRE', KEYS[1], ARGV[1])
            end
            return {count, redis.call('PTTL', KEYS[1])}
            """, List.class);

    // Gives back one reserved unit; never creates the key or goes below zero.
    private static final DefaultRedisScript<Long> REFUND_SCRIPT = new DefaultRedisScript<>("""
            local count = tonumber(redis.call('GET', KEYS[1]) or '0')
            if count > 0 then return redis.call('DECR', KEYS[1]) end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;

    @Autowired
    public AuthRateLimiter(StringRedisTemplate redis) {
        this.redis = Objects.requireNonNull(redis);
    }

    /** Counts this attempt and rejects when the scope's limit for the window is exceeded. */
    public void requireAllowed(Scope scope, String key) {
        throwIfBlocked(attempt(scope, key));
    }

    /** Gives back a unit reserved by {@link #requireAllowed}, e.g. after a successful login. */
    public void refund(Scope scope, String key) {
        try {
            redis.execute(REFUND_SCRIPT, List.of(redisKey(scope, key)));
        } catch (RuntimeException exception) {
            log.warn("Auth rate limiter unavailable for scope {}; refund skipped", scope);
        }
    }

    private static void throwIfBlocked(Decision decision) {
        if (!decision.allowed()) {
            throw new AuthRateLimitExceededException(decision.retryAfterSeconds());
        }
    }

    Decision attempt(Scope scope, String key) {
        List<Long> result;
        try {
            result = redis.execute(HIT_SCRIPT, List.of(redisKey(scope, key)), Long.toString(scope.window().toMillis()));
        } catch (RuntimeException exception) {
            // ponytail: fail-open trades brute-force protection during a Valkey outage for login
            // availability; switch to fail-closed if the threat model changes.
            log.warn("Auth rate limiter unavailable for scope {}; allowing request", scope);
            return Decision.permitted();
        }
        if (result == null || result.size() < 2) {
            return Decision.permitted();
        }
        return result.get(0) <= scope.limit() ? Decision.permitted() : Decision.blocked(ceilSeconds(result.get(1), scope));
    }

    private static String redisKey(Scope scope, String key) {
        Objects.requireNonNull(scope);
        return KEY_PREFIX + scope.name() + ":" + sha256Hex(key == null || key.isBlank() ? "unknown" : key);
    }

    private static long ceilSeconds(long ttlMillis, Scope scope) {
        long millis = ttlMillis > 0 ? ttlMillis : scope.window().toMillis();
        return Math.max(1, (millis + 999) / 1_000);
    }

    private static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    public enum Scope {
        REGISTER_IP(5, Duration.ofMinutes(1)),
        LOGIN_IP(20, Duration.ofMinutes(1)),
        REFRESH_IP(30, Duration.ofMinutes(1)),
        LOGIN_ACCOUNT(10, Duration.ofMinutes(15)),
        OAUTH_START_IP(10, Duration.ofMinutes(15)),
        OAUTH_CALLBACK_IP(20, Duration.ofMinutes(1)),
        OAUTH_EXCHANGE_IP(30, Duration.ofMinutes(1)),
        OAUTH_LINK_START_IP(10, Duration.ofMinutes(15)),
        OAUTH_LINK_START_SESSION(5, Duration.ofMinutes(15)),
        OAUTH_UNLINK_IP(10, Duration.ofMinutes(15)),
        OAUTH_UNLINK_SESSION(5, Duration.ofMinutes(15)),
        OAUTH_CSRF_IP(30, Duration.ofMinutes(1)),
        OAUTH_WEB_REFRESH_IP(30, Duration.ofMinutes(1)),
        OAUTH_WEB_LOGOUT_IP(10, Duration.ofMinutes(15)),
        AVATAR_UPLOAD_USER(10, Duration.ofHours(1));

        private final int limit;
        private final Duration window;

        Scope(int limit, Duration window) {
            this.limit = limit;
            this.window = window;
        }

        int limit() {
            return limit;
        }

        Duration window() {
            return window;
        }
    }

    record Decision(boolean allowed, long retryAfterSeconds) {

        static Decision permitted() {
            return new Decision(true, 0);
        }

        static Decision blocked(long retryAfterSeconds) {
            return new Decision(false, Math.max(1, retryAfterSeconds));
        }
    }
}
