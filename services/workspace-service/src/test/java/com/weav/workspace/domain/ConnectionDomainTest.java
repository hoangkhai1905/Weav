package com.weav.workspace.domain;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectionDomainTest {

    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();

    @Test
    void newConnectionStartsDisabled() {
        Connection connection = Connection.createNew(
                WORKSPACE_ID,
                USER_ID,
                "Telegram",
                ConnectionProvider.TELEGRAM,
                ConnectionAuthType.TOKEN,
                Map.of());

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
    }

    @Test
    void normalizeNameTrimsCollapsesWhitespaceAndUsesRootLocale() {
        assertThat(Connection.normalizeName("  Telegram\t  Bot  "))
                .isEqualTo("telegram bot");
    }

    @Test
    void blankConnectionNamesAreRejected() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> Connection.normalizeName(" \t "));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> Connection.createNew(
                        WORKSPACE_ID,
                        USER_ID,
                        "",
                        ConnectionProvider.TELEGRAM,
                        ConnectionAuthType.TOKEN,
                        Map.of()));
    }

    @Test
    void renamePreservesDisplayCaseAndNormalizesWhitespace() {
        Connection connection = newConnection();

        connection.rename("  My\tTelegram  ");

        assertThat(connection.getName()).isEqualTo("My Telegram");
        assertThat(Connection.normalizeName(connection.getName())).isEqualTo("my telegram");
    }

    @Test
    void updateConfigReplacesConfigWithTopLevelUnmodifiableCopy() {
        Connection connection = newConnection();

        connection.updateConfig(Map.of("baseUrl", "https://example.test"));

        assertThat(connection.getConfig()).containsEntry("baseUrl", "https://example.test");
        assertThatThrownBy(() -> connection.getConfig().put("token", "secret"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void verifiedConnectionBecomesActive() {
        Connection connection = newConnection();

        Instant verifiedAt = Instant.parse("2026-09-14T08:00:00Z");
        connection.markVerified(verifiedAt);

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.ACTIVE);
        assertThat(connection.getLastVerifiedAt()).isEqualTo(verifiedAt);
    }

    @Test
    void nullVerificationTimestampDoesNotMutateDisabledConnection() {
        Connection connection = newConnection();
        Instant updatedAtBefore = connection.getUpdatedAt();

        assertThatThrownBy(() -> connection.markVerified(null))
                .isInstanceOf(NullPointerException.class);

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
        assertThat(connection.getLastVerifiedAt()).isNull();
        assertThat(connection.getUpdatedAt()).isEqualTo(updatedAtBefore);
    }

    @Test
    void nullVerificationTimestampDoesNotMutateInvalidConnection() {
        Connection connection = newConnection();
        Instant previousVerifiedAt = Instant.parse("2026-09-14T08:00:00Z");
        connection.markVerified(previousVerifiedAt);
        connection.markInvalid();
        Instant updatedAtBefore = connection.getUpdatedAt();

        assertThatThrownBy(() -> connection.markVerified(null))
                .isInstanceOf(NullPointerException.class);

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.INVALID);
        assertThat(connection.getLastVerifiedAt()).isEqualTo(previousVerifiedAt);
        assertThat(connection.getUpdatedAt()).isEqualTo(updatedAtBefore);
    }

    @Test
    void invalidConnectionBecomesInvalid() {
        Connection connection = newConnection();

        connection.markInvalid();

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.INVALID);
    }

    @Test
    void credentialReplacementCanDisableActiveConnection() {
        Connection connection = activeConnection();

        connection.markDisabled();

        assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
    }

    private static Connection newConnection() {
        return Connection.createNew(
                WORKSPACE_ID,
                USER_ID,
                "Telegram",
                ConnectionProvider.TELEGRAM,
                ConnectionAuthType.TOKEN,
                Map.of());
    }

    private static Connection activeConnection() {
        Connection connection = newConnection();
        connection.markVerified(Instant.parse("2026-09-14T08:00:00Z"));
        return connection;
    }
}
