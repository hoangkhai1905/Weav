package com.weav.workflow.application.node;

import com.weav.workflow.application.port.in.TelegramTriggerIngress;
import com.weav.workflow.application.service.TriggerDependencyUnavailableException;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class UnavailableNodeExecutorTest {

    @Test
    void everyCatalogActionHasAnExecutorSoNoTypeIsUnavailable() {
        assertTrue(UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES.isEmpty());
        assertThrows(IllegalArgumentException.class, () -> new UnavailableNodeExecutor("telegram.send_message"));
        assertNull(new NodeExecutorRegistry().executors().get("telegram.send_message"));
    }

    @Test
    void telegramTriggerIsReadyOnlyWithAnHttpsPublicBaseUrl() {
        for (String missing : new String[] {null, "", "  ", "http://weav.example.test", "ftp://weav.example.test",
                "weav.example.test", "https://", "https://user:pw@weav.example.test", "https://weav.example.test?x=1"}) {
            IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType("trigger.telegram", missing);
            assertFalse(readiness.configured(), String.valueOf(missing));
            assertEquals("DEPENDENCY_NOT_CONFIGURED", readiness.reasonCode());
        }
        assertFalse(IntegrationReadiness.forType("trigger.telegram").configured());
        assertTrue(IntegrationReadiness.forType("trigger.telegram", "https://weav.example.test").configured());
        assertTrue(IntegrationReadiness.forType("trigger.telegram", "https://weav.example.test:8443/").configured());
        assertEquals("https://weav.example.test", IntegrationReadiness.httpsBaseUrl(" https://weav.example.test// "));
        assertTrue(IntegrationReadiness.forType("telegram.send_message").configured());
    }

    @Test
    void manualTriggerRemainsReady() {
        IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType("trigger.manual");

        assertTrue(readiness.configured());
    }

    @Test
    void aiTypesAreNoLongerUnavailable() {
        assertThrows(IllegalArgumentException.class, () -> new UnavailableNodeExecutor("ai.extract"));
        assertThrows(IllegalArgumentException.class, () -> new UnavailableNodeExecutor("ai.classify"));
        assertThrows(IllegalArgumentException.class, () -> new UnavailableNodeExecutor("ai.summarize"));
    }

    @Test
    void unconfiguredTelegramIngressFailsWithoutAdmittingAnExecution() {
        assertThrows(TriggerDependencyUnavailableException.class,
                () -> TelegramTriggerIngress.unconfigured().accept(UUID.randomUUID(), Map.of("safe", true)));
    }
}
