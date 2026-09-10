package com.weav.identity.infrastructure.config;

import com.weav.identity.application.dto.OAuthConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;


@SpringBootTest(
        classes = OAuthApplicationConfig.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE
)
@TestPropertySource(locations = "file:src/main/resources/application.properties")
class OAuthEnvironmentBindingTest {

    @Autowired
    private OAuthConfiguration configuration;

    @DynamicPropertySource
    static void environment(DynamicPropertyRegistry registry) {
        registry.add("GOOGLE_CLIENT_ID", () -> "google-client-id.apps.googleusercontent.com");
        registry.add("GOOGLE_CLIENT_SECRET", () -> "provider-secret-value");
        registry.add("GOOGLE_REDIRECT_URI", () ->
                "http://localhost:8081/auth/oauth/google/callback");
        registry.add("OAUTH_WEB_RETURN_TARGET_URI", () ->
                "http://localhost:5173/auth/callback");
        registry.add("OAUTH_WEB_ALLOWED_ORIGIN", () -> "http://localhost:5173");
    }

    @Test
    void existingEnvironmentNamesBindThroughProductionApplicationProperties() {
        var registration = configuration.webClient().orElseThrow();

        assertTrue(configuration.enabled());
        assertEquals(
                "http://localhost:8081/auth/oauth/google/callback",
                registration.providerCallbackUri().toString());
        assertEquals(
                "http://localhost:5173/auth/callback",
                registration.returnTargetUri().toString());
        assertTrue(registration.allowsOrigin("http://localhost:5173"));
    }

}
