package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.application.port.out.OAuthCompletionStore;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;

/** Redis-backed single-use pending completions with atomic GET+DEL and no local fallback. */
public final class RedisOAuthCompletionStore implements OAuthCompletionStore {

    private static final String KEY_PREFIX = "workspace:oauth-completion:";
    private static final Pattern ID_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final RedisScript<String> CONSUME = new DefaultRedisScript<>(
            "local value = redis.call('GET', KEYS[1]); "
                    + "if not value then return nil; end; "
                    + "redis.call('DEL', KEYS[1]); "
                    + "return value",
            String.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Duration ttl;

    public RedisOAuthCompletionStore(StringRedisTemplate redis, ObjectMapper objectMapper, Duration ttl) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.ttl = Objects.requireNonNull(ttl, "ttl must not be null");
    }

    @Override
    public void save(String completionId, PendingCompletion completion) {
        Objects.requireNonNull(completion, "completion must not be null");
        if (!isValidId(completionId)) {
            throw new IllegalArgumentException("OAuth completion id is invalid");
        }
        try {
            redis.opsForValue().set(KEY_PREFIX + completionId, objectMapper.writeValueAsString(completion), ttl);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public Optional<PendingCompletion> consume(String completionId) {
        if (!isValidId(completionId)) {
            return Optional.empty();
        }
        final String payload;
        try {
            payload = redis.execute(CONSUME, List.of(KEY_PREFIX + completionId));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
        if (payload == null || payload.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.ofNullable(objectMapper.readerFor(PendingCompletion.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readValue(payload));
        } catch (RuntimeException exception) {
            // Already consumed; a malformed value is never retried or trusted.
            return Optional.empty();
        }
    }

    private static boolean isValidId(String id) {
        return id != null && ID_SHAPE.matcher(id).matches();
    }
}
