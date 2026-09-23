package com.weav.workflow.application.node;

import com.weav.workflow.application.port.in.TelegramTriggerIngress;
import com.weav.workflow.application.service.TriggerDependencyUnavailableException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UnavailableNodeExecutorTest {

    @ParameterizedTest
    @ValueSource(strings = {"email.send", "telegram.send_message", "ai.extract", "ai.classify", "ai.summarize"})
    void registryProvidesAnExplicitNonRetryableFailureForUnavailableIntegrations(String type) {
        NodeExecutor executor = new NodeExecutorRegistry().executors().get(type);

        assertNotNull(executor, "the node type should have an explicit unavailable adapter");
        assertEquals(type, executor.type());
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(new NodeExecutor.Context(
                        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "node", 1, null, null), Map.of()));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", failure.code());
        assertFalse(failure.retryable());
    }

    @ParameterizedTest
    @ValueSource(strings = {"email.send", "telegram.send_message", "ai.extract", "ai.classify",
            "ai.summarize", "trigger.telegram"})
    void readinessDoesNotLetNodeConfigurationEnableUnavailableIntegrations(String type) {
        IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType(type);

        assertFalse(readiness.configured());
        assertEquals("DEPENDENCY_NOT_CONFIGURED", readiness.reasonCode());
    }

    @Test
    void manualTriggerRemainsReady() {
        IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType("trigger.manual");

        assertTrue(readiness.configured());
    }

    @Test
    void unconfiguredTelegramIngressFailsWithoutAdmittingAnExecution() {
        assertThrows(TriggerDependencyUnavailableException.class,
                () -> TelegramTriggerIngress.unconfigured().accept(UUID.randomUUID(), Map.of("safe", true)));
    }
}
