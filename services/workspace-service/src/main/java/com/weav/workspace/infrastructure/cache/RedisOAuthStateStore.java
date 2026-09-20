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
import java.util.regex.Pattern;

/** Redis-backed one-time state with atomic consume and no process-local fallback. */
public final class RedisOAuthStateStore implements OAuthStateStore {

    private static final String KEY_PREFIX = "workspace:oauth-state:";
    private static final Pattern STATE_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final RedisScript<String> GET_AND_DELETE = new DefaultRedisScript<>(
            "local value = redis.call('GET', KEYS[1]); "
                    + "if value then redis.call('DEL', KEYS[1]); end; return value",
            String.class);

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
    public Optional<OAuthPendingState> consume(String state) {
        if (!isValidState(state)) {
            return Optional.empty();
        }
        final String payload;
        try {
            payload = redis.execute(GET_AND_DELETE, List.of(key(state)));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
        if (payload == null || payload.isBlank() || payload.length() > 4096) {
            return Optional.empty();
        }
        try {
            OAuthPendingState pendingState = objectMapper.readerFor(OAuthPendingState.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readValue(payload);
            return Optional.ofNullable(pendingState);
        } catch (RuntimeException exception) {
            // The state was already consumed. A malformed cache value is never retried or trusted.
            return Optional.empty();
        }
    }

    private String key(String state) {
        return KEY_PREFIX + state;
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
