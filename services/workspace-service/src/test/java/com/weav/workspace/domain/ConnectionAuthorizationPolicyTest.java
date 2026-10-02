package com.weav.workspace.domain;

import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectionAuthorizationPolicyTest {

    private final ConnectionProviderPolicy providerPolicy = new ConnectionProviderPolicy();
    private final ConnectionAuthorizationPolicy authorizationPolicy = new ConnectionAuthorizationPolicy();
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID otherWorkspaceId = UUID.randomUUID();
    private final UUID ownerId = UUID.randomUUID();
    private final UUID memberId = UUID.randomUUID();
    private final UUID otherMemberId = UUID.randomUUID();

    @Test
    void acceptsEveryAllowedProviderAndAuthTypeCombination() {
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.GOOGLE_SHEETS, ConnectionAuthType.OAUTH2))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.HTTP, ConnectionAuthType.NONE))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.HTTP, ConnectionAuthType.API_KEY))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.HTTP, ConnectionAuthType.TOKEN))
                .doesNotThrowAnyException();
        assertThatCode(() -> providerPolicy.validate(ConnectionProvider.HTTP, ConnectionAuthType.BASIC))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsEveryInvalidProviderAndAuthTypeCombination() {
        for (ConnectionProvider provider : ConnectionProvider.values()) {
            for (ConnectionAuthType authType : ConnectionAuthType.values()) {
                if (isAllowed(provider, authType)) {
                    continue;
                }

                assertThatThrownBy(() -> providerPolicy.validate(provider, authType))
                        .isInstanceOf(BadRequestException.class);
            }
        }
    }

    @Test
    void onlyNoneAuthTypeDoesNotRequireCredential() {
        assertThat(providerPolicy.requiresCredential(ConnectionAuthType.NONE)).isFalse();
        assertThat(providerPolicy.requiresCredential(ConnectionAuthType.OAUTH2)).isTrue();
        assertThat(providerPolicy.requiresCredential(ConnectionAuthType.API_KEY)).isTrue();
        assertThat(providerPolicy.requiresCredential(ConnectionAuthType.TOKEN)).isTrue();
        assertThat(providerPolicy.requiresCredential(ConnectionAuthType.BASIC)).isTrue();
    }

    @Test
    void ownerCanManageAttachAndViewConfigForAnyConnectionInTheirWorkspace() {
        Membership owner = Membership.owner(workspaceId, ownerId);
        Connection connection = connection(workspaceId, otherMemberId);

        assertThat(authorizationPolicy.canManageIgnoringUsage(owner, connection)).isTrue();
        assertThat(authorizationPolicy.canAttach(owner, connection)).isTrue();
        assertThat(authorizationPolicy.canViewConfig(owner, connection)).isTrue();
    }

    @Test
    void memberCanManageAttachAndViewConfigForTheirOwnConnection() {
        Membership member = Membership.member(workspaceId, memberId);
        Connection connection = connection(workspaceId, memberId);

        assertThat(authorizationPolicy.canManageIgnoringUsage(member, connection)).isTrue();
        assertThat(authorizationPolicy.canAttach(member, connection)).isTrue();
        assertThat(authorizationPolicy.canViewConfig(member, connection)).isTrue();
    }

    @Test
    void memberCannotManageAttachOrViewAnotherMembersConnection() {
        Membership member = Membership.member(workspaceId, memberId);
        Connection connection = connection(workspaceId, otherMemberId);

        assertThat(authorizationPolicy.canManageIgnoringUsage(member, connection)).isFalse();
        assertThat(authorizationPolicy.canAttach(member, connection)).isFalse();
        assertThat(authorizationPolicy.canViewConfig(member, connection)).isFalse();
    }

    @Test
    void workspaceMismatchRejectsOwnerAndMemberAuthorization() {
        Connection connection = connection(otherWorkspaceId, memberId);

        assertThat(authorizationPolicy.canManageIgnoringUsage(
                Membership.owner(workspaceId, ownerId), connection)).isFalse();
        assertThat(authorizationPolicy.canAttach(
                Membership.owner(workspaceId, ownerId), connection)).isFalse();
        assertThat(authorizationPolicy.canViewConfig(
                Membership.owner(workspaceId, ownerId), connection)).isFalse();

        assertThat(authorizationPolicy.canManageIgnoringUsage(
                Membership.member(workspaceId, memberId), connection)).isFalse();
        assertThat(authorizationPolicy.canAttach(
                Membership.member(workspaceId, memberId), connection)).isFalse();
        assertThat(authorizationPolicy.canViewConfig(
                Membership.member(workspaceId, memberId), connection)).isFalse();
    }

    private static boolean isAllowed(ConnectionProvider provider, ConnectionAuthType authType) {
        return switch (provider) {
            case GMAIL, GOOGLE_SHEETS -> authType == ConnectionAuthType.OAUTH2;
            case TELEGRAM -> authType == ConnectionAuthType.TOKEN;
            case HTTP -> authType == ConnectionAuthType.NONE
                    || authType == ConnectionAuthType.API_KEY
                    || authType == ConnectionAuthType.TOKEN
                    || authType == ConnectionAuthType.BASIC;
        };
    }

    private static Connection connection(UUID workspaceId, UUID createdBy) {
        return Connection.createNew(
                workspaceId,
                createdBy,
                "Connection",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                Map.of());
    }
}
