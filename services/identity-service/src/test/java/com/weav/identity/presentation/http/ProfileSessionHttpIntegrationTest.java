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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ProfileSessionHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String USER_AGENT = "Weav-Task2-Test";

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Test
    void managesOwnProfileAndSessionsOverRealHttpWithoutLeakingSensitiveMetadata() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UserResponse user = register("profile." + suffix + "@example.com");
        TokenResponse first = login(user.email(), USER_AGENT + "-" + "x".repeat(600));

        HttpResponse<String> missingDisplayName = patch("/users/me", first.accessToken(), "{}");
        assertEquals(400, missingDisplayName.statusCode());

        HttpResponse<String> unknownProfileField = patch(
                "/users/me", first.accessToken(),
                "{\"displayName\":\"Kai\",\"email\":\"privileged@example.com\"}"
        );
        assertEquals(400, unknownProfileField.statusCode());

        HttpResponse<String> trimmed = patch(
                "/users/me", first.accessToken(),
                "{\"displayName\":\"  Kai  \"}"
        );
        assertEquals(200, trimmed.statusCode());
        assertEquals("Kai", objectMapper.readValue(trimmed.body(), UserResponse.class).displayName());

        assertEquals(200, patch("/users/me", first.accessToken(), "{\"displayName\":null}").statusCode());
        assertNull(objectMapper.readValue(get("/users/me", first.accessToken()).body(), UserResponse.class).displayName());
        assertEquals(200, patch("/users/me", first.accessToken(), "{\"displayName\":\"   \"}").statusCode());

        String atLimitWithPadding = " ".repeat(2) + "a".repeat(120) + " ".repeat(2);
        assertEquals(200, patch(
                "/users/me", first.accessToken(),
                objectMapper.writeValueAsString(Map.of("displayName", atLimitWithPadding))
        ).statusCode());
        assertEquals(400, patch(
                "/users/me", first.accessToken(),
                objectMapper.writeValueAsString(Map.of("displayName", "a".repeat(121)))
        ).statusCode());

        TokenResponse second = login(user.email(), USER_AGENT + "-second");
        UUID firstSessionId = currentSessionId(first.accessToken());
        UUID secondSessionId = currentSessionId(second.accessToken());
        assertEquals(512, jdbcTemplate.queryForObject(
                "select length(user_agent) from identity.user_sessions where id = ?", Integer.class, firstSessionId));
        String storedIpAddress = jdbcTemplate.queryForObject(
                "select ip_address from identity.user_sessions where id = ?", String.class, firstSessionId);
        assertTrue(storedIpAddress != null && !storedIpAddress.isBlank());
        jdbcTemplate.update("update identity.user_sessions set user_agent = null where id = ?", firstSessionId);

        HttpResponse<String> invalidPage = get("/users/me/sessions?page=-1", second.accessToken());
        assertEquals(400, invalidPage.statusCode());
        assertEquals(400, get("/users/me/sessions?size=101", second.accessToken()).statusCode());

        HttpResponse<String> firstPage = get("/users/me/sessions?page=0&size=1", second.accessToken());
        assertEquals(200, firstPage.statusCode());
        JsonNode firstPageJson = objectMapper.readTree(firstPage.body());
        assertEquals(1, firstPageJson.get("items").size());
        assertEquals(2, firstPageJson.get("totalItems").asInt());

        HttpResponse<String> sessions = get("/users/me/sessions?page=0&size=20", second.accessToken());
        assertEquals(200, sessions.statusCode());
        assertSessionResponseIsSafe(sessions.body(), first, second, storedIpAddress);
        JsonNode sessionItems = objectMapper.readTree(sessions.body()).get("items");
        assertTrue(hasSession(sessionItems, firstSessionId, true, false));
        assertTrue(hasSession(sessionItems, secondSessionId, false, true));

        UserResponse otherUser = register("other." + suffix + "@example.com");
        TokenResponse other = login(otherUser.email(), USER_AGENT + "-other");
        assertEquals(404, delete("/users/me/sessions/" + secondSessionId, other.accessToken()).statusCode());

        assertEquals(204, delete("/users/me/sessions/" + firstSessionId, second.accessToken()).statusCode());
        assertEquals(204, delete("/users/me/sessions/" + firstSessionId, second.accessToken()).statusCode());
        assertEquals(401, get("/users/me", first.accessToken()).statusCode());

        TokenResponse third = login(user.email(), USER_AGENT + "-third");
        assertEquals(204, delete("/users/me/sessions", third.accessToken()).statusCode());
        assertEquals(401, get("/users/me", third.accessToken()).statusCode());
        assertEquals(401, get("/users/me", second.accessToken()).statusCode());
    }

    private UserResponse register(String email) throws Exception {
        HttpResponse<String> response = post("/auth/register", Map.of(
                "email", email,
                "password", PASSWORD,
                "displayName", "Initial"
        ));
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email, String userAgent) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri("/auth/login"))
                .header("Content-Type", "application/json")
                .header("User-Agent", userAgent)
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(Map.of(
                        "email", email,
                        "password", PASSWORD
                ))))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private UUID currentSessionId(String accessToken) throws Exception {
        JsonNode sessionItems = objectMapper.readTree(get("/users/me/sessions", accessToken).body()).get("items");
        for (JsonNode item : sessionItems) {
            if (item.get("current").asBoolean()) {
                return UUID.fromString(item.get("id").asText());
            }
        }
        throw new AssertionError("Current session was absent from the session list");
    }

    private HttpResponse<String> post(String path, Object body) throws Exception {
        return send("POST", path, null, objectMapper.writeValueAsString(body));
    }

    private HttpResponse<String> patch(String path, String accessToken, String body) throws Exception {
        return send("PATCH", path, accessToken, body);
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        return send("GET", path, accessToken, null);
    }

    private HttpResponse<String> delete(String path, String accessToken) throws Exception {
        return send("DELETE", path, accessToken, null);
    }

    private HttpResponse<String> send(String method, String path, String accessToken, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path));
        if (accessToken != null) {
            request.header("Authorization", "Bearer " + accessToken);
        }
        if (body != null) {
            request.header("Content-Type", "application/json");
        }
        switch (method) {
            case "GET" -> request.GET();
            case "POST" -> request.POST(HttpRequest.BodyPublishers.ofString(body));
            case "PATCH" -> request.method("PATCH", HttpRequest.BodyPublishers.ofString(body));
            case "DELETE" -> request.DELETE();
            default -> throw new IllegalArgumentException("Unsupported method");
        }
        return httpClient.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private boolean hasSession(JsonNode items, UUID sessionId, boolean requiresNullUserAgent, boolean requiresCurrent) {
        for (JsonNode item : items) {
            if (item.get("id").asText().equals(sessionId.toString())
                    && (!requiresNullUserAgent || item.get("userAgent").isNull())
                    && (!requiresCurrent || item.get("current").asBoolean())) {
                return true;
            }
        }
        return false;
    }

    private void assertSessionResponseIsSafe(
            String body,
            TokenResponse first,
            TokenResponse second,
            String storedIpAddress
    ) throws Exception {
        JsonNode root = objectMapper.readTree(body);
        List<String> allowed = List.of("id", "createdAt", "lastUsedAt", "expiresAt", "current", "userAgent");
        for (JsonNode item : root.get("items")) {
            assertEquals(allowed.size(), item.size());
            for (String field : allowed) {
                assertTrue(item.has(field));
            }
            assertFalse(item.has("ipAddress"));
            assertFalse(item.has("refreshTokenHash"));
            assertFalse(item.has("refreshToken"));
        }
        assertFalse(body.contains(first.refreshToken()));
        assertFalse(body.contains(second.refreshToken()));
        assertFalse(body.contains(storedIpAddress));
    }
}
