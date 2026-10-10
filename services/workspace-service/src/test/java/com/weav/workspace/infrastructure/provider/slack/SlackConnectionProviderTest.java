package com.weav.workspace.infrastructure.provider.slack;

import com.weav.workspace.application.dto.ConnectionTestResult.ConnectionTestOutcome;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SlackConnectionProviderTest {

    private final SlackConnectionProvider provider = new SlackConnectionProvider();

    private static Connection connection() {
        return Connection.createNew(UUID.randomUUID(), UUID.randomUUID(), "Alerts",
                ConnectionProvider.SLACK, ConnectionAuthType.TOKEN, Map.of());
    }

    @Test
    void storedWebhookShapeDecidesTheOutcome() {
        assertEquals(ConnectionTestOutcome.VERIFIED, provider.test(connection(),
                Map.of("token", "https://hooks.slack.com/services/T01/B01/abc")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection(),
                Map.of("token", "https://hooks.slack.com.evil.test/services/T01/B01/abc")).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, provider.test(connection(), Map.of()).outcome());
    }

    @Test
    void rejectsWrongAuthTypeAndUnexpectedConfig() {
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.BASIC, Map.of()));
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.TOKEN, Map.of("url", "x")));
    }
}
