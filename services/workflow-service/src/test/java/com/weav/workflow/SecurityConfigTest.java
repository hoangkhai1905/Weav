package com.weav.workflow;

import com.weav.workflow.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Import({TestcontainersConfiguration.class, SecurityConfigTest.TestControllerConfiguration.class})
class SecurityConfigTest {

    @Autowired
    private WebApplicationContext webApplicationContext;

    private MockMvc mockMvc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtProperties jwtProperties;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void protectsTheScaffoldAuthRouteBecauseWorkflowOwnsNoAuthEndpoints() throws Exception {
        mockMvc.perform(get("/auth/ping"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void allowsPublicHealthRoute() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    void protectsRoutesByDefault() throws Exception {
        mockMvc.perform(get("/protected"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsHttpBasicAuthentication() throws Exception {
        mockMvc.perform(get("/protected").header("Authorization", "Basic dGVzdDp0ZXN0"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void exposesBcryptPasswordEncoder() {
        String encodedPassword = passwordEncoder.encode("test-password");

        assertTrue(encodedPassword.startsWith("$2"));
        assertTrue(passwordEncoder.matches("test-password", encodedPassword));
    }

    @Test
    void bindsJwtConfigurationProperties() {
        assertEquals("weav-identity", jwtProperties.issuer());
        assertEquals("weav-api", jwtProperties.audience());
        assertEquals("workflow-test-access-secret-with-at-least-32-utf8-bytes", jwtProperties.accessSecret());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestControllerConfiguration {

        @Bean
        TestSecurityController testSecurityController() {
            return new TestSecurityController();
        }
    }

    @RestController
    static class TestSecurityController {

        @GetMapping("/auth/ping")
        String authPing() {
            return "ok";
        }

        @GetMapping("/protected")
        String protectedRoute() {
            return "protected";
        }
    }
}
