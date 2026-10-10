package com.weav.workspace.infrastructure.provider.teams;

import com.weav.workspace.application.dto.ConnectionTestResult.ConnectionTestOutcome;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TeamsConnectionProviderTest {

    private final TeamsConnectionProvider provider = new TeamsConnectionProvider();

    private static Connection connection() {
        return Connection.createNew(UUID.randomUUID(), UUID.randomUUID(), "Alerts",
                ConnectionProvider.TEAMS, ConnectionAuthType.TOKEN, Map.of());
    }

    @Test
    void storedWebhookShapeDecidesTheOutcome() {
        assertEquals(ConnectionTestOutcome.VERIFIED, provider.test(connection(),
                Map.of("token", "https://x.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=s")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection(),
                Map.of("token", "https://x.logic.azure.com.evil.test/workflows/a/triggers/manual/paths/invoke?sig=s")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection(), Map.of()).outcome());
    }

    @Test
    void rejectsWrongAuthTypeAndUnexpectedConfig() {
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.BASIC, Map.of()));
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.TOKEN, Map.of("url", "x")));
    }
}
