package com.weav.workspace.application.usecase;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.query.MemberListQuery;
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

import java.util.Optional;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MembershipCacheInvalidationIntegrationTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private ResolveWorkspaceAccessUseCase resolveWorkspaceAccessUseCase;

    @Autowired
    private UpdateMemberPermissionsUseCase updateMemberPermissionsUseCase;

    @Autowired
    private RemoveMemberUseCase removeMemberUseCase;

    @Autowired
    private LeaveWorkspaceUseCase leaveWorkspaceUseCase;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private AfterCommitExecutor afterCommitExecutor;

    @Autowired
    private WorkspaceAuthorizationCache authorizationCache;

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
    void permissionUpdateEvictsCommittedSnapshotAndResolverReadsNewCapabilities() {
        Fixture fixture = fixture();

        WorkspaceAccessSnapshot before = resolveWorkspaceAccessUseCase.execute(
                fixture.workspace().getId(), fixture.memberId());
        assertThat(before.capabilities()).doesNotContain(WorkspaceCapability.WORKFLOW_PUBLISH);
        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isTrue();

        updateMemberPermissionsUseCase.execute(new UpdateMemberPermissionsCommand(
                fixture.workspace().getId(),
                fixture.ownerId(),
                fixture.memberId(),
                true,
                false));

        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isFalse();
        WorkspaceAccessSnapshot after = resolveWorkspaceAccessUseCase.execute(
                fixture.workspace().getId(), fixture.memberId());
        assertThat(after.capabilities()).contains(WorkspaceCapability.WORKFLOW_PUBLISH);
    }

    @Test
    void removeEvictsCommittedSnapshotAndResolverDeniesAccess() {
        Fixture fixture = fixture();
        resolveWorkspaceAccessUseCase.execute(fixture.workspace().getId(), fixture.memberId());
        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isTrue();

        removeMemberUseCase.execute(fixture.workspace().getId(), fixture.ownerId(), fixture.memberId());

        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isFalse();
        assertThatThrownBy(() -> resolveWorkspaceAccessUseCase.execute(
                fixture.workspace().getId(), fixture.memberId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(membershipRepository.findByWorkspaceIdAndUserId(
                fixture.workspace().getId(), fixture.memberId())).isEmpty();
    }

    @Test
    void leaveEvictsCommittedSnapshotAndResolverDeniesAccess() {
        Fixture fixture = fixture();
        resolveWorkspaceAccessUseCase.execute(fixture.workspace().getId(), fixture.memberId());
        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isTrue();

        leaveWorkspaceUseCase.execute(fixture.workspace().getId(), fixture.memberId());

        assertThat(redis.hasKey(key(fixture.workspace().getId(), fixture.memberId()))).isFalse();
        assertThatThrownBy(() -> resolveWorkspaceAccessUseCase.execute(
                fixture.workspace().getId(), fixture.memberId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(membershipRepository.findByWorkspaceIdAndUserId(
                fixture.workspace().getId(), fixture.memberId())).isEmpty();
    }

    @Test
    void rollbackDoesNotRunAfterCommitInvalidation() {
        AtomicBoolean ran = new AtomicBoolean();

        assertThatThrownBy(() -> transactionRunner.required(() -> {
            afterCommitExecutor.execute(() -> ran.set(true));
            throw new IllegalStateException("force rollback");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(ran).isFalse();
    }

    @Test
    void cacheEvictionFailureDoesNotRollBackCommittedPermissionMutation() {
        Fixture fixture = fixture();
        WorkspaceAuthorizationCache failingCache = new WorkspaceAuthorizationCache() {
            @Override
            public Optional<WorkspaceAccessSnapshot> get(UUID workspaceId, UUID userId) {
                return Optional.empty();
            }

            @Override
            public Optional<String> readGeneration(
                    UUID workspaceId,
                    UUID userId,
                    java.time.Duration ttl) {
                return Optional.empty();
            }

            @Override
            public void put(WorkspaceAccessSnapshot snapshot, java.time.Duration ttl) {
            }

            @Override
            public boolean putIfGenerationMatches(
                    WorkspaceAccessSnapshot snapshot,
                    java.time.Duration ttl,
                    String expectedGeneration) {
                return false;
            }

            @Override
            public void evict(UUID workspaceId, UUID userId) {
                throw new IllegalStateException("cache unavailable");
            }
        };
        UpdateMemberPermissionsUseCase useCase = new UpdateMemberPermissionsUseCase(
                membershipRepository, transactionRunner, afterCommitExecutor, failingCache);

        useCase.execute(new UpdateMemberPermissionsCommand(
                fixture.workspace().getId(), fixture.ownerId(), fixture.memberId(), true, true));

        Membership persisted = membershipRepository.findByWorkspaceIdAndUserId(
                fixture.workspace().getId(), fixture.memberId()).orElseThrow();
        assertThat(persisted.isCanPublishWorkflow()).isTrue();
        assertThat(persisted.isCanManageWorkflowState()).isTrue();
    }

    @Test
    void rolledBackAmbientMembershipGrantNeverPublishesAuthorizationCache() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew("Rollback cache workspace", ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            return saved;
        });

        assertThatThrownBy(() -> transactionRunner.required(() -> {
            membershipRepository.save(Membership.member(workspace.getId(), memberId));
            WorkspaceAccessSnapshot snapshot = resolveWorkspaceAccessUseCase.execute(
                    workspace.getId(), memberId);
            assertThat(snapshot.userId()).isEqualTo(memberId);
            throw new IllegalStateException("force ambient rollback");
        })).isInstanceOf(IllegalStateException.class);

        assertThatThrownBy(() -> resolveWorkspaceAccessUseCase.execute(workspace.getId(), memberId))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(authorizationCache.get(workspace.getId(), memberId)).isEmpty();
    }

    @Test
    void permissionUpdateFencesOutSnapshotReadBeforeCommit() throws Exception {
        Fixture fixture = fixture();
        BlockingMembershipRepository blocking = new BlockingMembershipRepository(
                membershipRepository, fixture.workspace().getId(), fixture.memberId());
        ResolveWorkspaceAccessUseCase staleResolver = new ResolveWorkspaceAccessUseCase(
                blocking,
                new WorkspaceAuthorizationPolicy(),
                authorizationCache,
                transactionRunner,
                afterCommitExecutor,
                java.time.Duration.ofMinutes(5));
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<WorkspaceAccessSnapshot> staleRead = executor.submit(() -> staleResolver.execute(
                    fixture.workspace().getId(), fixture.memberId()));
            assertThat(blocking.readStarted.await(10, TimeUnit.SECONDS)).isTrue();

            updateMemberPermissionsUseCase.execute(new UpdateMemberPermissionsCommand(
                    fixture.workspace().getId(),
                    fixture.ownerId(),
                    fixture.memberId(),
                    true,
                    false));
            blocking.releaseRead.countDown();

            WorkspaceAccessSnapshot oldSnapshot = staleRead.get(10, TimeUnit.SECONDS);
            assertThat(oldSnapshot.capabilities()).doesNotContain(WorkspaceCapability.WORKFLOW_PUBLISH);
            assertThat(authorizationCache.get(fixture.workspace().getId(), fixture.memberId())).isEmpty();

            WorkspaceAccessSnapshot current = resolveWorkspaceAccessUseCase.execute(
                    fixture.workspace().getId(), fixture.memberId());
            assertThat(current.capabilities()).contains(WorkspaceCapability.WORKFLOW_PUBLISH);
        } finally {
            blocking.releaseRead.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void leaveFencesOutSnapshotReadBeforeCommit() throws Exception {
        Fixture fixture = fixture();
        BlockingMembershipRepository blocking = new BlockingMembershipRepository(
                membershipRepository, fixture.workspace().getId(), fixture.memberId());
        ResolveWorkspaceAccessUseCase staleResolver = new ResolveWorkspaceAccessUseCase(
                blocking,
                new WorkspaceAuthorizationPolicy(),
                authorizationCache,
                transactionRunner,
                afterCommitExecutor,
                java.time.Duration.ofMinutes(5));
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<WorkspaceAccessSnapshot> staleRead = executor.submit(() -> staleResolver.execute(
                    fixture.workspace().getId(), fixture.memberId()));
            assertThat(blocking.readStarted.await(10, TimeUnit.SECONDS)).isTrue();

            leaveWorkspaceUseCase.execute(fixture.workspace().getId(), fixture.memberId());
            blocking.releaseRead.countDown();

            WorkspaceAccessSnapshot oldSnapshot = staleRead.get(10, TimeUnit.SECONDS);
            assertThat(oldSnapshot.userId()).isEqualTo(fixture.memberId());
            assertThat(authorizationCache.get(fixture.workspace().getId(), fixture.memberId())).isEmpty();
            assertThatThrownBy(() -> resolveWorkspaceAccessUseCase.execute(
                    fixture.workspace().getId(), fixture.memberId()))
                    .isInstanceOf(ResourceNotFoundException.class);
        } finally {
            blocking.releaseRead.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentRemoveDoesNotAllowStalePermissionUpdateToResurrectMembership() throws Exception {
        Fixture fixture = fixture();
        BlockingMembershipRepository blocking = new BlockingMembershipRepository(
                membershipRepository, fixture.workspace().getId(), fixture.memberId());
        UpdateMemberPermissionsUseCase staleUpdate = new UpdateMemberPermissionsUseCase(
                blocking,
                transactionRunner,
                afterCommitExecutor,
                authorizationCache);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<Throwable> update = executor.submit(() -> {
                try {
                    staleUpdate.execute(new UpdateMemberPermissionsCommand(
                            fixture.workspace().getId(),
                            fixture.ownerId(),
                            fixture.memberId(),
                            true,
                            false));
                    return null;
                } catch (Throwable exception) {
                    return exception;
                }
            });
            assertThat(blocking.readStarted.await(10, TimeUnit.SECONDS)).isTrue();

            removeMemberUseCase.execute(
                    fixture.workspace().getId(), fixture.ownerId(), fixture.memberId());
            blocking.releaseRead.countDown();

            assertThat(update.get(10, TimeUnit.SECONDS))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThat(membershipRepository.findByWorkspaceIdAndUserId(
                    fixture.workspace().getId(), fixture.memberId())).isEmpty();
        } finally {
            blocking.releaseRead.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentRemoveIsIdempotentWhenBothTransactionsReadBeforeDelete() throws Exception {
        Fixture fixture = fixture();
        CyclicBarrier barrier = new CyclicBarrier(2);
        RemoveMemberUseCase first = new RemoveMemberUseCase(
                new BlockingMembershipRepository(
                        membershipRepository,
                        fixture.workspace().getId(),
                        fixture.memberId(),
                        barrier),
                transactionRunner,
                afterCommitExecutor,
                authorizationCache);
        RemoveMemberUseCase second = new RemoveMemberUseCase(
                new BlockingMembershipRepository(
                        membershipRepository,
                        fixture.workspace().getId(),
                        fixture.memberId(),
                        barrier),
                transactionRunner,
                afterCommitExecutor,
                authorizationCache);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Throwable> firstResult = executor.submit(() -> invokeRemove(first, fixture));
            Future<Throwable> secondResult = executor.submit(() -> invokeRemove(second, fixture));

            List<Throwable> outcomes = java.util.Arrays.asList(
                    firstResult.get(10, TimeUnit.SECONDS),
                    secondResult.get(10, TimeUnit.SECONDS));
            assertThat(outcomes.stream().filter(java.util.Objects::isNull).count()).isEqualTo(1);
            assertThat(outcomes.stream().filter(java.util.Objects::nonNull).toList())
                    .singleElement()
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThat(membershipRepository.findByWorkspaceIdAndUserId(
                    fixture.workspace().getId(), fixture.memberId())).isEmpty();
        } finally {
            executor.shutdownNow();
        }
    }

    private Throwable invokeRemove(RemoveMemberUseCase useCase, Fixture fixture) {
        try {
            useCase.execute(fixture.workspace().getId(), fixture.ownerId(), fixture.memberId());
            return null;
        } catch (Throwable exception) {
            return exception;
        }
    }

    private Fixture fixture() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew("Cache workspace", ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            membershipRepository.save(Membership.member(saved.getId(), memberId));
            return saved;
        });
        return new Fixture(workspace, ownerId, memberId);
    }

    private String key(UUID workspaceId, UUID userId) {
        return "workspace:authz:" + workspaceId + ":" + userId;
    }

    private record Fixture(Workspace workspace, UUID ownerId, UUID memberId) {
    }

    private static final class BlockingMembershipRepository implements MembershipRepository {
        private final MembershipRepository delegate;
        private final UUID workspaceId;
        private final UUID userId;
        private final CountDownLatch readStarted = new CountDownLatch(1);
        private final CountDownLatch releaseRead = new CountDownLatch(1);
        private final CyclicBarrier coordinatedRead;

        private BlockingMembershipRepository(
                MembershipRepository delegate,
                UUID workspaceId,
                UUID userId) {
            this(delegate, workspaceId, userId, null);
        }

        private BlockingMembershipRepository(
                MembershipRepository delegate,
                UUID workspaceId,
                UUID userId,
                CyclicBarrier coordinatedRead) {
            this.delegate = delegate;
            this.workspaceId = workspaceId;
            this.userId = userId;
            this.coordinatedRead = coordinatedRead;
        }

        @Override
        public Membership save(Membership membership) {
            return delegate.save(membership);
        }

        @Override
        public Membership updateOptionalPermissions(Membership membership) {
            return delegate.updateOptionalPermissions(membership);
        }

        @Override
        public Optional<Membership> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<Membership> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId) {
            Optional<Membership> result = delegate.findByWorkspaceIdAndUserId(workspaceId, userId);
            if (this.workspaceId.equals(workspaceId) && this.userId.equals(userId)) {
                if (coordinatedRead != null) {
                    try {
                        coordinatedRead.await(10, TimeUnit.SECONDS);
                    } catch (Exception exception) {
                        throw new IllegalStateException("coordinated membership read failed", exception);
                    }
                } else {
                    readStarted.countDown();
                    try {
                        if (!releaseRead.await(10, TimeUnit.SECONDS)) {
                            throw new IllegalStateException("timed out waiting to release membership read");
                        }
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException("membership read interrupted", exception);
                    }
                }
            }
            return result;
        }

        @Override
        public boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId) {
            return delegate.existsByWorkspaceIdAndUserId(workspaceId, userId);
        }

        @Override
        public List<Membership> findCandidates(UUID workspaceId, MemberListQuery filter) {
            return delegate.findCandidates(workspaceId, filter);
        }

        @Override
        public PageResult<Membership> pageCandidatesByWorkspaceOwnedSort(
                UUID workspaceId,
                MemberListQuery query,
                Collection<UUID> matchedUserIds) {
            return delegate.pageCandidatesByWorkspaceOwnedSort(workspaceId, query, matchedUserIds);
        }

        @Override
        public void delete(Membership membership) {
            delegate.delete(membership);
        }
    }
}
