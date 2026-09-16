package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class RedisWorkspaceAuthorizationCacheIntegrationTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final Duration TEST_TTL = Duration.ofMinutes(5);
    private static final String GENERATION = "generation-1";
    private static final String VALID_MEMBER_CAPABILITIES =
            "[\"WORKSPACE_VIEW\",\"MEMBER_VIEW\",\"WORKFLOW_CREATE\","
                    + "\"WORKFLOW_EDIT\",\"WORKFLOW_RUN\",\"WORKFLOW_MONITOR\","
                    + "\"WORKFLOW_PUBLISH\"]";

    @Autowired
    private RedisWorkspaceAuthorizationCache cache;

    @Autowired
    private StringRedisTemplate redis;

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
    }

    @BeforeEach
    void clearRedis() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
    }

    @Test
    void putGetRoundTripPreservesCapabilitiesAndEvictRemovesOnlyRequestedSnapshot() {
        WorkspaceAccessSnapshot snapshot = memberSnapshot();

        cache.put(snapshot, TEST_TTL);

        assertEquals(Optional.of(snapshot), cache.get(WORKSPACE, USER));
        cache.evict(WORKSPACE, USER);
        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void ttlExpiresAuthorizationSnapshot() throws Exception {
        cache.put(memberSnapshot(), Duration.ofMillis(200));
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (System.nanoTime() < deadline && cache.get(WORKSPACE, USER).isPresent()) {
            Thread.sleep(50);
        }

        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void malformedJsonWithValidGenerationBecomesCacheMiss() {
        setGeneration(GENERATION);
        setPayload("not-json");
        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void mismatchedSubjectIdsWithValidGenerationBecomeCacheMisses() {
        setGeneration(GENERATION);
        setPayload(UUID.randomUUID(), USER, VALID_MEMBER_CAPABILITIES, GENERATION);
        assertTrue(cache.get(WORKSPACE, USER).isEmpty());

        setPayload(WORKSPACE, UUID.randomUUID(), VALID_MEMBER_CAPABILITIES, GENERATION);
        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void duplicateCapabilitiesWithValidGenerationBecomeCacheMiss() {
        setGeneration(GENERATION);
        setPayload(WORKSPACE, USER,
                "[\"WORKSPACE_VIEW\",\"MEMBER_VIEW\",\"WORKFLOW_CREATE\","
                        + "\"WORKFLOW_EDIT\",\"WORKFLOW_RUN\",\"WORKFLOW_MONITOR\","
                        + "\"WORKFLOW_PUBLISH\",\"WORKSPACE_VIEW\"]",
                GENERATION);

        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void invalidAuthorizationCapabilitiesWithValidGenerationBecomeCacheMiss() {
        setGeneration(GENERATION);
        setPayload(WORKSPACE, USER, "[\"WORKSPACE_VIEW\"]", GENERATION);

        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void unknownFutureCapabilityIsIgnoredByTolerantCacheReader() {
        setGeneration(GENERATION);
        setPayload(WORKSPACE, USER,
                "[\"WORKSPACE_VIEW\",\"MEMBER_VIEW\",\"WORKFLOW_CREATE\","
                        + "\"WORKFLOW_EDIT\",\"WORKFLOW_RUN\",\"WORKFLOW_MONITOR\","
                        + "\"WORKFLOW_PUBLISH\",\"WORKFLOW_FUTURE\"]",
                GENERATION);

        WorkspaceAccessSnapshot snapshot = cache.get(WORKSPACE, USER).orElseThrow();

        assertTrue(snapshot.capabilities().contains(WorkspaceCapability.WORKFLOW_PUBLISH));
    }

    @Test
    void missingGenerationBecomesCacheMissEvenForValidPayload() {
        setPayload(WORKSPACE, USER, VALID_MEMBER_CAPABILITIES, GENERATION);

        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void mismatchedGenerationBecomesCacheMissEvenForValidPayload() {
        setGeneration("generation-2");
        setPayload(WORKSPACE, USER, VALID_MEMBER_CAPABILITIES, GENERATION);

        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
    }

    @Test
    void rotatedGenerationFencesOutOldSnapshot() {
        WorkspaceAccessSnapshot snapshot = memberSnapshot();
        cache.put(snapshot, TEST_TTL);
        String generationKey = generationKey();
        String oldGeneration = redis.opsForValue().get(generationKey);

        redis.opsForValue().set(generationKey, "rotated-generation", TEST_TTL);

        assertTrue(oldGeneration != null && !oldGeneration.isBlank());
        assertTrue(cache.get(WORKSPACE, USER).isEmpty());
        assertFalse(cache.putIfGenerationMatches(snapshot, TEST_TTL, oldGeneration));
    }

    private void setGeneration(String generation) {
        redis.opsForValue().set(generationKey(), generation, TEST_TTL);
    }

    private void setPayload(UUID workspaceId, UUID userId, String capabilities, String generation) {
        setPayload(payloadJson(workspaceId, userId, capabilities, generation));
    }

    private void setPayload(String payload) {
        redis.opsForValue().set(payloadKey(), payload, TEST_TTL);
    }

    private String payloadJson(UUID workspaceId, UUID userId, String capabilities, String generation) {
        return "{\"workspaceId\":\"" + workspaceId
                + "\",\"userId\":\"" + userId
                + "\",\"role\":\"MEMBER\",\"capabilities\":" + capabilities
                + ",\"generation\":\"" + generation + "\"}";
    }

    private String payloadKey() {
        return "workspace:authz:" + WORKSPACE + ":" + USER;
    }

    private String generationKey() {
        return "workspace:authz-generation:" + WORKSPACE + ":" + USER;
    }

    private WorkspaceAccessSnapshot memberSnapshot() {
        Membership membership = Membership.member(WORKSPACE, USER, true, false);
        return new WorkspaceAccessSnapshot(
                WORKSPACE,
                USER,
                MembershipRole.MEMBER,
                new WorkspaceAuthorizationPolicy().resolve(membership));
    }
}
