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
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
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
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Real HTTP coverage for the public JWT boundary and internal service-key route.
 * PostgreSQL and Valkey are supplied by Testcontainers in the test environment.
 */
@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WorkspaceHttpSecurityIntegrationTest {

    private static final String DIRECTORY_KEY = "test-directory-key";
    private static final String WORKSPACE_KEY = "test-workspace-key";
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Map<UUID, UserFixture> USERS = new ConcurrentHashMap<>();
    private static final AtomicBoolean identityAvailable = new AtomicBoolean(true);
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    private static HttpServer identityServer;

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    @LocalServerPort
    private int port;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwtProperties;

    @Autowired
    private ObjectMapper objectMapper;

    private UUID ownerId;
    private UUID memberId;
    private UUID outsiderId;
    private UUID targetId;
    private Workspace workspace;

    @DynamicPropertySource
    static void dynamicProperties(DynamicPropertyRegistry registry) {
        ensureIdentityServer();
        registry.add("server.servlet.context-path", () -> "/workspace");
        registry.add("weav.identity.base-url", WorkspaceHttpSecurityIntegrationTest::identityBaseUrl);
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
    void seedWorkspace() {
        identityAvailable.set(true);
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        ownerId = UUID.randomUUID();
        memberId = UUID.randomUUID();
        outsiderId = UUID.randomUUID();
        targetId = UUID.randomUUID();
        USERS.clear();
        USERS.put(ownerId, new UserFixture(ownerId, "owner@example.com", "Owner", true));
        USERS.put(memberId, new UserFixture(memberId, "member@example.com", "Member", true));
        USERS.put(outsiderId, new UserFixture(outsiderId, "outsider@example.com", "Outsider", true));
        USERS.put(targetId, new UserFixture(targetId, "target@example.com", "Target", true));

        workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(
                    Workspace.createNew("HTTP workspace " + UUID.randomUUID(), ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            membershipRepository.save(Membership.member(saved.getId(), memberId));
            return saved;
        });
    }

    @Test
    void rejectsBasicRefreshExpiredWrongSignatureAndMalformedSubjectTokens() throws Exception {
        assertEquals(401, request("GET", "/workspaces", null, null, null).statusCode());
        assertEquals(401, requestWithRawAuthorization("GET", "/workspaces", "Basic dXNlcjpwYXNz", null).statusCode());
        assertEquals(401, requestWithRawAuthorization("GET", "/workspaces", "Bearer "
                + signedToken(ownerId, "access", Instant.now().minus(Duration.ofMinutes(2)),
                Instant.now().minusSeconds(31), jwtProperties.accessSecret(), "USER", "ACTIVE"), null).statusCode());
        assertEquals(401, requestWithRawAuthorization("GET", "/workspaces", "Bearer "
                + signedToken(ownerId, "access", Instant.now().minusSeconds(1),
                Instant.now().plus(Duration.ofMinutes(5)), "wrong-signing-secret-0123456789abcdef", "USER", "ACTIVE"), null).statusCode());
        assertEquals(401, requestWithRawAuthorization("GET", "/workspaces", "Bearer "
                + signedToken(ownerId, "refresh", Instant.now().minusSeconds(1),
                Instant.now().plus(Duration.ofMinutes(5)), jwtProperties.accessSecret(), "USER", "ACTIVE"), null).statusCode());
        assertEquals(401, requestWithRawAuthorization("GET", "/workspaces", "Bearer "
                + signedTokenValue("not-a-uuid", "access", Instant.now().minusSeconds(1),
                Instant.now().plus(Duration.ofMinutes(5)), jwtProperties.accessSecret(), "USER", "ACTIVE"), null).statusCode());
    }

    @Test
    void usesJwtSubjectForCreateAndEnforcesStrictWorkspaceQueryValidation() throws Exception {
        HttpResponse<String> defaultCreated = request(
                "POST", "/workspaces", ownerId, null, "{}");

        assertEquals(201, defaultCreated.statusCode());
        JsonNode defaultWorkspace = json(defaultCreated);
        assertEquals(ownerId.toString(), defaultWorkspace.path("createdBy").asText());
        assertTrue(defaultWorkspace.path("name").asText().startsWith("My workspace "));

        HttpResponse<String> created = request(
                "POST", "/workspaces", ownerId, null, "{\"name\":\"Created over HTTP\"}");

        assertEquals(201, created.statusCode());
        assertEquals(ownerId.toString(), json(created).path("createdBy").asText());

        HttpResponse<String> invalidSort = request(
                "GET", "/workspaces?sort=displayName", ownerId, null, null);
        HttpResponse<String> invalidPage = request(
                "GET", "/workspaces?page=-1", ownerId, null, null);
        HttpResponse<String> invalidSize = request(
                "GET", "/workspaces?size=101", ownerId, null, null);
        HttpResponse<String> invalidDirection = request(
                "GET", "/workspaces?direction=sideways", ownerId, null, null);
        HttpResponse<String> invalidRole = request(
                "GET", "/workspaces?role=ADMIN", ownerId, null, null);
        HttpResponse<String> validBoundary = request(
                "GET", "/workspaces?role=OWNER&sort=createdAt&direction=desc&size=1",
                ownerId, null, null);

        assertEquals(400, invalidSort.statusCode());
        assertEquals(400, invalidPage.statusCode());
        assertEquals(400, invalidSize.statusCode());
        assertEquals(400, invalidDirection.statusCode());
        assertEquals(400, invalidRole.statusCode());
        assertEquals(200, validBoundary.statusCode());
        JsonNode validBoundaryBody = json(validBoundary);
        assertEquals(1, validBoundaryBody.path("items").size());
        assertEquals(ownerId.toString(), validBoundaryBody.path("items").get(0).path("createdBy").asText());
        assertFalse(validBoundaryBody.path("items").get(0).path("name").asText().isBlank());
        assertTrue(invalidSort.body().contains("\"error\""));
        assertTrue(invalidSort.body().contains("\"code\":\"BAD_REQUEST\""));
    }

    @Test
    void scopesWorkspaceVisibilityAndOwnerOnlyRenameThroughHttp() throws Exception {
        assertEquals(200, request("GET", "/workspaces/" + workspace.getId(), memberId, null, null).statusCode());
        assertEquals(404, request("GET", "/workspaces/" + workspace.getId(), outsiderId, null, null).statusCode());

        HttpResponse<String> memberRename = request(
                "PATCH", "/workspaces/" + workspace.getId(), memberId, null, "{\"name\":\"forbidden\"}");
        HttpResponse<String> ownerRename = request(
                "PATCH", "/workspaces/" + workspace.getId(), ownerId, null, "{\"name\":\"Renamed over HTTP\"}");

        assertEquals(403, memberRename.statusCode());
        assertEquals(200, ownerRename.statusCode());
        assertTrue(ownerRename.body().contains("\"name\":\"Renamed over HTTP\""));
    }

    @Test
    void exposesEnrichedMemberViewsAndEnforcesMembershipPermissions() throws Exception {
        HttpResponse<String> listed = request(
                "GET", "/workspaces/" + workspace.getId()
                        + "/members?sort=displayName&direction=desc&role=MEMBER"
                        + "&canPublishWorkflow=false&canManageWorkflowState=false",
                memberId, null, null);
        assertEquals(200, listed.statusCode());
        JsonNode listedBody = json(listed);
        assertEquals(1, listedBody.path("items").size());
        JsonNode listedMember = listedBody.path("items").get(0);
        assertEquals(memberId.toString(), listedMember.path("userId").asText());
        assertEquals("MEMBER", listedMember.path("role").asText());
        assertEquals("member@example.com", listedMember.path("email").asText());
        assertEquals("Member", listedMember.path("displayName").asText());
        assertFalse(listedMember.path("canPublishWorkflow").asBoolean());
        assertFalse(listedMember.path("canManageWorkflowState").asBoolean());
        assertTrue(listedMember.path("active").asBoolean());

        HttpResponse<String> updated = request(
                "PATCH", "/workspaces/" + workspace.getId() + "/members/" + memberId + "/permissions",
                ownerId, null, "{\"canPublishWorkflow\":true,\"canManageWorkflowState\":false}");
        assertEquals(200, updated.statusCode());
        JsonNode updatedBody = json(updated);
        assertEquals(memberId.toString(), updatedBody.path("userId").asText());
        assertEquals("MEMBER", updatedBody.path("role").asText());
        assertTrue(updatedBody.path("canPublishWorkflow").asBoolean());
        assertFalse(updatedBody.path("canManageWorkflowState").asBoolean());
        assertEquals("member@example.com", updatedBody.path("email").asText());
        assertEquals("Member", updatedBody.path("displayName").asText());
        assertTrue(updatedBody.path("active").asBoolean());

        HttpResponse<String> missingBoolean = request(
                "PATCH", "/workspaces/" + workspace.getId() + "/members/" + memberId + "/permissions",
                ownerId, null, "{\"canPublishWorkflow\":true}");
        HttpResponse<String> invalidBoolean = request(
                "PATCH", "/workspaces/" + workspace.getId() + "/members/" + memberId + "/permissions",
                ownerId, null, "{\"canPublishWorkflow\":\"yes\",\"canManageWorkflowState\":false}");
        assertEquals(400, missingBoolean.statusCode());
        assertEquals(400, invalidBoolean.statusCode());

        HttpResponse<String> memberUpdate = request(
                "PATCH", "/workspaces/" + workspace.getId() + "/members/" + ownerId + "/permissions",
                memberId, null, "{\"canPublishWorkflow\":true,\"canManageWorkflowState\":true}");
        HttpResponse<String> memberAdd = request(
                "POST", "/workspaces/" + workspace.getId() + "/members", memberId, null,
                "{\"email\":\"target@example.com\"}");
        assertEquals(403, memberUpdate.statusCode());
        assertEquals(403, memberAdd.statusCode());

        HttpResponse<String> added = request(
                "POST", "/workspaces/" + workspace.getId() + "/members", ownerId, null,
                "{\"email\":\"target@example.com\"}");
        HttpResponse<String> duplicate = request(
                "POST", "/workspaces/" + workspace.getId() + "/members", ownerId, null,
                "{\"email\":\"TARGET@example.com\"}");
        assertEquals(201, added.statusCode());
        JsonNode addedBody = json(added);
        assertEquals(targetId.toString(), addedBody.path("userId").asText());
        assertEquals("MEMBER", addedBody.path("role").asText());
        assertEquals("target@example.com", addedBody.path("email").asText());
        assertEquals("Target", addedBody.path("displayName").asText());
        assertTrue(addedBody.path("active").asBoolean());
        assertEquals(409, duplicate.statusCode());
    }

    @Test
    void rejectsUnauthorizedMemberRemovalAndOutsiderCannotActOnWorkspace() throws Exception {
        HttpResponse<String> memberRemovingOwner = request(
                "DELETE", "/workspaces/" + workspace.getId() + "/members/" + ownerId,
                memberId, null, null);
        HttpResponse<String> outsiderRemovingMember = request(
                "DELETE", "/workspaces/" + workspace.getId() + "/members/" + memberId,
                outsiderId, null, null);

        assertEquals(403, memberRemovingOwner.statusCode());
        assertEquals(404, outsiderRemovingMember.statusCode());
        assertEquals(200, request("GET", "/workspaces/" + workspace.getId(), ownerId, null, null).statusCode());
        assertEquals(200, request("GET", accessPath(memberId), null, WORKSPACE_KEY, null).statusCode());
    }

    @Test
    void ownerRemoveReturns204InvalidatesCommittedCacheAndRemovesMemberAccess() throws Exception {
        HttpResponse<String> warmed = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, warmed.statusCode());

        HttpResponse<String> removed = request(
                "DELETE", "/workspaces/" + workspace.getId() + "/members/" + memberId,
                ownerId, null, null);
        HttpResponse<String> afterRemoval = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);

        assertEquals(204, removed.statusCode());
        assertEquals(404, afterRemoval.statusCode());
        assertTrue(membershipRepository.findByWorkspaceIdAndUserId(workspace.getId(), memberId).isEmpty());
    }

    @Test
    void memberLeaveReturns204InvalidatesCommittedCacheAndRemovesMemberAccess() throws Exception {
        HttpResponse<String> warmed = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, warmed.statusCode());

        HttpResponse<String> left = request(
                "DELETE", "/workspaces/" + workspace.getId() + "/members/me",
                memberId, null, null);
        HttpResponse<String> afterLeave = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);

        assertEquals(204, left.statusCode());
        assertEquals(404, afterLeave.statusCode());
        assertTrue(membershipRepository.findByWorkspaceIdAndUserId(workspace.getId(), memberId).isEmpty());
    }

    @Test
    void ownerLeaveReturnsConflictAndPreservesOwnerAccess() throws Exception {
        HttpResponse<String> left = request(
                "DELETE", "/workspaces/" + workspace.getId() + "/members/me",
                ownerId, null, null);
        HttpResponse<String> ownerAccess = request("GET", accessPath(ownerId), null, WORKSPACE_KEY, null);

        assertEquals(409, left.statusCode());
        assertTrue(left.body().contains("\"code\":\"OWNER_CANNOT_LEAVE\""));
        assertEquals(200, ownerAccess.statusCode());
        assertEquals("OWNER", json(ownerAccess).path("role").asText());
    }

    @Test
    void identityOutageMapsTo503OverRealLocalHttpFixture() throws Exception {
        identityAvailable.set(false);
        HttpResponse<String> unavailable = request(
                "POST", "/workspaces/" + workspace.getId() + "/members", ownerId, null,
                "{\"email\":\"target@example.com\"}");

        assertEquals(503, unavailable.statusCode());
        assertTrue(unavailable.body().contains("\"code\":\"DEPENDENCY_UNAVAILABLE\""));
    }

    @Test
    void internalAuthorizationFallsBackDuringValkeyOutageAndRecoversAfterUnpause() throws Exception {
        HttpResponse<String> warm = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, warm.statusCode());
        JsonNode expected = json(warm);
        String containerId = valkey.getContainerId();

        valkey.getDockerClient().pauseContainerCmd(containerId).exec();
        try {
            HttpResponse<String> duringOutage = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
            assertEquals(200, duringOutage.statusCode());
            assertEquals(expected.path("workspaceId").asText(), json(duringOutage).path("workspaceId").asText());
            assertEquals(expected.path("userId").asText(), json(duringOutage).path("userId").asText());
            assertEquals(expected.path("role").asText(), json(duringOutage).path("role").asText());
        } finally {
            valkey.getDockerClient().unpauseContainerCmd(containerId).exec();
        }

        HttpResponse<String> recovered = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, recovered.statusCode());
        assertEquals(expected.path("role").asText(), json(recovered).path("role").asText());
    }

    @Test
    void internalAccessRequiresKeyReturnsTypedMissingMembershipAndUsesCacheHit() throws Exception {
        HttpResponse<String> noKey = request("GET", accessPath(ownerId), null, null, null);
        HttpResponse<String> bearerOnly = request("GET", accessPath(ownerId), ownerId, null, null);
        HttpResponse<String> wrongKey = request("GET", accessPath(ownerId), null, "wrong-key", null);
        assertEquals(401, noKey.statusCode());
        assertEquals(401, bearerOnly.statusCode());
        assertEquals(401, wrongKey.statusCode());

        HttpResponse<String> ownerAccess = request("GET", accessPath(ownerId), null, WORKSPACE_KEY, null);
        HttpResponse<String> memberAccess = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, ownerAccess.statusCode());
        assertEquals(200, memberAccess.statusCode());
        JsonNode ownerAccessBody = json(ownerAccess);
        JsonNode memberAccessBody = json(memberAccess);
        assertEquals(workspace.getId().toString(), ownerAccessBody.path("workspaceId").asText());
        assertEquals(ownerId.toString(), ownerAccessBody.path("userId").asText());
        assertEquals("OWNER", ownerAccessBody.path("role").asText());
        assertEquals(Set.of(
                        "WORKSPACE_VIEW",
                        "MEMBER_VIEW",
                        "WORKFLOW_CREATE",
                        "WORKFLOW_EDIT",
                        "WORKFLOW_RUN",
                        "WORKFLOW_MONITOR",
                        "WORKFLOW_PUBLISH",
                        "WORKFLOW_MANAGE_STATE",
                        "WORKSPACE_RENAME",
                        "MEMBER_ADD",
                        "MEMBER_REMOVE",
                        "MEMBER_MANAGE_PERMISSIONS"),
                capabilityNames(ownerAccessBody.path("capabilities")));
        assertEquals(workspace.getId().toString(), memberAccessBody.path("workspaceId").asText());
        assertEquals(memberId.toString(), memberAccessBody.path("userId").asText());
        assertEquals("MEMBER", memberAccessBody.path("role").asText());
        assertEquals(Set.of(
                        "WORKSPACE_VIEW",
                        "MEMBER_VIEW",
                        "WORKFLOW_CREATE",
                        "WORKFLOW_EDIT",
                        "WORKFLOW_RUN",
                        "WORKFLOW_MONITOR"),
                capabilityNames(memberAccessBody.path("capabilities")));

        HttpResponse<String> missing = request("GET", accessPath(outsiderId), null, WORKSPACE_KEY, null);
        assertEquals(404, missing.statusCode());
        assertTrue(missing.body().contains("\"code\":\"MEMBERSHIP_NOT_FOUND\""));

        jdbcTemplate.update("delete from workspace.memberships where workspace_id = ? and user_id = ?",
                workspace.getId(), memberId);
        HttpResponse<String> cachedMemberAccess = request("GET", accessPath(memberId), null, WORKSPACE_KEY, null);
        assertEquals(200, cachedMemberAccess.statusCode(),
                "a valid cache hit must avoid a second authoritative membership read");
    }

    private JsonNode json(HttpResponse<String> response) throws IOException {
        JsonNode body = objectMapper.readTree(response.body());
        assertNotNull(body, "response body must be valid JSON");
        return body;
    }

    private Set<String> capabilityNames(JsonNode capabilities) {
        Set<String> names = new HashSet<>();
        capabilities.forEach(capability -> names.add(capability.asText()));
        return names;
    }

    private String accessPath(UUID userId) {
        return "/internal/workspaces/" + workspace.getId() + "/users/" + userId + "/access";
    }

    private HttpResponse<String> request(
            String method,
            String path,
            UUID subject,
            String serviceKey,
            String body) throws Exception {
        String authorization = subject == null ? null : "Bearer " + signedToken(subject);
        return requestWithRawAuthorization(method, path, authorization, serviceKey, body);
    }

    private HttpResponse<String> requestWithRawAuthorization(
            String method,
            String path,
            String authorization,
            String serviceKey) throws Exception {
        return requestWithRawAuthorization(method, path, authorization, serviceKey, null);
    }

    private HttpResponse<String> requestWithRawAuthorization(
            String method,
            String path,
            String authorization,
            String serviceKey,
            String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/workspace" + path))
                .timeout(Duration.ofSeconds(10));
        if (authorization != null) {
            builder.header("Authorization", authorization);
        }
        if (serviceKey != null) {
            builder.header("X-Internal-Service-Key", serviceKey);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        builder.method(method, publisher);
        return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String signedToken(UUID subject) {
        return signedToken(subject, "access", Instant.now().minusSeconds(5),
                Instant.now().plus(Duration.ofMinutes(5)), jwtProperties.accessSecret(), "USER", "ACTIVE");
    }

    private String signedToken(
            UUID subject,
            String tokenUse,
            Instant issuedAt,
            Instant expiresAt,
            String secret,
            String systemRole,
            String userStatus) {
        return signedTokenValue(subject.toString(), tokenUse, issuedAt, expiresAt, secret, systemRole, userStatus);
    }

    private String signedTokenValue(
            String subject,
            String tokenUse,
            Instant issuedAt,
            Instant expiresAt,
            String secret,
            String systemRole,
            String userStatus) {
        SecretKey key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        NimbusJwtEncoder encoder = NimbusJwtEncoder.withSecretKey(key)
                .algorithm(MacAlgorithm.HS256)
                .build();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(jwtProperties.issuer())
                .subject(subject)
                .audience(List.of(jwtProperties.audience()))
                .issuedAt(issuedAt)
                .notBefore(issuedAt)
                .expiresAt(expiresAt)
                .id(UUID.randomUUID().toString())
                .claim("sid", UUID.randomUUID().toString())
                .claim("system_role", systemRole)
                .claim("user_status", userStatus)
                .claim("token_use", tokenUse)
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
            identityServer.createContext("/internal/directory/users", WorkspaceHttpSecurityIntegrationTest::handleIdentity);
            identityServer.start();
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start Identity directory stub", exception);
        }
    }

    private static String identityBaseUrl() {
        return "http://127.0.0.1:" + identityServer.getAddress().getPort();
    }

    private static void handleIdentity(HttpExchange exchange) throws IOException {
        if (!DIRECTORY_KEY.equals(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"))) {
            respond(exchange, 401, "{}");
            return;
        }
        if (!identityAvailable.get()) {
            respond(exchange, 503, "{}");
            return;
        }
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String path = exchange.getRequestURI().getPath();
        if (path.endsWith("/by-email")) {
            String email = extractString(body, "email");
            UserFixture fixture = USERS.values().stream()
                    .filter(user -> user.email().equalsIgnoreCase(email))
                    .findFirst()
                    .orElse(null);
            respond(exchange, fixture == null ? 404 : 200, fixture == null ? "{}" : fixture.json());
            return;
        }
        List<UserFixture> candidates = extractUserFixtures(body);
        String search = extractString(body, "search");
        if (path.endsWith("/match")) {
            String ids = candidates.stream()
                    .filter(user -> matches(user, search))
                    .map(user -> "\"" + user.userId() + "\"")
                    .sorted()
                    .reduce((left, right) -> left + "," + right)
                    .orElse("");
            respond(exchange, 200, "{\"matchingUserIds\":[" + ids + "]}");
            return;
        }
        if (path.endsWith("/batch")) {
            respond(exchange, 200, "[" + candidates.stream()
                    .map(UserFixture::json)
                    .reduce((left, right) -> left + "," + right)
                    .orElse("") + "]");
            return;
        }
        if (path.endsWith("/search")) {
            List<UserFixture> matching = candidates.stream()
                    .filter(user -> matches(user, search))
                    .sorted(Comparator.comparing(UserFixture::displayName,
                            Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER))
                            .thenComparing(UserFixture::userId))
                    .toList();
            String items = matching.stream().map(UserFixture::json)
                    .reduce((left, right) -> left + "," + right).orElse("");
            respond(exchange, 200, "{\"items\":[" + items + "],\"page\":0,\"size\":100,\"totalElements\":"
                    + matching.size() + ",\"totalPages\":" + (matching.isEmpty() ? 0 : 1) + "}");
            return;
        }
        respond(exchange, 404, "{}");
    }

    private static List<UserFixture> extractUserFixtures(String body) {
        Matcher matcher = UUID_PATTERN.matcher(body);
        return matcher.results()
                .map(match -> USERS.get(UUID.fromString(match.group())))
                .filter(user -> user != null)
                .distinct()
                .toList();
    }

    private static boolean matches(UserFixture user, String search) {
        if (search == null || search.isBlank()) {
            return true;
        }
        String normalized = search.toLowerCase();
        return (user.displayName() != null && user.displayName().toLowerCase().contains(normalized))
                || user.email().toLowerCase().contains(normalized);
    }

    private static String extractString(String body, String field) {
        Matcher matcher = Pattern.compile("\\\"" + field + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"")
                .matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private record UserFixture(UUID userId, String email, String displayName, boolean active) {
        private String json() {
            return "{\"userId\":\"" + userId + "\",\"email\":\"" + email
                    + "\",\"displayName\":" + (displayName == null ? "null" : "\"" + displayName + "\"")
                    + ",\"active\":" + active + "}";
        }
    }
}
