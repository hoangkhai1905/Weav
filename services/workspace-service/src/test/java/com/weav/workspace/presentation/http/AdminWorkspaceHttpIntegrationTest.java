package com.weav.workspace.presentation.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** UC027: real HTTP, JWT role gate, persistence and the Identity directory for GET /admin/workspaces. */
@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminWorkspaceHttpIntegrationTest {

    private static final String DIRECTORY_KEY = "test-directory-key";
    private static final String WORKSPACE_KEY = "test-workspace-key-0123456789-abcdefghij";
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Map<UUID, String> EMAILS = new ConcurrentHashMap<>();
    private static final AtomicBoolean identityFails = new AtomicBoolean();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private static HttpServer identityServer;

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @LocalServerPort
    private int port;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private MembershipRepository membershipRepository;
    @Autowired private TransactionRunner transactionRunner;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JwtProperties jwtProperties;
    @Autowired private ObjectMapper objectMapper;

    private UUID adminId;
    private UUID ownerA;
    private UUID ownerB;

    @DynamicPropertySource
    static void dynamicProperties(DynamicPropertyRegistry registry) {
        ensureIdentityServer();
        registry.add("server.servlet.context-path", () -> "/workspace");
        registry.add("weav.identity.base-url", () -> "http://127.0.0.1:" + identityServer.getAddress().getPort());
        registry.add("weav.identity.connect-timeout", () -> "250ms");
        registry.add("weav.identity.read-timeout", () -> "250ms");
        registry.add("weav.identity.internal-service-key", () -> DIRECTORY_KEY);
        registry.add("weav.internal.service-key", () -> WORKSPACE_KEY);
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
        registry.add("spring.data.redis.timeout", () -> "500ms");
        registry.add("spring.data.redis.connect-timeout", () -> "500ms");
    }

    @AfterAll
    static void stopIdentityServer() {
        if (identityServer != null) {
            identityServer.stop(0);
            identityServer = null;
        }
    }

    @BeforeEach
    void seed() {
        identityFails.set(false);
        jdbc.update("delete from workspace.memberships");
        jdbc.update("delete from workspace.workspaces");
        adminId = UUID.randomUUID();
        ownerA = UUID.randomUUID();
        ownerB = UUID.randomUUID();
        EMAILS.put(ownerA, "owner-a@example.com");
        EMAILS.put(ownerB, "owner-b@example.com");
    }

    @Test
    void userRoleGets403() throws Exception {
        HttpResponse<String> response = get("/admin/workspaces", "USER");
        assertThat(response.statusCode()).isEqualTo(403);
    }

    @Test
    void adminListsWorkspacesOfAllOwnersWithOwnerEmailAndMemberCount() throws Exception {
        Workspace shared = workspace("Shared", ownerA, UUID.randomUUID());
        workspace("Solo", ownerB);
        Workspace gone = workspace("Gone", ownerB);
        transactionRunner.required(() -> {
            gone.markDeleted(ownerB, Instant.now());
            return workspaceRepository.save(gone);
        });
        workspace("Third", ownerA);

        JsonNode body = json(get("/admin/workspaces", "ADMIN"));

        assertThat(body.path("totalElements").asLong()).isEqualTo(3);
        List<JsonNode> items = new ArrayList<>();
        body.path("items").forEach(items::add);
        assertThat(items).extracting(item -> item.path("name").asText()).doesNotContain("Gone");
        // newest first: Third, Solo, Shared
        assertThat(items).extracting(item -> item.path("name").asText()).containsExactly("Third", "Solo", "Shared");
        JsonNode sharedItem = items.get(2);
        assertThat(sharedItem.path("id").asText()).isEqualTo(shared.getId().toString());
        assertThat(sharedItem.path("memberCount").asInt()).isEqualTo(2);
        assertThat(sharedItem.path("ownerId").asText()).isEqualTo(ownerA.toString());
        assertThat(sharedItem.path("ownerEmail").asText()).isEqualTo("owner-a@example.com");
        assertThat(items.get(1).path("ownerEmail").asText()).isEqualTo("owner-b@example.com");
        assertThat(items.get(1).path("memberCount").asInt()).isEqualTo(1);
    }

    @Test
    void filtersByOwnerIdsAndNameSearchMatchesLiterally() throws Exception {
        Workspace a = workspace("Alpha", ownerA);
        Workspace b = workspace("Beta", ownerB);
        workspace("Gamma", ownerB);
        Workspace literal = workspace("50%_off plan", ownerA);
        workspace("500 offers", ownerA);

        assertThat(names(get("/admin/workspaces?ownerId=" + ownerB, "ADMIN")))
                .containsExactly("Gamma", "Beta");
        assertThat(names(get("/admin/workspaces?ids=" + a.getId() + "," + b.getId(), "ADMIN")))
                .containsExactly("Beta", "Alpha");
        assertThat(names(get("/admin/workspaces?ownerId=" + ownerA + "&ids=" + a.getId() + "," + b.getId(), "ADMIN")))
                .containsExactly("Alpha");
        assertThat(names(get("/admin/workspaces?q=50%25_off", "ADMIN"))).containsExactly(literal.getName());
        assertThat(names(get("/admin/workspaces?q=ALPHA", "ADMIN"))).containsExactly("Alpha");
    }

    @Test
    void rejectsBadParameters() throws Exception {
        String hundredOne = ("," + UUID.randomUUID()).repeat(101).substring(1);
        String hundred = ("," + UUID.randomUUID()).repeat(100).substring(1);
        assertThat(get("/admin/workspaces?ids=not-a-uuid", "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?ids=" + hundredOne, "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?ids=" + hundred, "ADMIN").statusCode()).isEqualTo(200);
        assertThat(get("/admin/workspaces?size=101", "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?size=0", "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?page=-1", "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?ownerId=nope", "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?q=" + "a".repeat(101), "ADMIN").statusCode()).isEqualTo(400);
        assertThat(get("/admin/workspaces?q=" + "a".repeat(100), "ADMIN").statusCode()).isEqualTo(200);
    }

    @Test
    void identityFailureStillReturnsWorkspacesWithEmptyOwnerFields() throws Exception {
        workspace("Lonely", ownerA);
        identityFails.set(true);

        HttpResponse<String> response = get("/admin/workspaces", "ADMIN");

        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode item = json(response).path("items").get(0);
        assertThat(item.path("name").asText()).isEqualTo("Lonely");
        assertThat(item.path("ownerEmail").isNull()).isTrue();
        assertThat(item.path("ownerDisplayName").isNull()).isTrue();
        assertThat(item.path("memberCount").asInt()).isEqualTo(1);
    }

    /** Creates an active workspace owned by {@code owner}, plus plain members; created_at strictly increases. */
    private Workspace workspace(String name, UUID owner, UUID... members) throws InterruptedException {
        Thread.sleep(5);
        return transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew(name, owner));
            membershipRepository.save(Membership.owner(saved.getId(), owner));
            for (UUID member : members) {
                membershipRepository.save(Membership.member(saved.getId(), member));
            }
            return saved;
        });
    }

    private List<String> names(HttpResponse<String> response) throws IOException {
        assertThat(response.statusCode()).isEqualTo(200);
        List<String> names = new ArrayList<>();
        json(response).path("items").forEach(item -> names.add(item.path("name").asText()));
        return names;
    }

    private JsonNode json(HttpResponse<String> response) throws IOException {
        return objectMapper.readTree(response.body());
    }

    private HttpResponse<String> get(String path, String systemRole) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/workspace" + path))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + signedToken(adminId, systemRole))
                .GET()
                .build();
        return HTTP.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String signedToken(UUID subject, String systemRole) {
        SecretKey key = new SecretKeySpec(jwtProperties.accessSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        NimbusJwtEncoder encoder = NimbusJwtEncoder.withSecretKey(key).algorithm(MacAlgorithm.HS256).build();
        Instant issuedAt = Instant.now().minusSeconds(5);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(jwtProperties.issuer())
                .subject(subject.toString())
                .audience(List.of(jwtProperties.audience()))
                .issuedAt(issuedAt)
                .notBefore(issuedAt)
                .expiresAt(Instant.now().plus(Duration.ofMinutes(5)))
                .id(UUID.randomUUID().toString())
                .claim("sid", UUID.randomUUID().toString())
                .claim("system_role", systemRole)
                .claim("user_status", "ACTIVE")
                .claim("token_use", "access")
                .build();
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims)).getTokenValue();
    }

    private static void ensureIdentityServer() {
        if (identityServer != null) {
            return;
        }
        try {
            identityServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            identityServer.createContext("/internal/directory/users", AdminWorkspaceHttpIntegrationTest::handleIdentity);
            identityServer.start();
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start Identity directory stub", exception);
        }
    }

    /** Answers POST .../batch with a user object for every known id found in the request body. */
    private static void handleIdentity(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        if (!DIRECTORY_KEY.equals(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"))) {
            respond(exchange, 401, "{}");
        } else if (identityFails.get() || !exchange.getRequestURI().getPath().endsWith("/batch")) {
            respond(exchange, identityFails.get() ? 500 : 404, "{}");
        } else {
            List<String> users = new ArrayList<>();
            Matcher matcher = UUID_PATTERN.matcher(body);
            while (matcher.find()) {
                UUID id = UUID.fromString(matcher.group());
                String email = EMAILS.get(id);
                if (email != null) {
                    users.add("{\"userId\":\"" + id + "\",\"email\":\"" + email
                            + "\",\"displayName\":\"Owner\",\"active\":true}");
                }
            }
            respond(exchange, 200, "[" + String.join(",", users) + "]");
        }
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
