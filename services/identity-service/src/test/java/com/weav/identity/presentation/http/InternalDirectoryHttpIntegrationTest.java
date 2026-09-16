package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.security.InternalServiceKeyFilter;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        "weav.internal.service-key=test-directory-key",
        "server.servlet.context-path=/identity"
})
class InternalDirectoryHttpIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-01-02T03:04:05Z");

    @LocalServerPort
    private int port;

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccessTokenIssuer accessTokenIssuer;

    @Autowired
    private FilterRegistrationBean<InternalServiceKeyFilter> internalServiceKeyFilterRegistration;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void internalKeyProtectsDirectoryAndPublicBearerCannotBypassIt() throws Exception {
        assertFalse(internalServiceKeyFilterRegistration.isEnabled());
        User user = userRepository.save(user(
                UUID.randomUUID(), "directory@example.com", "Directory User", UserStatus.ACTIVE));
        String body = objectMapper.writeValueAsString(Map.of("email", " DIRECTORY@example.COM "));

        HttpResponse<String> withoutKey = post("/internal/directory/users/by-email", body, null);
        assertEquals(401, withoutKey.statusCode());

        String validJwt = accessTokenIssuer.issue(
                user.getId(), UUID.randomUUID(), SystemRole.USER, UserStatus.ACTIVE).value();
        HttpResponse<String> publicBearerOnly = post(
                "/internal/directory/users/by-email", body, null, "Bearer " + validJwt);
        assertEquals(401, publicBearerOnly.statusCode());

        HttpResponse<String> wrongKey = post("/internal/directory/users/by-email", body, "wrong-key");
        assertEquals(401, wrongKey.statusCode());

        HttpResponse<String> withKey = post("/internal/directory/users/by-email", body, "test-directory-key");
        assertEquals(200, withKey.statusCode());
        JsonNode response = objectMapper.readTree(withKey.body());
        assertEquals(user.getId().toString(), response.get("userId").asText());
        assertEquals("Directory User", response.get("displayName").asText());

        // The key filter is evaluated before bearer authentication; the explicit
        // no-key assertion above is the fail-closed bearer bypass proof.
        assertFalse(withoutKey.body().contains("Directory User"));
    }

    @Test
    void lookupReturnsInactiveSummaryAndSearchIsCandidateBounded() throws Exception {
        UUID inactiveId = UUID.randomUUID();
        UUID outsideId = UUID.randomUUID();
        User inactive = user(inactiveId, "inactive@example.com", "Target", UserStatus.DISABLED);
        userRepository.save(inactive);
        userRepository.save(user(outsideId, "outside@example.com", "Target", UserStatus.ACTIVE));

        HttpResponse<String> lookup = post(
                "/internal/directory/users/by-email",
                objectMapper.writeValueAsString(Map.of("email", "inactive@example.com")),
                "test-directory-key");
        assertEquals(200, lookup.statusCode());
        assertFalse(objectMapper.readTree(lookup.body()).get("active").asBoolean());

        HttpResponse<String> invalidEmail = post(
                "/internal/directory/users/by-email",
                objectMapper.writeValueAsString(Map.of("email", "user name@example.com")),
                "test-directory-key");
        assertEquals(400, invalidEmail.statusCode());

        String searchBody = objectMapper.writeValueAsString(Map.of(
                "candidateUserIds", java.util.List.of(inactiveId.toString()),
                "search", "target",
                "page", 0,
                "size", 20,
                "direction", "asc"));
        HttpResponse<String> search = post(
                "/internal/directory/users/search", searchBody, "test-directory-key");
        assertEquals(200, search.statusCode());
        JsonNode items = objectMapper.readTree(search.body()).get("items");
        assertEquals(1, items.size());
        assertEquals(inactiveId.toString(), items.get(0).get("userId").asText());
    }

    private HttpResponse<String> post(String path, String body, String key) throws Exception {
        return post(path, body, key, null);
    }

    private HttpResponse<String> post(String path, String body, String key, String authorization)
            throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json");
        if (key != null) {
            builder.header("X-Internal-Service-Key", key);
        }
        if (authorization != null) {
            builder.header("Authorization", authorization);
        }
        return httpClient.send(
                builder.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + "/identity" + path);
    }

    private static User user(UUID id, String email, String displayName, UserStatus status) {
        return new User(
                id,
                email,
                "hash",
                displayName,
                null,
                SystemRole.USER,
                status,
                NOW,
                NOW);
    }
}
