package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PasswordChangeHttpIntegrationTest {

    private static final String OLD_PASSWORD = "correct-horse-battery-staple";
    private static final String NEW_PASSWORD = "replacement-horse-battery-staple";

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void changesPasswordAndRevokesEveryExistingSessionOverRealHttp() throws Exception {
        String email = "password." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        assertEquals(401, post(
                "/auth/change-password",
                null,
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD)
        ).statusCode());
        register(email);
        TokenResponse first = login(email, OLD_PASSWORD);
        TokenResponse second = login(email, OLD_PASSWORD);

        HttpResponse<String> malformed = post(
                "/auth/change-password",
                first.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", "short")
        );
        assertEquals(400, malformed.statusCode());
        assertEquals(400, post(
                "/auth/change-password",
                first.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", "é".repeat(37))
        ).statusCode());
        assertEquals(400, postRaw(
                "/auth/change-password",
                first.accessToken(),
                "{\"currentPassword\":\"" + OLD_PASSWORD + "\",\"newPassword\":\""
                        + NEW_PASSWORD + "\",\"status\":\"ACTIVE\"}"
        ).statusCode());

        HttpResponse<String> wrongPassword = post(
                "/auth/change-password",
                first.accessToken(),
                Map.of("currentPassword", "wrong-password", "newPassword", NEW_PASSWORD)
        );
        assertGenericUnauthorized(wrongPassword);

        HttpResponse<String> changed = post(
                "/auth/change-password",
                first.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD)
        );
        assertEquals(204, changed.statusCode());
        assertTrue(changed.body().isEmpty());

        assertEquals(401, get("/users/me", first.accessToken()).statusCode());
        assertEquals(401, get("/users/me", second.accessToken()).statusCode());
        assertEquals(401, post("/auth/refresh", null, Map.of("refreshToken", first.refreshToken())).statusCode());
        assertEquals(401, post("/auth/refresh", null, Map.of("refreshToken", second.refreshToken())).statusCode());
        assertGenericUnauthorized(loginResponse(email, OLD_PASSWORD));
        assertEquals(200, loginResponse(email, NEW_PASSWORD).statusCode());
    }

    @Test
    void returnsGenericUnauthorizedForOAuthOnlyOrRevokedCurrentSession() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String oauthOnlyEmail = "oauth-password." + suffix + "@example.com";
        UserResponse oauthOnly = register(oauthOnlyEmail);
        TokenResponse oauthOnlySession = login(oauthOnlyEmail, OLD_PASSWORD);
        jdbcTemplate.update("update identity.users set password_hash = null where id = ?", oauthOnly.id());
        assertGenericUnauthorized(post(
                "/auth/change-password",
                oauthOnlySession.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD)
        ));

        String revokedEmail = "revoked-password." + suffix + "@example.com";
        register(revokedEmail);
        TokenResponse revoked = login(revokedEmail, OLD_PASSWORD);
        assertEquals(204, post("/auth/logout", null, Map.of("refreshToken", revoked.refreshToken())).statusCode());
        assertGenericUnauthorized(post(
                "/auth/change-password",
                revoked.accessToken(),
                Map.of("currentPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD)
        ));
    }

    private UserResponse register(String email) throws Exception {
        HttpResponse<String> response = post("/auth/register", null, Map.of(
                "email", email,
                "password", OLD_PASSWORD,
                "displayName", "Password Test"
        ));
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email, String password) throws Exception {
        HttpResponse<String> response = loginResponse(email, password);
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private HttpResponse<String> loginResponse(String email, String password) throws Exception {
        return post("/auth/login", null, Map.of("email", email, "password", password));
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .GET()
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String accessToken, Object body) throws Exception {
        return postRaw(path, accessToken, objectMapper.writeValueAsString(body));
    }

    private HttpResponse<String> postRaw(String path, String accessToken, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json");
        if (accessToken != null) {
            request.header("Authorization", "Bearer " + accessToken);
        }
        return httpClient.send(
                request.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString()
        );
    }

    private void assertGenericUnauthorized(HttpResponse<String> response) throws Exception {
        assertEquals(401, response.statusCode());
        JsonNode error = objectMapper.readTree(response.body()).get("error");
        assertEquals("UNAUTHORIZED", error.get("code").asText());
        assertEquals("Authentication failed", error.get("message").asText());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }
}
