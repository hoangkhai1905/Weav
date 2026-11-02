package com.weav.workflow.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.ResourcePropertySource;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The deployed container gets both WORKFLOW_INTERNAL_SERVICE_KEY (the key Workspace sends) and
 * WEAV_INTERNAL_SERVICE_KEY (the key this service sends to Workspace). Spring maps an environment
 * variable onto a property whose name has the same letters, so the property read by
 * InternalServiceKeyFilter must not be spelled like either variable.
 */
class InternalServiceKeyPropertyTest {

    @Test
    void inboundKeyComesFromWorkflowVariableEvenWhenTheOutboundVariableIsSet() throws Exception {
        StandardEnvironment environment = new StandardEnvironment();
        MutablePropertySources sources = environment.getPropertySources();
        sources.replace(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                new SystemEnvironmentPropertySource(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                        Map.of("WORKFLOW_INTERNAL_SERVICE_KEY", "inbound-key",
                                "WEAV_INTERNAL_SERVICE_KEY", "outbound-key")));
        // The production file, not the test one on the classpath (that one hard-codes a test key).
        sources.addLast(new ResourcePropertySource(new FileSystemResource("src/main/resources/application.properties")));

        String resolved = environment.resolvePlaceholders("${" + SecurityConfig.INBOUND_SERVICE_KEY_PROPERTY + ":}");

        assertEquals("inbound-key", resolved);
    }
}
