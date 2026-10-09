package com.weav.workspace.infrastructure.provider.discord;

import com.weav.workspace.application.dto.ConnectionTestResult.ConnectionTestOutcome;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class DiscordConnectionProviderTest {

    @Test
    void classifiesWebhookStatuses() {
        assertEquals(ConnectionTestOutcome.VERIFIED, DiscordConnectionProvider.classify(200).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, DiscordConnectionProvider.classify(401).outcome());
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, DiscordConnectionProvider.classify(404).outcome());
        assertEquals(ConnectionTestOutcome.DEPENDENCY_FAILURE, DiscordConnectionProvider.classify(429).outcome());
        assertEquals(ConnectionTestOutcome.DEPENDENCY_FAILURE, DiscordConnectionProvider.classify(503).outcome());
    }

    private static com.weav.workspace.domain.model.Connection connection() {
        return com.weav.workspace.domain.model.Connection.createNew(
                java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), "Alerts",
                com.weav.workspace.domain.valueobject.ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN, Map.of());
    }

    @Test
    void nonMatchingStoredUrlIsAuthInvalidWithoutAnyRequest() {
        var validator = org.mockito.Mockito.mock(com.weav.workspace.infrastructure.provider.http.HttpTargetValidator.class);
        var transport = org.mockito.Mockito.mock(com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport.class);
        var result = new DiscordConnectionProvider(validator, transport).test(
                connection(), Map.of("token", "https://discord.com.evil.test/api/webhooks/1/x"));
        assertEquals(ConnectionTestOutcome.AUTH_INVALID, result.outcome());
        org.mockito.Mockito.verifyNoInteractions(validator, transport);
    }

    @Test
    void unreachableWebhookIsADependencyFailure() {
        var validator = org.mockito.Mockito.mock(com.weav.workspace.infrastructure.provider.http.HttpTargetValidator.class);
        var transport = org.mockito.Mockito.mock(com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport.class);
        org.mockito.Mockito.when(validator.validateAndResolve(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new com.weav.workspace.domain.exception.DependencyUnavailableException());
        var result = new DiscordConnectionProvider(validator, transport).test(
                connection(), Map.of("token", "https://discord.com/api/webhooks/1/x"));
        assertEquals(ConnectionTestOutcome.DEPENDENCY_FAILURE, result.outcome());
    }

    @Test
    void rejectsWrongAuthTypeAndUnexpectedConfig() {
        DiscordConnectionProvider provider = new DiscordConnectionProvider(
                new com.weav.workspace.infrastructure.provider.http.HttpTargetValidator(),
                new com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport());
        assertThrows(RuntimeException.class, () -> provider.validateConfig(ConnectionAuthType.BASIC, Map.of()));
        assertThrows(RuntimeException.class, () -> provider.validateConfig(
                ConnectionAuthType.TOKEN, Map.of("url", "x")));
    }
}
