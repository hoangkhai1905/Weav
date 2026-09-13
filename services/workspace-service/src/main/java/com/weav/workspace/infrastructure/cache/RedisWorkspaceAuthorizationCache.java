package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public final class RedisWorkspaceAuthorizationCache implements WorkspaceAuthorizationCache {

    private static final Logger log = LoggerFactory.getLogger(RedisWorkspaceAuthorizationCache.class);
    private static final String KEY_PREFIX = "workspace:authz:";
    private static final String GENERATION_KEY_PREFIX = "workspace:authz-generation:";
    private static final RedisScript<Long> PUT_IF_GENERATION_MATCHES = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end "
                    + "redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3]) "
                    + "return 1",
            Long.class);
    private static final RedisScript<Long> EVICT_AND_ROTATE_GENERATION = new DefaultRedisScript<>(
            "redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2]) "
                    + "redis.call('del', KEYS[2]) "
                    + "return 1",
            Long.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Duration generationTtl;

    public RedisWorkspaceAuthorizationCache(
            StringRedisTemplate redis,
            ObjectMapper objectMapper) {
        this(redis, objectMapper, Duration.ofMinutes(5));
    }

    public RedisWorkspaceAuthorizationCache(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            Duration generationTtl) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        if (generationTtl == null || generationTtl.isZero() || generationTtl.isNegative()) {
            throw new IllegalArgumentException("authorization cache generation ttl must be positive");
        }
        this.generationTtl = generationTtl;
    }

    @Override
    public Optional<WorkspaceAccessSnapshot> get(UUID workspaceId, UUID userId) {
        String payloadKey = key(workspaceId, userId);
        try {
            String payload = redis.opsForValue().get(payloadKey);
            if (payload == null) {
                return Optional.empty();
            }
            String generation = redis.opsForValue().get(generationKey(workspaceId, userId));
            if (generation == null) {
                return Optional.empty();
            }
            JsonNode tree = objectMapper.readTree(payload);
            if (!hasValidShape(tree)) {
                log.warn("Workspace authorization cache payload rejected for workspaceId={} userId={}",
                        workspaceId, userId);
                return Optional.empty();
            }
            CachePayload cached = objectMapper.readValue(payload, CachePayload.class);
            if (!generation.equals(cached.generation())) {
                return Optional.empty();
            }
            WorkspaceAccessSnapshot snapshot = cached.snapshot();
            if (!workspaceId.equals(snapshot.workspaceId())
                    || !userId.equals(snapshot.userId())
                    || !snapshot.hasValidAuthorizationSchema()) {
                log.warn("Workspace authorization cache entry rejected for workspaceId={} userId={}",
                        workspaceId, userId);
                return Optional.empty();
            }
            return Optional.of(snapshot);
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache read failed for workspaceId={} userId={}",
                    workspaceId, userId);
            return Optional.empty();
        }
    }

    @Override
    public Optional<String> readGeneration(UUID workspaceId, UUID userId, Duration ttl) {
        requirePositiveTtl(ttl);
        String generationKey = generationKey(workspaceId, userId);
        try {
            String current = redis.opsForValue().get(generationKey);
            if (current != null && !current.isBlank()) {
                return Optional.of(current);
            }

            String candidate = UUID.randomUUID().toString();
            Boolean created = redis.opsForValue().setIfAbsent(generationKey, candidate, ttl);
            if (Boolean.TRUE.equals(created)) {
                return Optional.of(candidate);
            }
            current = redis.opsForValue().get(generationKey);
            return current == null || current.isBlank()
                    ? Optional.empty()
                    : Optional.of(current);
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache generation read failed for workspaceId={} userId={}",
                    workspaceId, userId);
            return Optional.empty();
        }
    }

    @Override
    public void put(WorkspaceAccessSnapshot snapshot, Duration ttl) {
        requirePositiveTtl(ttl);
        readGeneration(snapshot.workspaceId(), snapshot.userId(), ttl)
                .ifPresent(generation -> putIfGenerationMatches(snapshot, ttl, generation));
    }

    @Override
    public boolean putIfGenerationMatches(
            WorkspaceAccessSnapshot snapshot,
            Duration ttl,
            String expectedGeneration) {
        requirePositiveTtl(ttl);
        if (snapshot == null || expectedGeneration == null || expectedGeneration.isBlank()) {
            return false;
        }
        try {
            String payload = objectMapper.writeValueAsString(new CachePayload(
                    snapshot.workspaceId(),
                    snapshot.userId(),
                    snapshot.role(),
                    snapshot.capabilities(),
                    expectedGeneration));
            Long result = redis.execute(
                    PUT_IF_GENERATION_MATCHES,
                    List.of(generationKey(snapshot.workspaceId(), snapshot.userId()),
                            key(snapshot.workspaceId(), snapshot.userId())),
                    expectedGeneration,
                    payload,
                    Long.toString(ttl.toMillis()));
            return Long.valueOf(1L).equals(result);
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache write failed for workspaceId={} userId={}",
                    snapshot.workspaceId(), snapshot.userId());
            return false;
        }
    }

    @Override
    public void evict(UUID workspaceId, UUID userId) {
        try {
            redis.execute(
                    EVICT_AND_ROTATE_GENERATION,
                    List.of(generationKey(workspaceId, userId), key(workspaceId, userId)),
                    UUID.randomUUID().toString(),
                    Long.toString(generationTtl.toMillis()));
        } catch (RuntimeException exception) {
            log.warn("Workspace authorization cache eviction failed for workspaceId={} userId={}",
                    workspaceId, userId);
        }
    }

    private void requirePositiveTtl(Duration ttl) {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("authorization cache ttl must be positive");
        }
    }

    private String key(UUID workspaceId, UUID userId) {
        return KEY_PREFIX + workspaceId + ":" + userId;
    }

    private String generationKey(UUID workspaceId, UUID userId) {
        return GENERATION_KEY_PREFIX + workspaceId + ":" + userId;
    }

    private boolean hasValidShape(JsonNode tree) {
        if (tree == null || !tree.isObject()) {
            return false;
        }
        JsonNode workspaceId = tree.get("workspaceId");
        JsonNode userId = tree.get("userId");
        JsonNode role = tree.get("role");
        JsonNode capabilities = tree.get("capabilities");
        JsonNode generation = tree.get("generation");
        if (workspaceId == null || !workspaceId.isTextual()
                || userId == null || !userId.isTextual()
                || role == null || !role.isTextual()
                || capabilities == null || !capabilities.isArray()
                || generation == null || !generation.isTextual()
                || generation.asText().isBlank()) {
            return false;
        }
        Set<String> capabilityNames = new HashSet<>();
        for (JsonNode capability : capabilities) {
            if (capability == null || !capability.isTextual()
                    || !capabilityNames.add(capability.asText())) {
                return false;
            }
        }
        return true;
    }

    private record CachePayload(
            UUID workspaceId,
            UUID userId,
            MembershipRole role,
            Set<WorkspaceCapability> capabilities,
            String generation) {

        private WorkspaceAccessSnapshot snapshot() {
            return new WorkspaceAccessSnapshot(workspaceId, userId, role, capabilities);
        }
    }
}
