package com.weav.workspace.application.usecase;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.infrastructure.persistence.repository.SpringDataMembershipRepository;
import com.weav.workspace.infrastructure.persistence.repository.SpringDataWorkspaceRepository;
import com.weav.workspace.infrastructure.persistence.repository.MembershipRepositoryAdapter;
import com.weav.workspace.infrastructure.persistence.repository.WorkspaceRepositoryAdapter;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkspaceUseCasePersistenceIntegrationTest {

    @Autowired
    private CreateWorkspaceUseCase createWorkspaceUseCase;

    @Autowired
    private WorkspaceRepositoryAdapter workspaceRepository;

    @Autowired
    private SpringDataWorkspaceRepository springDataWorkspaceRepository;

    @Autowired
    private SpringDataMembershipRepository springDataMembershipRepository;

    @Autowired
    private MembershipRepositoryAdapter membershipRepository;

    @Autowired
    private TransactionRunner transactionRunner;

    @Test
    void createCommitsWorkspaceAndExactlyOneOwnerInOnePostgresTransaction() {
        UUID actor = UUID.randomUUID();

        var response = createWorkspaceUseCase.execute(
                new CreateWorkspaceCommand(actor, "Integration Workspace"));

        var persistedWorkspace = springDataWorkspaceRepository.findById(response.id()).orElseThrow();
        var persistedMemberships = springDataMembershipRepository.findAll().stream()
                .filter(membership -> response.id().equals(membership.getWorkspaceId()))
                .toList();

        assertEquals(response.id(), persistedWorkspace.getId());
        assertEquals("Integration Workspace", persistedWorkspace.getName());
        assertEquals(actor, persistedWorkspace.getCreatedBy());
        assertEquals(1, persistedMemberships.size());
        assertEquals(actor, persistedMemberships.getFirst().getUserId());
        assertEquals(MembershipRole.OWNER, persistedMemberships.getFirst().getRole());
    }

    @Test
    void membershipFailureRollsBackWorkspaceAndLeavesNoOrphan() {
        UUID actor = UUID.randomUUID();
        UUID[] workspaceId = new UUID[1];
        WorkspaceRepository recordingWorkspaceRepository = new WorkspaceRepository() {
            @Override
            public Workspace save(Workspace workspace) {
                workspaceId[0] = workspace.getId();
                return workspaceRepository.save(workspace);
            }

            @Override
            public Optional<Workspace> findById(UUID id) {
                return workspaceRepository.findById(id);
            }

            @Override
            public boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceId) {
                return workspaceRepository.existsOwnedNameNormalized(ownerId, normalizedName, excludeWorkspaceId);
            }

            @Override
            public int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId) {
                return workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ownerId);
            }

            @Override
            public PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(
                    UUID userId, WorkspaceListQuery query) {
                return workspaceRepository.findAccessibleWorkspaces(userId, query);
            }
        };
        MembershipRepository failingMembershipRepository = mock(MembershipRepository.class);
        when(failingMembershipRepository.save(any(Membership.class)))
                .thenThrow(new IllegalStateException("membership write failed"));

        CreateWorkspaceUseCase useCase = new CreateWorkspaceUseCase(
                recordingWorkspaceRepository, failingMembershipRepository, transactionRunner);

        assertThrows(IllegalStateException.class, () -> useCase.execute(
                new CreateWorkspaceCommand(actor, "Rollback Workspace")));

        assertTrue(workspaceId[0] != null);
        assertTrue(springDataWorkspaceRepository.findById(workspaceId[0]).isEmpty());
        assertTrue(springDataMembershipRepository.findByWorkspaceIdAndUserId(workspaceId[0], actor).isEmpty());
    }

    @Test
    void renameTranslatesRealOwnerNameUniqueConstraintAfterPrecheckRace() {
        UUID owner = UUID.randomUUID();
        Workspace target = workspaceRepository.save(Workspace.createNew("Rename target", owner));
        membershipRepository.save(Membership.owner(target.getId(), owner));
        Workspace collision = workspaceRepository.save(Workspace.createNew("Already owned", owner));
        membershipRepository.save(Membership.owner(collision.getId(), owner));

        RenameWorkspaceUseCase useCase = new RenameWorkspaceUseCase(
                new FirstPrecheckBypassWorkspaceRepository(workspaceRepository),
                membershipRepository,
                transactionRunner);

        WorkspaceNameAlreadyExistsException exception = assertThrows(
                WorkspaceNameAlreadyExistsException.class,
                () -> useCase.execute(owner, target.getId(), "Already owned"));

        assertEquals("WORKSPACE_NAME_ALREADY_EXISTS", exception.getCode());
        assertEquals("Rename target", workspaceRepository.findById(target.getId()).orElseThrow().getName());
    }

    @Test
    void generatedNameRetriesAfterRealUniqueFailureInsideAmbientTransaction() {
        UUID owner = UUID.randomUUID();
        AtomicBoolean collisionInjected = new AtomicBoolean();

        CreateWorkspaceUseCase useCase = new CreateWorkspaceUseCase(
                new FirstPrecheckBypassWorkspaceRepository(
                        workspaceRepository,
                        candidate -> {
                            if ("My workspace 1".equals(candidate.getName())
                                    && collisionInjected.compareAndSet(false, true)) {
                                transactionRunner.requiresNew(() -> {
                                    Workspace competing = workspaceRepository.save(
                                            Workspace.createNew(candidate.getName(), owner));
                                    membershipRepository.save(Membership.owner(competing.getId(), owner));
                                    return competing;
                                });
                            }
                        }),
                membershipRepository,
                transactionRunner);

        WorkspaceResponse response = transactionRunner.required(() -> useCase.execute(
                new CreateWorkspaceCommand(owner, null)));

        assertTrue(collisionInjected.get());
        assertEquals("My workspace 2", response.name());
        assertEquals(owner, membershipRepository.findByWorkspaceIdAndUserId(response.id(), owner)
                .orElseThrow().getUserId());
    }

    @Test
    void unrelatedMembershipIntegrityFailureIsPreservedAndLeavesNoOrphan() {
        UUID actor = UUID.randomUUID();
        UUID[] workspaceId = new UUID[1];
        WorkspaceRepository recordingWorkspaceRepository = new WorkspaceRepository() {
            @Override
            public Workspace save(Workspace workspace) {
                workspaceId[0] = workspace.getId();
                return workspaceRepository.save(workspace);
            }

            @Override
            public Optional<Workspace> findById(UUID id) {
                return workspaceRepository.findById(id);
            }

            @Override
            public boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceId) {
                return workspaceRepository.existsOwnedNameNormalized(ownerId, normalizedName, excludeWorkspaceId);
            }

            @Override
            public int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId) {
                return workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ownerId);
            }

            @Override
            public PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(
                    UUID userId, WorkspaceListQuery query) {
                return workspaceRepository.findAccessibleWorkspaces(userId, query);
            }
        };
        MembershipRepository failingMembershipRepository = mock(MembershipRepository.class);
        when(failingMembershipRepository.save(any(Membership.class))).thenAnswer(invocation -> {
            Membership membership = invocation.getArgument(0);
            Membership persisted = membershipRepository.save(membership);
            membershipRepository.save(Membership.member(UUID.randomUUID(), membership.getUserId()));
            return persisted;
        });

        CreateWorkspaceUseCase useCase = new CreateWorkspaceUseCase(
                recordingWorkspaceRepository, failingMembershipRepository, transactionRunner);

        assertThrows(DataIntegrityViolationException.class, () -> useCase.execute(
                new CreateWorkspaceCommand(actor, null)));

        assertTrue(workspaceId[0] != null);
        assertTrue(springDataWorkspaceRepository.findById(workspaceId[0]).isEmpty());
        assertTrue(springDataMembershipRepository.findByWorkspaceIdAndUserId(workspaceId[0], actor).isEmpty());
    }

    private static final class FirstPrecheckBypassWorkspaceRepository implements WorkspaceRepository {
        private final WorkspaceRepository delegate;
        private final AtomicBoolean bypass = new AtomicBoolean(true);
        private final Consumer<Workspace> beforeSave;

        private FirstPrecheckBypassWorkspaceRepository(WorkspaceRepository delegate) {
            this(delegate, ignored -> {
            });
        }

        private FirstPrecheckBypassWorkspaceRepository(
                WorkspaceRepository delegate,
                Consumer<Workspace> beforeSave) {
            this.delegate = delegate;
            this.beforeSave = beforeSave;
        }

        @Override
        public Workspace save(Workspace workspace) {
            beforeSave.accept(workspace);
            return delegate.save(workspace);
        }

        @Override
        public Optional<Workspace> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceId) {
            if (bypass.compareAndSet(true, false)) {
                return false;
            }
            return delegate.existsOwnedNameNormalized(ownerId, normalizedName, excludeWorkspaceId);
        }

        @Override
        public int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId) {
            return delegate.findMaxDefaultWorkspaceNumberByOwner(ownerId);
        }

        @Override
        public PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(
                UUID userId, WorkspaceListQuery query) {
            return delegate.findAccessibleWorkspaces(userId, query);
        }
    }
}
