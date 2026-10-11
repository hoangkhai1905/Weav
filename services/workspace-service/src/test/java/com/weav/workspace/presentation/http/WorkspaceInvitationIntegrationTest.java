package com.weav.workspace.presentation.http;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
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
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/** W7-A1: real HTTP, security, Flyway V8 and the outbox for the invite-by-email routes. */
@Testcontainers
@Import({TestcontainersConfiguration.class, WorkspaceInvitationIntegrationTest.IdentityFixture.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WorkspaceInvitationIntegrationTest {

    private static final Map<UUID, IdentityUserSummary> USERS = new ConcurrentHashMap<>();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    /** Replaces the Identity HTTP adapter with an in-memory directory. */
    @TestConfiguration(proxyBeanMethods = false)
    static class IdentityFixture {
        @Bean
        @Primary
        IdentityDirectoryPort fixtureIdentityDirectory() {
            return new IdentityDirectoryPort() {
                @Override
                public Optional<IdentityUserSummary> findByEmail(String email) {
                    return USERS.values().stream().filter(u -> u.email().trim().equalsIgnoreCase(email)).findFirst();
                }

                @Override
                public Set<UUID> matchUserIds(Collection<UUID> ids, String search) {
                    return Set.of();
                }

                @Override
                public PageResult<IdentityUserSummary> searchUsersByDisplayName(
                        Collection<UUID> ids, String search, int page, int size, SortDirection direction) {
                    return new PageResult<>(List.of(), page, size, 0, 0);
                }

                @Override
                public List<IdentityUserSummary> getUsersByIds(Collection<UUID> ids) {
                    return ids.stream().map(USERS::get).filter(java.util.Objects::nonNull).toList();
                }
            };
        }
    }

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

    private UUID ownerId;
    private UUID inviteeId;
    private Workspace workspace;

    @DynamicPropertySource
    static void dynamicProperties(DynamicPropertyRegistry registry) {
        registry.add("server.servlet.context-path", () -> "/workspace");
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
        registry.add("spring.data.redis.timeout", () -> "500ms");
        registry.add("spring.data.redis.connect-timeout", () -> "500ms");
    }

    @BeforeEach
    void seed() {
        ownerId = UUID.randomUUID();
        inviteeId = UUID.randomUUID();
        USERS.put(ownerId, new IdentityUserSummary(ownerId, "owner-" + ownerId + "@example.com", "Owner", true, true));
        workspace = transactionRunner.required(() -> {
            Workspace saved = workspaceRepository.save(Workspace.createNew("Invite space " + ownerId, ownerId));
            membershipRepository.save(Membership.owner(saved.getId(), ownerId));
            return saved;
        });
    }

    private String email() {
        return "new-" + inviteeId + "@example.com";
    }

    private void registerInvitee(boolean verified) {
        USERS.put(inviteeId, new IdentityUserSummary(inviteeId, "  " + email().toUpperCase() + " ", "Invitee", true, verified));
    }

    @Test
    void ownerInvitesInviteeAcceptsAndBecomesMemberWithTheOutboxEvents() throws Exception {
        HttpResponse<String> created = send("POST", "/workspaces/" + workspace.getId() + "/invitations", ownerId,
                "{\"email\":\"" + email() + "\"}");
        assertThat(created.statusCode()).isEqualTo(201);
        JsonNode invitation = objectMapper.readTree(created.body());
        assertThat(invitation.get("status").asString()).isEqualTo("PENDING");
        assertThat(invitation.get("email").asString()).isEqualTo(email());
        String invitationId = invitation.get("id").asString();
        assertThat(jdbc.queryForObject("select count(*) from workspace.notification_outbox "
                + "where event_type = 'workspace.invitation.created' and payload ->> 'workspaceId' = ?",
                Integer.class, workspace.getId().toString())).isEqualTo(1);

        // Owner list is a different route from the invitee list.
        JsonNode ownerList = objectMapper.readTree(
                send("GET", "/workspaces/" + workspace.getId() + "/invitations", ownerId, null).body());
        assertThat(ownerList.get("items")).hasSize(1);

        // Unverified invitee: empty list and flag false, accept refused.
        registerInvitee(false);
        JsonNode unverified = objectMapper.readTree(send("GET", "/workspaces/invitations", inviteeId, null).body());
        assertThat(unverified.get("emailVerified").asBoolean()).isFalse();
        assertThat(unverified.get("items")).isEmpty();
        HttpResponse<String> refused = send("POST", "/workspaces/invitations/" + invitationId + "/accept", inviteeId, null);
        assertThat(refused.statusCode()).isEqualTo(409);
        assertThat(objectMapper.readTree(refused.body()).get("code").asString()).isEqualTo("EMAIL_NOT_VERIFIED");

        // Verified invitee: sees it (the literal path is not treated as a workspace id) and accepts.
        registerInvitee(true);
        HttpResponse<String> mineResponse = send("GET", "/workspaces/invitations", inviteeId, null);
        assertThat(mineResponse.statusCode()).isEqualTo(200);
        JsonNode mine = objectMapper.readTree(mineResponse.body());
        assertThat(mine.get("emailVerified").asBoolean()).isTrue();
        assertThat(mine.get("items")).hasSize(1);
        assertThat(mine.get("items").get(0).get("workspaceName").asString()).startsWith("Invite space");
        assertThat(mine.get("items").get(0).get("invitedByName").asString()).isEqualTo("Owner");

        HttpResponse<String> accepted = send("POST", "/workspaces/invitations/" + invitationId + "/accept", inviteeId, null);
        assertThat(accepted.statusCode()).isEqualTo(200);
        assertThat(objectMapper.readTree(accepted.body()).get("workspaceId").asString())
                .isEqualTo(workspace.getId().toString());
        assertThat(send("POST", "/workspaces/invitations/" + invitationId + "/accept", inviteeId, null).statusCode())
                .isEqualTo(200);

        assertThat(membershipRepository.findByWorkspaceIdAndUserId(workspace.getId(), inviteeId)).isPresent();
        assertThat(jdbc.queryForObject("select count(*) from workspace.memberships where workspace_id = ? and user_id = ?",
                Integer.class, workspace.getId(), inviteeId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select status from workspace.workspace_invitations where id = ?",
                String.class, UUID.fromString(invitationId))).isEqualTo("ACCEPTED");
        assertThat(jdbc.queryForObject("select count(*) from workspace.notification_outbox "
                + "where event_type = 'workspace.member_added' and payload ->> 'workspaceId' = ?",
                Integer.class, workspace.getId().toString())).isEqualTo(1);
    }

    @Test
    void twoOwnerRequestsForTheSameEmailAtOnceLeaveExactlyOnePendingRow() throws Exception {
        CyclicBarrier ready = new CyclicBarrier(2);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<Integer>> results = executor.invokeAll(java.util.Collections.nCopies(2, () -> {
                ready.await(10, TimeUnit.SECONDS);
                return send("POST", "/workspaces/" + workspace.getId() + "/invitations", ownerId,
                        "{\"email\":\"" + email() + "\"}").statusCode();
            }));
            List<Integer> statuses = List.of(results.get(0).get(), results.get(1).get());
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        } finally {
            executor.shutdownNow();
        }
        assertThat(jdbc.queryForObject("select count(*) from workspace.workspace_invitations "
                + "where workspace_id = ? and status = 'PENDING'", Integer.class, workspace.getId())).isEqualTo(1);
    }

    @Test
    void declineAndErrorStatusesMapToTheDocumentedCodes() throws Exception {
        String base = "/workspaces/" + workspace.getId() + "/invitations";
        String id = objectMapper.readTree(send("POST", base, ownerId, "{\"email\":\"" + email() + "\"}").body())
                .get("id").asString();
        registerInvitee(true);

        HttpResponse<String> tooSoon = send("POST", base + "/" + id + "/resend", ownerId, null);
        assertThat(tooSoon.statusCode()).isEqualTo(429);
        assertThat(objectMapper.readTree(tooSoon.body()).get("code").asString()).isEqualTo("INVITATION_RESEND_TOO_SOON");
        HttpResponse<String> exists = send("POST", base, ownerId, "{\"email\":\"" + email() + "\"}");
        assertThat(exists.statusCode()).isEqualTo(409);
        assertThat(objectMapper.readTree(exists.body()).get("code").asString()).isEqualTo("USER_EXISTS");
        assertThat(send("POST", base, ownerId, "{\"email\":\"not-an-email\"}").statusCode()).isEqualTo(400);
        assertThat(send("POST", base, inviteeId, "{\"email\":\"x@example.com\"}").statusCode()).isEqualTo(404);

        assertThat(send("POST", "/workspaces/invitations/" + id + "/decline", inviteeId, null).statusCode())
                .isEqualTo(204);
        HttpResponse<String> gone = send("POST", "/workspaces/invitations/" + id + "/accept", inviteeId, null);
        assertThat(gone.statusCode()).isEqualTo(410);
        assertThat(objectMapper.readTree(gone.body()).get("code").asString()).isEqualTo("INVITATION_GONE");
        assertThat(send("POST", "/workspaces/invitations/" + UUID.randomUUID() + "/accept", inviteeId, null).statusCode())
                .isEqualTo(404);

        // Revoke of a declined invitation is NOT_PENDING (409); revoke of a fresh one is 204.
        assertThat(send("DELETE", base + "/" + id, ownerId, null).statusCode()).isEqualTo(409);
        String second = objectMapper.readTree(
                send("POST", base, ownerId, "{\"email\":\"second-" + email() + "\"}").body())
                .get("id").asString();
        assertThat(send("DELETE", base + "/" + second, ownerId, null).statusCode()).isEqualTo(204);
    }

    private HttpResponse<String> send(String method, String path, UUID subject, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/workspace" + path))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + token(subject));
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        builder.method(method, body == null
                ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String token(UUID subject) {
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
                .claim("system_role", "USER")
                .claim("user_status", "ACTIVE")
                .claim("token_use", "access")
                .build();
        return encoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).type("JWT").build(), claims)).getTokenValue();
    }
}
