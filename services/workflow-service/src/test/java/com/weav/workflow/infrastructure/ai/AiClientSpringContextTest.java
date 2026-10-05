package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiClientSpringContextTest {

    @Test
    void generateExecutorIsRegisteredAndItsCallsGoThroughTheQuotaBearingClient() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("ai-test", Map.of(
                    "weav.workflow.ai.enabled", "true",
                    "weav.workflow.ai.base-url", "http://ai-service:3000",
                    "weav.workflow.ai.connect-timeout", "5s",
                    "weav.workflow.ai.read-timeout", "65s",
                    "weav.workflow.ai.token-lifetime", "90s",
                    "weav.workflow.ai.max-response-bytes", "1048576")));
            AiQuota quota = Mockito.mock(AiQuota.class);
            context.getBeanFactory().registerSingleton("objectMapper", new ObjectMapper());
            context.getBeanFactory().registerSingleton("aiQuota", quota);
            context.register(AiClientConfiguration.class, AiClient.class, NodeExecutorRegistry.class);
            context.refresh();

            NodeExecutor generate = context.getBean(NodeExecutorRegistry.class).require("ai.generate");
            assertSame(context.getBean("aiGenerateExecutor"), generate);

            UUID workspace = UUID.randomUUID();
            NodeExecutor.Context nodeContext = new NodeExecutor.Context(
                    workspace, UUID.randomUUID(), UUID.randomUUID(), "node", 1, null, null);
            // Signing is not configured here, so the call fails after the quota step and before any HTTP request.
            assertThrows(NodeExecutor.Failure.class, () -> generate.execute(nodeContext, Map.of("prompt", "p")));
            Mockito.verify(quota).consume(workspace);
        }
    }
}
