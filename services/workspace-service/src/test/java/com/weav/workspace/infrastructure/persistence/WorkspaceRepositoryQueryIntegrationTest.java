package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.domain.query.WorkspaceSort;
import com.weav.workspace.domain.valueobject.MembershipRole;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkspaceRepositoryQueryIntegrationTest {

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private EntityManager entityManager;

    @Test
    @Transactional
    void repositoryRoundTripPreservesDomainIdentityAndTimestamps() {
        UUID workspaceId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-02-01T00:00:00Z");
        Instant updatedAt = Instant.parse("2026-02-02T00:00:00Z");
        Instant joinedAt = Instant.parse("2026-02-03T00:00:00Z");
        Instant membershipUpdatedAt = Instant.parse("2026-02-04T00:00:00Z");

        Workspace workspace = new Workspace(
                workspaceId, " Project A ", ownerId, createdAt, updatedAt);
        Membership membership = new Membership(
                membershipId,
                workspaceId,
                memberId,
                MembershipRole.MEMBER,
                true,
                false,
                joinedAt,
                membershipUpdatedAt);

        workspaceRepository.save(workspace);
        membershipRepository.save(membership);
        entityManager.clear();

        Workspace restoredWorkspace = workspaceRepository.findById(workspaceId).orElseThrow();
        Membership restoredMembership = membershipRepository
                .findByWorkspaceIdAndUserId(workspaceId, memberId)
                .orElseThrow();

        assertThat(restoredWorkspace.getId()).isEqualTo(workspaceId);
        assertThat(restoredWorkspace.getName()).isEqualTo("Project A");
        assertThat(restoredWorkspace.getNameNormalized()).isEqualTo("project a");
        assertThat(restoredWorkspace.getCreatedBy()).isEqualTo(ownerId);
        assertThat(restoredWorkspace.getCreatedAt()).isEqualTo(createdAt);
        assertThat(restoredWorkspace.getUpdatedAt()).isEqualTo(updatedAt);
        assertThat(restoredMembership.getId()).isEqualTo(membershipId);
        assertThat(restoredMembership.getWorkspaceId()).isEqualTo(workspaceId);
        assertThat(restoredMembership.getUserId()).isEqualTo(memberId);
        assertThat(restoredMembership.getRole()).isEqualTo(MembershipRole.MEMBER);
        assertThat(restoredMembership.isCanPublishWorkflow()).isTrue();
        assertThat(restoredMembership.isCanManageWorkflowState()).isFalse();
        assertThat(restoredMembership.getJoinedAt()).isEqualTo(joinedAt);
        assertThat(restoredMembership.getUpdatedAt()).isEqualTo(membershipUpdatedAt);
    }

    @Test
    @Transactional
    void findsMaximumPositiveDefaultWorkspaceNumberPerOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID anotherOwnerId = UUID.randomUUID();

        saveWorkspace("My workspace 1", ownerId);
        saveWorkspace("My workspace 3", ownerId);
        saveWorkspace("Other", ownerId);
        saveWorkspace("My workspace 0", ownerId);
        saveWorkspace("My workspace -1", ownerId);
        saveWorkspace("My workspace 8", anotherOwnerId);

        assertThat(workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(ownerId)).isEqualTo(3);
    }

    @Test
    @Transactional
    void scopesWorkspaceResultsByMembershipAndAppliesSearchRoleSortAndPaging() {
        UUID userId = UUID.randomUUID();
        Workspace alpha = saveAccessibleWorkspace("Alpha", UUID.randomUUID(), userId);
        Workspace beta = saveAccessibleWorkspace("Beta", UUID.randomUUID(), userId);
        Workspace zeta = saveAccessibleWorkspace("Zeta", UUID.randomUUID(), userId);
        saveAccessibleWorkspace("Hidden", UUID.randomUUID(), UUID.randomUUID());

        PageResult<com.weav.workspace.domain.model.WorkspaceMembershipView> firstPage =
                workspaceRepository.findAccessibleWorkspaces(
                        userId,
                        new WorkspaceListQuery(
                                null,
                                MembershipRole.MEMBER,
                                0,
                                2,
                                WorkspaceSort.NAME,
                                SortDirection.ASC));

        assertThat(firstPage.items()).extracting(view -> view.workspace().getId())
                .containsExactly(alpha.getId(), beta.getId());
        assertThat(firstPage.page()).isZero();
        assertThat(firstPage.size()).isEqualTo(2);
        assertThat(firstPage.totalElements()).isEqualTo(3);
        assertThat(firstPage.totalPages()).isEqualTo(2);
        assertThat(firstPage.items()).allSatisfy(view -> assertThat(view.role()).isEqualTo(MembershipRole.MEMBER));

        PageResult<com.weav.workspace.domain.model.WorkspaceMembershipView> secondPage =
                workspaceRepository.findAccessibleWorkspaces(
                        userId,
                        new WorkspaceListQuery(
                                null,
                                MembershipRole.MEMBER,
                                1,
                                2,
                                WorkspaceSort.NAME,
                                SortDirection.ASC));

        assertThat(secondPage.items()).extracting(view -> view.workspace().getId())
                .containsExactly(zeta.getId());

        PageResult<com.weav.workspace.domain.model.WorkspaceMembershipView> searched =
                workspaceRepository.findAccessibleWorkspaces(
                        userId,
                        new WorkspaceListQuery(
                                "  alp ",
                                MembershipRole.MEMBER,
                                0,
                                20,
                                WorkspaceSort.NAME,
                                SortDirection.ASC));

        assertThat(searched.items()).extracting(view -> view.workspace().getName())
                .containsExactly("Alpha");
        assertThat(searched.totalElements()).isEqualTo(1);
    }

    @Test
    @Transactional
    void workspaceSearchTreatsLikeWildcardsAndEscapeCharacterAsLiterals() {
        UUID userId = UUID.randomUUID();
        Workspace percent = saveAccessibleWorkspace("100% Ready", UUID.randomUUID(), userId);
        Workspace underscore = saveAccessibleWorkspace("100_Ready", UUID.randomUUID(), userId);
        saveAccessibleWorkspace("100XReady", UUID.randomUUID(), userId);
        Workspace escape = saveAccessibleWorkspace("Bang!Ready", UUID.randomUUID(), userId);
        saveAccessibleWorkspace("BangXReady", UUID.randomUUID(), userId);

        assertThat(searchWorkspaceIds(userId, "100%"))
                .containsExactly(percent.getId());
        assertThat(searchWorkspaceIds(userId, "100_"))
                .containsExactly(underscore.getId());
        assertThat(searchWorkspaceIds(userId, "Bang!"))
                .containsExactly(escape.getId());
    }

    @Test
    @Transactional
    void accessibleWorkspaceListingRemainsSafeWhenMembershipWasRemovedBeforeTheRead() {
        UUID userId = UUID.randomUUID();
        Workspace workspace = saveAccessibleWorkspace("Transient access", UUID.randomUUID(), userId);

        assertThat(workspaceRepository.findAccessibleWorkspaces(
                        userId, WorkspaceListQuery.defaults()).items())
                .extracting(view -> view.workspace().getId())
                .containsExactly(workspace.getId());

        Membership membership = membershipRepository
                .findByWorkspaceIdAndUserId(workspace.getId(), userId)
                .orElseThrow();
        membershipRepository.delete(membership);
        entityManager.flush();
        entityManager.clear();

        PageResult<com.weav.workspace.domain.model.WorkspaceMembershipView> afterRemoval =
                workspaceRepository.findAccessibleWorkspaces(userId, WorkspaceListQuery.defaults());

        assertThat(afterRemoval.items()).isEmpty();
        assertThat(afterRemoval.totalElements()).isZero();
    }

    @Test
    @Transactional
    void filtersAndPagesMembershipCandidatesWithinWorkspace() {
        UUID workspaceOwner = UUID.randomUUID();
        Workspace workspace = saveWorkspace("Members", workspaceOwner);
        membershipRepository.save(Membership.owner(workspace.getId(), workspaceOwner));

        UUID publishUser = UUID.randomUUID();
        UUID stateUser = UUID.randomUUID();
        UUID outsideUser = UUID.randomUUID();
        Workspace otherWorkspace = saveWorkspace("Other Members", UUID.randomUUID());
        membershipRepository.save(Membership.owner(otherWorkspace.getId(), otherWorkspace.getCreatedBy()));
        Instant base = Instant.parse("2026-01-01T00:00:00Z");
        Membership publishMember = new Membership(
                UUID.randomUUID(), workspace.getId(), publishUser, MembershipRole.MEMBER,
                true, false, base.plusSeconds(10), base.plusSeconds(10));
        Membership stateMember = new Membership(
                UUID.randomUUID(), workspace.getId(), stateUser, MembershipRole.MEMBER,
                false, true, base.plusSeconds(20), base.plusSeconds(20));
        Membership outsideWorkspaceMember = new Membership(
                UUID.randomUUID(), otherWorkspace.getId(), outsideUser, MembershipRole.MEMBER,
                true, false, base.plusSeconds(30), base.plusSeconds(30));
        membershipRepository.save(publishMember);
        membershipRepository.save(stateMember);
        membershipRepository.save(outsideWorkspaceMember);

        assertThat(membershipRepository.findCandidates(
                        workspace.getId(),
                        new MemberListQuery(
                                null,
                                MembershipRole.MEMBER,
                                true,
                                null,
                                0,
                                20,
                                MemberSort.DISPLAY_NAME,
                                SortDirection.ASC)))
                .extracting(Membership::getUserId)
                .containsExactly(publishUser);

        PageResult<Membership> page = membershipRepository.pageCandidatesByWorkspaceOwnedSort(
                workspace.getId(),
                new MemberListQuery(
                        null,
                        MembershipRole.MEMBER,
                        null,
                        null,
                        0,
                        1,
                        MemberSort.JOINED_AT,
                        SortDirection.DESC),
                Set.of(publishUser, stateUser, outsideUser));

        assertThat(page.items()).extracting(Membership::getUserId).containsExactly(stateUser);
        assertThat(page.totalElements()).isEqualTo(2);
        assertThat(page.totalPages()).isEqualTo(2);

        PageResult<Membership> roleSorted = membershipRepository.pageCandidatesByWorkspaceOwnedSort(
                workspace.getId(),
                new MemberListQuery(
                        null,
                        null,
                        null,
                        null,
                        0,
                        20,
                        MemberSort.ROLE,
                        SortDirection.ASC),
                Set.of(workspaceOwner, publishUser, stateUser));

        assertThat(roleSorted.items()).extracting(Membership::getRole)
                .containsExactly(MembershipRole.MEMBER, MembershipRole.MEMBER, MembershipRole.OWNER);
    }

    private Workspace saveWorkspace(String name, UUID ownerId) {
        return workspaceRepository.save(Workspace.createNew(name, ownerId));
    }

    private Workspace saveAccessibleWorkspace(String name, UUID ownerId, UUID userId) {
        Workspace workspace = saveWorkspace(name, ownerId);
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        if (!ownerId.equals(userId)) {
            membershipRepository.save(Membership.member(workspace.getId(), userId));
        }
        return workspace;
    }

    private Set<UUID> searchWorkspaceIds(UUID userId, String search) {
        return workspaceRepository.findAccessibleWorkspaces(
                        userId,
                        new WorkspaceListQuery(
                                search,
                                null,
                                0,
                                20,
                                WorkspaceSort.NAME,
                                SortDirection.ASC))
                .items()
                .stream()
                .map(view -> view.workspace().getId())
                .collect(java.util.stream.Collectors.toSet());
    }
}
