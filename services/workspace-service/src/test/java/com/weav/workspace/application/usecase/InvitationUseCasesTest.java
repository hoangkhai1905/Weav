package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.MyInvitationsView;
import com.weav.workspace.application.dto.OwnerInvitationView;
import com.weav.workspace.application.notification.WorkspaceNotificationEvent;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.EmailNotVerifiedException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvitationExistsException;
import com.weav.workspace.domain.exception.InvitationGoneException;
import com.weav.workspace.domain.exception.InvitationLimitException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.exception.InvitationNotPendingException;
import com.weav.workspace.domain.exception.InvitationResendTooSoonException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.UserExistsException;
import com.weav.workspace.domain.exception.UserInactiveException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.InvitationStatus;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InvitationUseCasesTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID INVITEE = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final Instant T0 = Instant.parse("2026-10-10T00:00:00Z");

    private final TransactionRunner tx = new TransactionRunner() {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            return work.get();
        }
    };
    private final AfterCommitExecutor afterCommit = Runnable::run;

    private final Map<UUID, WorkspaceInvitation> store = new LinkedHashMap<>();
    private final List<WorkspaceNotificationEvent> events = new ArrayList<>();
    private final List<Membership> savedMemberships = new ArrayList<>();
    private Instant now = T0;
    private final Clock clock = new Clock() {
        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    };

    private MembershipRepository memberships;
    private WorkspaceRepository workspaces;
    private IdentityDirectoryPort identity;
    private WorkspaceAuthorizationCache cache;
    private WorkspaceInvitationRepository invitations;
    private WorkspaceNotificationRecorder recorder;

    @BeforeEach
    void setUp() {
        memberships = mock(MembershipRepository.class);
        workspaces = mock(WorkspaceRepository.class);
        identity = mock(IdentityDirectoryPort.class);
        cache = mock(WorkspaceAuthorizationCache.class);
        recorder = new WorkspaceNotificationRecorder(events::add, clock);
        invitations = new WorkspaceInvitationRepository() {
            @Override
            public WorkspaceInvitation save(WorkspaceInvitation invitation) {
                store.put(invitation.getId(), invitation);
                return invitation;
            }

            @Override
            public Optional<WorkspaceInvitation> findById(UUID id) {
                return Optional.ofNullable(store.get(id));
            }

            @Override
            public Optional<WorkspaceInvitation> findPendingByWorkspaceAndEmail(UUID workspaceId, String email) {
                return store.values().stream()
                        .filter(i -> i.getWorkspaceId().equals(workspaceId) && i.getEmail().equals(email)
                                && i.getStatus() == InvitationStatus.PENDING)
                        .findFirst();
            }

            @Override
            public long countLivePendingByWorkspace(UUID workspaceId, Instant at) {
                return store.values().stream()
                        .filter(i -> i.getWorkspaceId().equals(workspaceId) && i.isLive(at))
                        .count();
            }

            @Override
            public long countCreatedSince(UUID workspaceId, Instant since) {
                return store.values().stream()
                        .filter(i -> i.getWorkspaceId().equals(workspaceId) && !i.getCreatedAt().isBefore(since))
                        .count();
            }

            @Override
            public List<WorkspaceInvitation> listPendingByWorkspace(UUID workspaceId, int limit) {
                return store.values().stream()
                        .filter(i -> i.getWorkspaceId().equals(workspaceId)
                                && i.getStatus() == InvitationStatus.PENDING)
                        .limit(limit).toList();
            }

            @Override
            public List<WorkspaceInvitation> listLivePendingByEmail(String email, Instant at, int limit) {
                return store.values().stream()
                        .filter(i -> i.getEmail().equals(email) && i.isLive(at))
                        .limit(limit)
                        .toList();
            }
        };
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(memberships.save(any())).thenAnswer(invocation -> {
            Membership saved = invocation.getArgument(0);
            savedMemberships.add(saved);
            when(memberships.existsByWorkspaceIdAndUserId(saved.getWorkspaceId(), saved.getUserId()))
                    .thenReturn(true);
            return saved;
        });
        when(workspaces.findById(WORKSPACE)).thenReturn(Optional.of(
                new Workspace(WORKSPACE, "Team space", OWNER, T0, T0)));
        when(identity.getUsersByIds(List.of(OWNER))).thenReturn(List.of(
                new IdentityUserSummary(OWNER, "owner@example.com", "Owner Name", true, true)));
        when(identity.findByEmail("an@example.com")).thenReturn(Optional.empty());
        when(workspaces.findAllByIds(any())).thenAnswer(invocation ->
                ((java.util.Collection<UUID>) invocation.getArgument(0)).stream()
                        .map(workspaces::findById).flatMap(Optional::stream).toList());
    }

    private CreateInvitationUseCase create() {
        return new CreateInvitationUseCase(memberships, workspaces, invitations, identity, tx,
                workspaceId -> {}, recorder, clock);
    }

    private ResendInvitationUseCase resend() {
        return new ResendInvitationUseCase(memberships, workspaces, invitations, identity, tx,
                workspaceId -> {}, recorder, clock);
    }

    private RevokeInvitationUseCase revoke() {
        return new RevokeInvitationUseCase(memberships, invitations, tx, workspaceId -> {}, clock);
    }

    private AcceptInvitationUseCase accept() {
        return new AcceptInvitationUseCase(invitations, memberships, workspaces, identity, tx, afterCommit,
                cache, workspaceId -> {}, recorder, clock);
    }

    private DeclineInvitationUseCase decline() {
        return new DeclineInvitationUseCase(invitations, identity, tx, workspaceId -> {}, clock);
    }

    private ListMyInvitationsUseCase listMine() {
        return new ListMyInvitationsUseCase(invitations, workspaces, identity, tx, clock);
    }

    private void invitee(String email, boolean verified) {
        when(identity.getUsersByIds(List.of(INVITEE))).thenReturn(List.of(
                new IdentityUserSummary(INVITEE, email, "Invitee", true, verified)));
    }

    // ----- owner side

    @Test
    void createStoresPendingInvitationAndRecordsExactEventForTheInviter() {
        OwnerInvitationView view = create().execute(WORKSPACE, OWNER, "  An@Example.com ");

        assertThat(view.email()).isEqualTo("an@example.com");
        assertThat(view.status()).isEqualTo("PENDING");
        assertThat(view.expiresAt()).isEqualTo(T0.plus(Duration.ofDays(7)));
        assertThat(events).hasSize(1);
        WorkspaceNotificationEvent event = events.get(0);
        assertThat(event.eventType()).isEqualTo("workspace.invitation.created");
        assertThat(event.recipientUserIds()).containsExactly(OWNER);
        assertThat(event.actorUserId()).isEqualTo(OWNER);
        assertThat(event.data()).isEqualTo(new WorkspaceNotificationEvent.InvitationData(
                "Team space", "an@example.com", "Owner Name", "2026-10-17T00:00:00Z"));
    }

    @Test
    void nonOwnerIsRefusedBeforeAnyIdentityCall() {
        assertThatThrownBy(() -> create().execute(WORKSPACE, MEMBER, "an@example.com"))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> create().execute(WORKSPACE, INVITEE, "an@example.com"))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(identity);
    }

    @Test
    void existingAccountsAreDirectedToTheDirectAdd() {
        when(identity.findByEmail("an@example.com")).thenReturn(Optional.of(
                new IdentityUserSummary(INVITEE, "an@example.com", null, true, true)));
        assertThatThrownBy(() -> create().execute(WORKSPACE, OWNER, "an@example.com"))
                .isInstanceOf(UserExistsException.class);

        when(identity.findByEmail("an@example.com")).thenReturn(Optional.of(
                new IdentityUserSummary(INVITEE, "an@example.com", null, false, true)));
        assertThatThrownBy(() -> create().execute(WORKSPACE, OWNER, "an@example.com"))
                .isInstanceOf(UserInactiveException.class);
        assertThat(store).isEmpty();
    }

    @Test
    void liveDuplicateIsRejected() {
        create().execute(WORKSPACE, OWNER, "an@example.com");
        assertThatThrownBy(() -> create().execute(WORKSPACE, OWNER, "AN@example.com"))
                .isInstanceOf(InvitationExistsException.class);
        assertThat(store).hasSize(1);
    }

    @Test
    void fiftyPendingInvitationsBlockTheNextOne() {
        seedPending(50, T0.minus(Duration.ofDays(2)), T0.plus(Duration.ofDays(5)));
        assertThatThrownBy(() -> create().execute(WORKSPACE, OWNER, "an@example.com"))
                .isInstanceOf(InvitationLimitException.class);
    }

    @Test
    void expiredPendingRowsDoNotCountTowardsTheFiftyLimit() {
        seedPending(50, T0.minus(Duration.ofDays(9)), T0.minus(Duration.ofDays(2)));

        assertThat(create().execute(WORKSPACE, OWNER, "an@example.com").status()).isEqualTo("PENDING");
    }

    @Test
    void twentyInvitationsInARolling24HoursBlockTheNextOneUntilTheWindowPasses() {
        seedPending(20, T0.minus(Duration.ofHours(1)), T0.minus(Duration.ofMinutes(1)));
        assertThatThrownBy(() -> create().execute(WORKSPACE, OWNER, "an@example.com"))
                .isInstanceOf(InvitationLimitException.class);

        now = T0.plus(Duration.ofHours(24));
        assertThat(create().execute(WORKSPACE, OWNER, "an@example.com").status()).isEqualTo("PENDING");
    }

    private void seedPending(int count, Instant createdAt, Instant expiresAt) {
        for (int i = 0; i < count; i++) {
            invitations.save(new WorkspaceInvitation(UUID.randomUUID(), WORKSPACE, "p" + i + "@example.com",
                    OWNER, InvitationStatus.PENDING, expiresAt, createdAt, null, null, createdAt, createdAt));
        }
    }

    @Test
    void reInvitingAnExpiredAddressRevokesTheOldRowAndTheOldIdIsGone() {
        OwnerInvitationView first = create().execute(WORKSPACE, OWNER, "an@example.com");
        now = T0.plus(Duration.ofDays(8));

        OwnerInvitationView second = create().execute(WORKSPACE, OWNER, "an@example.com");

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(store.get(first.id()).getStatus()).isEqualTo(InvitationStatus.REVOKED);
        assertThat(store.get(second.id()).getStatus()).isEqualTo(InvitationStatus.PENDING);
        invitee("an@example.com", true);
        assertThatThrownBy(() -> accept().execute(INVITEE, first.id())).isInstanceOf(InvitationGoneException.class);
    }

    @Test
    void resendHonoursTheTenMinuteCooldownExtendsExpiryAndRecordsAgain() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");

        now = T0.plus(Duration.ofMinutes(9));
        assertThatThrownBy(() -> resend().execute(WORKSPACE, OWNER, created.id()))
                .isInstanceOf(InvitationResendTooSoonException.class);

        now = T0.plus(Duration.ofMinutes(11));
        OwnerInvitationView resent = resend().execute(WORKSPACE, OWNER, created.id());

        assertThat(resent.expiresAt()).isEqualTo(now.plus(Duration.ofDays(7)));
        assertThat(resent.lastSentAt()).isEqualTo(now);
        assertThat(events).hasSize(2);
        assertThat(events.get(1).eventId()).isNotEqualTo(events.get(0).eventId());
    }

    @Test
    void expiredInvitationCannotBeResentAndRevokeWorksOnce() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        now = T0.plus(Duration.ofDays(9));
        assertThatThrownBy(() -> resend().execute(WORKSPACE, OWNER, created.id()))
                .isInstanceOf(InvitationNotPendingException.class);

        revoke().execute(WORKSPACE, OWNER, created.id());
        assertThat(store.get(created.id()).getStatus()).isEqualTo(InvitationStatus.REVOKED);
        assertThatThrownBy(() -> revoke().execute(WORKSPACE, OWNER, created.id()))
                .isInstanceOf(InvitationNotPendingException.class);
    }

    @Test
    void invitationOfAnotherWorkspaceIsNotFound() {
        WorkspaceInvitation other = invitations.save(
                WorkspaceInvitation.pending(UUID.randomUUID(), "x@example.com", OWNER, T0));
        assertThatThrownBy(() -> revoke().execute(WORKSPACE, OWNER, other.getId()))
                .isInstanceOf(InvitationNotFoundException.class);
    }

    // ----- invitee side

    @Test
    void acceptMatchesTheVerifiedEmailIgnoringCaseAndSpacesAndCreatesOneMembership() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "An@Example.com ");
        invitee("  AN@example.COM", true);

        assertThat(accept().execute(INVITEE, created.id())).isEqualTo(WORKSPACE);
        assertThat(accept().execute(INVITEE, created.id())).isEqualTo(WORKSPACE);

        assertThat(savedMemberships).hasSize(1);
        assertThat(savedMemberships.get(0).getRole()).isEqualTo(MembershipRole.MEMBER);
        assertThat(savedMemberships.get(0).isCanPublishWorkflow()).isFalse();
        assertThat(store.get(created.id()).getStatus()).isEqualTo(InvitationStatus.ACCEPTED);
        verify(cache).evict(WORKSPACE, INVITEE);
        assertThat(events.stream().map(WorkspaceNotificationEvent::eventType))
                .containsExactly("workspace.invitation.created", "workspace.member_added");
    }

    @Test
    void anotherEmailsInvitationLooksMissing() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("someone.else@example.com", true);

        assertThatThrownBy(() -> accept().execute(INVITEE, created.id()))
                .isInstanceOf(InvitationNotFoundException.class);
        assertThatThrownBy(() -> decline().execute(INVITEE, created.id()))
                .isInstanceOf(InvitationNotFoundException.class);
        assertThat(listMine().execute(INVITEE).items()).isEmpty();
        assertThat(savedMemberships).isEmpty();
    }

    @Test
    void unverifiedEmailSeesNothingAndCannotAnswer() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("an@example.com", false);

        MyInvitationsView mine = listMine().execute(INVITEE);
        assertThat(mine.emailVerified()).isFalse();
        assertThat(mine.items()).isEmpty();
        assertThatThrownBy(() -> accept().execute(INVITEE, created.id()))
                .isInstanceOf(EmailNotVerifiedException.class);
        assertThatThrownBy(() -> decline().execute(INVITEE, created.id()))
                .isInstanceOf(EmailNotVerifiedException.class);
    }

    @Test
    void listShowsOnlyLiveInvitationsWithWorkspaceAndInviterNames() {
        OwnerInvitationView live = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitations.save(new WorkspaceInvitation(UUID.randomUUID(), WORKSPACE, "an@example.com", OWNER,
                InvitationStatus.PENDING, T0.minusSeconds(1), T0, null, null, T0, T0));
        invitee("an@example.com", true);
        when(identity.getUsersByIds(List.of(OWNER))).thenReturn(List.of(
                new IdentityUserSummary(OWNER, "owner@example.com", "Owner Name", true, true)));

        MyInvitationsView mine = listMine().execute(INVITEE);

        assertThat(mine.emailVerified()).isTrue();
        assertThat(mine.items()).hasSize(1);
        assertThat(mine.items().get(0).id()).isEqualTo(live.id());
        assertThat(mine.items().get(0).workspaceName()).isEqualTo("Team space");
        assertThat(mine.items().get(0).invitedByName()).isEqualTo("Owner Name");
    }

    @Test
    void expiredRevokedAndDeletedWorkspaceInvitationsAreGone() {
        OwnerInvitationView expired = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("an@example.com", true);
        now = T0.plus(Duration.ofDays(8));
        assertThatThrownBy(() -> accept().execute(INVITEE, expired.id())).isInstanceOf(InvitationGoneException.class);

        now = T0.plus(Duration.ofDays(9));
        OwnerInvitationView revoked = create().execute(WORKSPACE, OWNER, "an@example.com");
        revoke().execute(WORKSPACE, OWNER, revoked.id());
        assertThatThrownBy(() -> accept().execute(INVITEE, revoked.id())).isInstanceOf(InvitationGoneException.class);

        now = T0.plus(Duration.ofDays(10));
        OwnerInvitationView deleted = create().execute(WORKSPACE, OWNER, "an@example.com");
        when(workspaces.findById(WORKSPACE)).thenReturn(Optional.empty());
        assertThat(listMine().execute(INVITEE).items()).isEmpty();
        assertThatThrownBy(() -> accept().execute(INVITEE, deleted.id())).isInstanceOf(InvitationGoneException.class);
        assertThat(savedMemberships).isEmpty();
    }

    @Test
    void alreadyAMemberJustMarksAcceptedAndDeclineWorks() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("an@example.com", true);
        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, INVITEE)).thenReturn(true);

        accept().execute(INVITEE, created.id());
        assertThat(savedMemberships).isEmpty();
        assertThat(store.get(created.id()).getStatus()).isEqualTo(InvitationStatus.ACCEPTED);

        OwnerInvitationView second = create().execute(WORKSPACE, OWNER, "an@example.com");
        decline().execute(INVITEE, second.id());
        assertThat(store.get(second.id()).getStatus()).isEqualTo(InvitationStatus.DECLINED);
        assertThatThrownBy(() -> accept().execute(INVITEE, second.id())).isInstanceOf(InvitationGoneException.class);
    }

    @Test
    void inactiveCallerIsRefusedOnListAcceptAndDecline() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        when(identity.getUsersByIds(List.of(INVITEE))).thenReturn(List.of(
                new IdentityUserSummary(INVITEE, "an@example.com", "Invitee", false, true)));

        assertThatThrownBy(() -> listMine().execute(INVITEE)).isInstanceOf(UserInactiveException.class);
        assertThatThrownBy(() -> accept().execute(INVITEE, created.id())).isInstanceOf(UserInactiveException.class);
        assertThatThrownBy(() -> decline().execute(INVITEE, created.id())).isInstanceOf(UserInactiveException.class);
    }

    @Test
    void uncanonicalizableIdentityEmailIsNotFoundNotBadRequest() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("not an email", true);

        assertThatThrownBy(() -> accept().execute(INVITEE, created.id()))
                .isInstanceOf(InvitationNotFoundException.class);
        assertThat(listMine().execute(INVITEE).items()).isEmpty();
    }

    @Test
    void anAcceptedInvitationIsGoneOnceTheCallerLeftOrTheWorkspaceIsDeleted() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        invitee("an@example.com", true);
        accept().execute(INVITEE, created.id());
        assertThat(accept().execute(INVITEE, created.id())).isEqualTo(WORKSPACE);

        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, INVITEE)).thenReturn(false);
        assertThatThrownBy(() -> accept().execute(INVITEE, created.id())).isInstanceOf(InvitationGoneException.class);

        when(memberships.existsByWorkspaceIdAndUserId(WORKSPACE, INVITEE)).thenReturn(true);
        when(workspaces.findById(WORKSPACE)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> accept().execute(INVITEE, created.id())).isInstanceOf(InvitationGoneException.class);
    }

    @Test
    void listIsCappedAtFiftyAndLooksUpWorkspacesInOneBatch() {
        for (int i = 0; i < 60; i++) {
            invitations.save(WorkspaceInvitation.pending(UUID.randomUUID(), "an@example.com", OWNER, T0));
        }
        invitee("an@example.com", true);
        org.mockito.Mockito.doReturn(List.of()).when(workspaces).findAllByIds(any());

        assertThat(listMine().execute(INVITEE).items()).isEmpty();
        verify(workspaces, org.mockito.Mockito.times(1)).findAllByIds(any());
        verify(workspaces, org.mockito.Mockito.never()).findById(any());
    }

    @Test
    void nonOwnerRevokeIsRefusedBeforeTheWorkspaceLockIsTaken() {
        OwnerInvitationView created = create().execute(WORKSPACE, OWNER, "an@example.com");
        boolean[] locked = {false};
        RevokeInvitationUseCase revoke =
                new RevokeInvitationUseCase(memberships, invitations, tx, id -> locked[0] = true, clock);

        assertThatThrownBy(() -> revoke.execute(WORKSPACE, MEMBER, created.id())).isInstanceOf(ForbiddenException.class);
        assertThat(locked[0]).isFalse();
    }
}
