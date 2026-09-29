package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/** Redis-backed one-time state with atomic consume and no process-local fallback. */
public final class RedisOAuthStateStore implements OAuthStateStore {

    private static final String KEY_PREFIX = "workspace:oauth-state:";
    private static final String ORIGIN_PREFIX = "workspace:oauth-notification-origin:";
    private static final String ACTIVE_ORIGIN_PREFIX = "workspace:oauth-active-origin:";
    private static final Pattern STATE_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final RedisScript<String> SAVE_START = new DefaultRedisScript<>(
            "local keyType = redis.call('TYPE', KEYS[3]).ok; "
                    + "if keyType ~= 'none' and keyType ~= 'zset' then "
                    + "return redis.error_reply('active origin index has wrong type'); end; "
                    + "local time = redis.call('TIME'); "
                    + "local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000); "
                    + "redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now); "
                    + "local active = ARGV[6] == '1' or redis.call('ZCARD', KEYS[3]) > 0; "
                    + "local metadata = 'v1;NON_ACTIVE;' .. ARGV[2] .. ';' .. ARGV[3]; "
                    + "if active then "
                    + "metadata = 'v1;ACTIVE;' .. ARGV[2] .. ';' .. ARGV[3] .. ';' .. ARGV[4]; "
                    + "redis.call('ZADD', KEYS[3], now + tonumber(ARGV[5]), ARGV[4]); "
                    + "local latest = redis.call('ZREVRANGE', KEYS[3], 0, 0, 'WITHSCORES'); "
                    + "redis.call('PEXPIRE', KEYS[3], math.max(1, math.ceil(tonumber(latest[2]) - now))); "
                    + "elseif redis.call('ZCARD', KEYS[3]) == 0 then redis.call('DEL', KEYS[3]); end; "
                    + "redis.call('PSETEX', KEYS[1], ARGV[5], ARGV[1]); "
                    + "redis.call('PSETEX', KEYS[2], ARGV[5], metadata); "
                    + "return 'OK'",
            String.class);
    private static final RedisScript<String> CONSUME_WITH_METADATA = new DefaultRedisScript<>(
            "local value = redis.call('GET', KEYS[1]); "
                    + "if not value then return nil; end; "
                    + "local metadata = redis.call('GET', KEYS[2]); "
                    + "redis.call('DEL', KEYS[1], KEYS[2]); "
                    + "return value .. '\\n' .. (metadata or '')",
            String.class);
    private static final RedisScript<Long> RELEASE_ORIGIN = new DefaultRedisScript<>(
            "local keyType = redis.call('TYPE', KEYS[1]).ok; "
                    + "if keyType ~= 'zset' then return 0; end; "
                    + "local removed = redis.call('ZREM', KEYS[1], ARGV[1]); "
                    + "if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]); end; "
                    + "return removed",
            Long.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Duration ttl;

    public RedisOAuthStateStore(StringRedisTemplate redis, ObjectMapper objectMapper, Duration ttl) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.ttl = Objects.requireNonNull(ttl, "ttl must not be null");
        if (ttl.compareTo(Duration.ofSeconds(1)) < 0 || ttl.compareTo(Duration.ofHours(1)) > 0) {
            throw new IllegalArgumentException("OAuth state TTL must be between one second and one hour");
        }
    }

    @Override
    public void save(String state, OAuthPendingState pendingState) {
        Objects.requireNonNull(pendingState, "pendingState must not be null");
        if (!isValidState(state)) {
            throw new IllegalArgumentException("OAuth state is invalid");
        }
        try {
            String payload = objectMapper.writeValueAsString(pendingState);
            redis.opsForValue().set(key(state), payload, ttl);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public void saveForStart(String state, OAuthPendingState pendingState, boolean activeAtLockedStart) {
        Objects.requireNonNull(pendingState, "pendingState must not be null");
        if (!isValidState(state)) {
            throw new IllegalArgumentException("OAuth state is invalid");
        }
        try {
            String payload = objectMapper.writeValueAsString(pendingState);
            String originReference = UUID.randomUUID().toString();
            String result = redis.execute(
                    SAVE_START,
                    List.of(key(state), originKey(state), activeOriginKey(pendingState)),
                    payload,
                    pendingState.workspaceId().toString(),
                    pendingState.connectionId().toString(),
                    originReference,
                    Long.toString(ttl.toMillis()),
                    activeAtLockedStart ? "1" : "0");
            if (!"OK".equals(result)) {
                throw new DependencyUnavailableException();
            }
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public Optional<ConsumedState> consumeForCallback(String state) {
        if (!isValidState(state)) {
            return Optional.empty();
        }
        final String result;
        try {
            result = redis.execute(CONSUME_WITH_METADATA, List.of(key(state), originKey(state)));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
        if (result == null) {
            return Optional.empty();
        }
        int separator = result.indexOf('\n');
        if (separator < 0 || separator > 4096 || result.length() - separator - 1 > 256) {
            return Optional.empty();
        }
        String payload = result.substring(0, separator);
        String metadata = result.substring(separator + 1);
        if (payload.isBlank()) {
            return Optional.empty();
        }
        try {
            OAuthPendingState pendingState = objectMapper.readerFor(OAuthPendingState.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readValue(payload);
            if (pendingState == null) {
                return Optional.empty();
            }
            Origin origin = parseOrigin(metadata, pendingState);
            return Optional.of(new ConsumedState(
                    pendingState, origin.notificationOrigin(), origin.reference()));
        } catch (RuntimeException exception) {
            // The state was already consumed. A malformed cache value is never retried or trusted.
            return Optional.empty();
        }
    }

    @Override
    public void releaseOrigin(ConsumedState consumedState) {
        Objects.requireNonNull(consumedState, "consumedState must not be null");
        if (consumedState.notificationOrigin() != NotificationOrigin.ACTIVE) {
            return;
        }
        try {
            redis.execute(
                    RELEASE_ORIGIN,
                    List.of(activeOriginKey(consumedState.pendingState())),
                    consumedState.originReference());
        } catch (RuntimeException ignored) {
            // A callback result must not be masked by lease cleanup. The index expires by TTL.
        }
    }

    private Origin parseOrigin(String metadata, OAuthPendingState pendingState) {
        if (metadata == null || metadata.isBlank() || metadata.length() > 256) {
            return Origin.UNKNOWN;
        }
        String[] fields = metadata.split(";", -1);
        if (fields.length < 4 || !"v1".equals(fields[0])
                || !pendingState.workspaceId().toString().equals(fields[2])
                || !pendingState.connectionId().toString().equals(fields[3])) {
            return Origin.UNKNOWN;
        }
        if ("NON_ACTIVE".equals(fields[1]) && fields.length == 4) {
            return Origin.NON_ACTIVE;
        }
        if ("ACTIVE".equals(fields[1]) && fields.length == 5 && UUID_SHAPE.matcher(fields[4]).matches()) {
            try {
                UUID reference = UUID.fromString(fields[4]);
                return new Origin(NotificationOrigin.ACTIVE, reference.toString());
            } catch (IllegalArgumentException ignored) {
                return Origin.UNKNOWN;
            }
        }
        return Origin.UNKNOWN;
    }

    private String key(String state) {
        return KEY_PREFIX + state;
    }

    private String originKey(String state) {
        return ORIGIN_PREFIX + state;
    }

    private String activeOriginKey(OAuthPendingState pendingState) {
        return ACTIVE_ORIGIN_PREFIX + pendingState.workspaceId() + ":" + pendingState.connectionId();
    }

    private record Origin(NotificationOrigin notificationOrigin, String reference) {

        private static final Origin UNKNOWN = new Origin(NotificationOrigin.UNKNOWN, null);
        private static final Origin NON_ACTIVE = new Origin(NotificationOrigin.NON_ACTIVE, null);
    }

    private static boolean isValidState(String state) {
        if (state == null || !STATE_SHAPE.matcher(state).matches()) {
            return false;
        }
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(state);
            return decoded.length == 32
                    && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(state);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
