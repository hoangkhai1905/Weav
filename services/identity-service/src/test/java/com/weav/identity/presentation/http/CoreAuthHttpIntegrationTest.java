package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;

import static java.time.temporal.ChronoUnit.MILLIS;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CoreAuthHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void completesRegisterLoginCurrentUserRefreshAndLogoutOverRealHttp() throws Exception {
        String unique = UUID.randomUUID().toString().substring(0, 8);
        String canonicalEmail = "core." + unique + "@example.com";

        HttpResponse<String> registered = post(
                "/auth/register",
                Map.of(
                        "email", "  CORE." + unique + "@Example.COM  ",
                        "password", PASSWORD,
                        "displayName", "Core Auth"
                )
        );
        assertEquals(201, registered.statusCode());
        UserResponse registeredUser = objectMapper.readValue(registered.body(), UserResponse.class);
        assertEquals(canonicalEmail, registeredUser.email());
        assertEquals("/users/" + registeredUser.id(), registered.headers().firstValue("Location").orElseThrow());
        assertPublicOnly(registered.body());

        HttpResponse<String> duplicate = post(
                "/auth/register",
                Map.of("email", " " + canonicalEmail.toUpperCase() + " ", "password", PASSWORD)
        );
        assertEquals(409, duplicate.statusCode());

        HttpResponse<String> privilegedRegistration = post(
                "/auth/register",
                Map.of(
                        "email", "privileged." + unique + "@example.com",
                        "password", PASSWORD,
                        "systemRole", "ADMIN"
                )
        );
        assertEquals(400, privilegedRegistration.statusCode());

        HttpResponse<String> wrongPassword = post(
                "/auth/login",
                Map.of("email", canonicalEmail, "password", "wrong-password")
        );
        assertEquals(401, wrongPassword.statusCode());
        JsonNode wrongPasswordError = objectMapper.readTree(wrongPassword.body());
        assertEquals("UNAUTHORIZED", wrongPasswordError.get("error").get("code").asText());
        assertEquals("Authentication failed", wrongPasswordError.get("error").get("message").asText());

        HttpResponse<String> login = post(
                "/auth/login",
                Map.of("email", canonicalEmail, "password", PASSWORD)
        );
        assertEquals(200, login.statusCode());
        assertEquals("no-store", login.headers().firstValue("Cache-Control").orElseThrow());
        TokenResponse firstPair = objectMapper.readValue(login.body(), TokenResponse.class);
        assertEquals("Bearer", firstPair.tokenType());
        assertEquals(registeredUser.id(), firstPair.user().id());
        assertNotNull(firstPair.accessToken());
        assertNotNull(firstPair.refreshToken());
        assertPublicOnly(login.body());

        String firstStoredHash = storedRefreshHash(registeredUser.id());
        assertNotEquals(firstPair.refreshToken(), firstStoredHash);
        assertTrue(firstStoredHash.matches("[0-9a-f]{64}"));
        assertFalse(login.body().contains(firstStoredHash));

        HttpResponse<String> currentUser = get("/users/me", firstPair.accessToken());
        assertEquals(200, currentUser.statusCode());
        assertEquals(registeredUser.id(), objectMapper.readValue(currentUser.body(), UserResponse.class).id());

        HttpResponse<String> refreshed = post(
                "/auth/refresh",
                Map.of("refreshToken", firstPair.refreshToken())
        );
        assertEquals(200, refreshed.statusCode());
        assertEquals("no-store", refreshed.headers().firstValue("Cache-Control").orElseThrow());
        TokenResponse secondPair = objectMapper.readValue(refreshed.body(), TokenResponse.class);
        assertEquals(firstPair.user().id(), secondPair.user().id());
        assertEquals(
                firstPair.refreshExpiresAt().truncatedTo(MILLIS),
                secondPair.refreshExpiresAt().truncatedTo(MILLIS)
        );
        assertNotEquals(firstPair.refreshToken(), secondPair.refreshToken());
        assertNotEquals(firstPair.accessToken(), secondPair.accessToken());
        assertNotEquals(firstStoredHash, storedRefreshHash(registeredUser.id()));

        assertEquals(
                401,
                post("/auth/refresh", Map.of("refreshToken", firstPair.refreshToken())).statusCode()
        );

        HttpResponse<String> logout = post(
                "/auth/logout",
                Map.of("refreshToken", secondPair.refreshToken())
        );
        assertEquals(204, logout.statusCode());
        assertTrue(logout.body().isEmpty());

        assertEquals(401, get("/users/me", secondPair.accessToken()).statusCode());
        assertEquals(
                401,
                post("/auth/refresh", Map.of("refreshToken", secondPair.refreshToken())).statusCode()
        );
        assertEquals(
                204,
                post("/auth/logout", Map.of("refreshToken", secondPair.refreshToken())).statusCode()
        );
    }

    private HttpResponse<String> post(String path, Object body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .GET()
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private String storedRefreshHash(UUID userId) {
        return jdbcTemplate.queryForObject(
                "select refresh_token_hash from identity.user_sessions where user_id = ?",
                String.class,
                userId
        );
    }

    private static void assertPublicOnly(String body) {
        assertFalse(body.contains("password"));
        assertFalse(body.contains("passwordHash"));
        assertFalse(body.contains("refreshTokenHash"));
    }
}
