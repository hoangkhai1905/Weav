package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiClientContractTest {
    @Test
    void disabledFailsClosedWithoutCallingAi() {
        AiClientProperties properties = new AiClientProperties(false, false, URI.create("http://ai.internal"),
                "", "", Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1), 1024);
        AiClient client = new AiClient(properties,
                new ServiceJwtSigner(new org.springframework.core.io.DefaultResourceLoader(), "", "", Duration.ofSeconds(1)),
                RestClient.builder().build(), new ObjectMapper(), Clock.systemUTC());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(new NodeExecutor.Context(UUID.randomUUID(), UUID.randomUUID(),
                        UUID.randomUUID(), "node", 1, null, null), "summarize", Map.of("text", "t")));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", failure.code());
        assertFalse(failure.retryable());
    }
}
