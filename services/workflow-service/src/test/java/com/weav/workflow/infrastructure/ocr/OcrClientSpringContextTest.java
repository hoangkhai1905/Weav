package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutorRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class OcrClientSpringContextTest {

    @Test
    void disabledOcrBeansInstantiateAndRegisterExecutorInSpringContext() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("ocr-test", Map.of(
                    "weav.workflow.ocr.base-url", "http://ocr-service:8000",
                    "weav.workflow.ocr.connect-timeout", "5s",
                    "weav.workflow.ocr.read-timeout", "30s",
                    "weav.workflow.ocr.token-lifetime", "60s",
                    "weav.workflow.ocr.max-response-bytes", "1048576")));
            context.getBeanFactory().registerSingleton("objectMapper", new ObjectMapper());
            context.register(
                    OcrClientConfiguration.class,
                    WorkflowServiceJwtIssuer.class,
                    OcrClient.class,
                    OcrNodeExecutor.class,
                    NodeExecutorRegistry.class);

            context.refresh();

            OcrClientProperties properties = context.getBean(OcrClientProperties.class);
            OcrNodeExecutor ocrExecutor = context.getBean(OcrNodeExecutor.class);
            NodeExecutorRegistry registry = context.getBean(NodeExecutorRegistry.class);

            assertNotNull(context.getBean(OcrClient.class));
            assertNotNull(context.getBean(WorkflowServiceJwtIssuer.class));
            assertFalse(properties.enabled());
            assertFalse(properties.urlSourceEnabled());
            assertFalse(properties.artifactSourceEnabled());
            assertFalse(properties.serviceClaimsVerified());
            assertFalse(properties.urlAllowlistVerified());
            assertFalse(properties.artifactResolverVerified());
            assertSame(ocrExecutor, registry.require("ocr.extract"));
        }
    }
}
