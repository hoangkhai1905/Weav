package com.weav.identity.infrastructure.config;

import com.weav.identity.application.dto.OAuthConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(
        classes = OAuthApplicationConfig.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE
)
@TestPropertySource(locations = "file:src/main/resources/application.properties")
class OAuthEnvironmentDisabledBindingTest {

    @Autowired
    private OAuthConfiguration configuration;

    @DynamicPropertySource
    static void emptyTemplateEnvironment(DynamicPropertyRegistry registry) {
        registry.add("GOOGLE_OAUTH_ENABLED", () -> "");
        registry.add("GOOGLE_CLIENT_ID", () -> "");
        registry.add("GOOGLE_CLIENT_SECRET", () -> "");
        registry.add("GOOGLE_REDIRECT_URI", () -> "");
        registry.add("OAUTH_WEB_RETURN_TARGET_URI", () -> "");
        registry.add("OAUTH_WEB_ALLOWED_ORIGIN", () -> "");
    }

    @Test
    void emptyEnvironmentTemplateValuesKeepOAuthDisabled() {
        assertFalse(configuration.enabled());
        assertTrue(configuration.webClient().isEmpty());
    }
}
