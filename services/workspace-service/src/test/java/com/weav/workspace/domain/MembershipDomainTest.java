package com.weav.workspace.domain;

import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.model.Membership;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MembershipDomainTest {

    @Test
    void newMemberDefaultsOptionalPermissionsToFalse() {
        Membership membership = Membership.member(UUID.randomUUID(), UUID.randomUUID());

        assertThat(membership.isCanPublishWorkflow()).isFalse();
        assertThat(membership.isCanManageWorkflowState()).isFalse();
    }

    @Test
    void ownerPermissionsCannotBeUpdatedAsMemberPermissions() {
        Membership owner = Membership.owner(UUID.randomUUID(), UUID.randomUUID());

        assertThatThrownBy(() -> owner.updateOptionalPermissions(true, true))
                .isInstanceOf(InvalidStateException.class);
    }

    @Test
    void membersCanLeaveButOwnersCannot() {
        Membership member = Membership.member(UUID.randomUUID(), UUID.randomUUID());
        member.assertCanLeave();

        Membership owner = Membership.owner(UUID.randomUUID(), UUID.randomUUID());
        assertThatThrownBy(owner::assertCanLeave)
                .isInstanceOf(InvalidStateException.class);
    }
}
