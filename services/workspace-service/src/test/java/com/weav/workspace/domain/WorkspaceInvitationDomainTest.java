package com.weav.workspace.domain;

import com.weav.workspace.domain.exception.InvitationNotPendingException;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.valueobject.InvitationStatus;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkspaceInvitationDomainTest {

    private static final Instant NOW = Instant.parse("2026-10-10T00:00:00Z");

    private WorkspaceInvitation pending() {
        return WorkspaceInvitation.pending(UUID.randomUUID(), "a@example.com", UUID.randomUUID(), NOW);
    }

    @Test
    void pendingInvitationIsLiveForSevenDaysThenReadsExpired() {
        WorkspaceInvitation invitation = pending();

        assertThat(invitation.getExpiresAt()).isEqualTo(NOW.plus(Duration.ofDays(7)));
        assertThat(invitation.isLive(NOW.plus(Duration.ofDays(7)).minusSeconds(1))).isTrue();
        assertThat(invitation.viewStatus(NOW)).isEqualTo("PENDING");
        assertThat(invitation.isLive(NOW.plus(Duration.ofDays(7)))).isFalse();
        assertThat(invitation.viewStatus(NOW.plus(Duration.ofDays(7)))).isEqualTo("EXPIRED");
        assertThat(invitation.getStatus()).isEqualTo(InvitationStatus.PENDING);
    }

    @Test
    void acceptDeclineAndRevokeWorkOnlyFromPending() {
        UUID user = UUID.randomUUID();
        WorkspaceInvitation accepted = pending();
        accepted.accept(user, NOW);
        assertThat(accepted.getStatus()).isEqualTo(InvitationStatus.ACCEPTED);
        assertThat(accepted.getRespondedBy()).isEqualTo(user);
        assertThatThrownBy(() -> accepted.decline(user, NOW)).isInstanceOf(InvitationNotPendingException.class);
        assertThatThrownBy(() -> accepted.revoke(NOW)).isInstanceOf(InvitationNotPendingException.class);
        assertThatThrownBy(() -> accepted.resend(NOW)).isInstanceOf(InvitationNotPendingException.class);

        WorkspaceInvitation declined = pending();
        declined.decline(user, NOW);
        assertThat(declined.getStatus()).isEqualTo(InvitationStatus.DECLINED);

        WorkspaceInvitation revoked = pending();
        revoked.revoke(NOW);
        assertThat(revoked.getStatus()).isEqualTo(InvitationStatus.REVOKED);
        assertThat(revoked.viewStatus(NOW)).isEqualTo("REVOKED");
    }

    @Test
    void resendResetsSendTimeAndExpiry() {
        WorkspaceInvitation invitation = pending();
        Instant later = NOW.plus(Duration.ofMinutes(11));

        invitation.resend(later);

        assertThat(invitation.getLastSentAt()).isEqualTo(later);
        assertThat(invitation.getExpiresAt()).isEqualTo(later.plus(Duration.ofDays(7)));
    }
}
