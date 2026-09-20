package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.OAuthAuthorizationResponse;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
@Import({TestcontainersConfiguration.class, GoogleOAuthUseCasesTest.OAuthPortFixtureConfiguration.class})
@SpringBootTest
class GoogleOAuthUseCasesTest {

    private static final String WORKFLOW_KEY = "synthetic-workflow-usage-key";
    private static final String ACCESS_TOKEN = "synthetic-access-token";
    private static final String REFRESH_TOKEN = "synthetic-refresh-token";
    private static final String GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
    private static final String SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private static HttpServer workflowServer;
    private static final AtomicReference<Integer> workflowStatus = new AtomicReference<>(200);
    private static final AtomicReference<Boolean> workflowInUse = new AtomicReference<>(false);
    private static final AtomicInteger workflowRequestCount = new AtomicInteger();
    private static final AtomicInteger advanceClockOnWorkflowRequest = new AtomicInteger(-1);
    private static final AtomicReference<MutableClock> sharedOAuthClock = new AtomicReference<>();

    @DynamicPropertySource
    static void dynamicProperties(DynamicPropertyRegistry registry) {
        ensureWorkflowServer();
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
        registry.add("weav.workflow.base-url", GoogleOAuthUseCasesTest::workflowBaseUrl);
        registry.add("weav.workflow.internal-service-key", () -> WORKFLOW_KEY);
        registry.add("weav.workflow.connect-timeout", () -> "1s");
        registry.add("weav.workflow.read-timeout", () -> "1s");
    }

    @AfterAll
    static void stopWorkflowServer() {
        if (workflowServer != null) {
            workflowServer.stop(0);
            workflowServer = null;
        }
    }

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private ConnectionRepository connectionRepository;

    @Autowired
    private CredentialRepository credentialRepository;

    @Autowired
    private CredentialCryptoPort credentialCrypto;

    @Autowired
    private CredentialPayloadCodec payloadCodec;

    @Autowired
    private StartConnectionOAuthUseCase startOAuth;

    @Autowired
    private CompleteConnectionOAuthUseCase completeOAuth;

    @Autowired
    private OAuthStateStore stateStore;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private FixtureGoogleOAuthPort googleOAuth;

    @Autowired
    private MutableClock oauthClock;

    @BeforeEach
    void resetFixtures() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        googleOAuth.reset();
        workflowStatus.set(200);
        workflowInUse.set(false);
        workflowRequestCount.set(0);
        advanceClockOnWorkflowRequest.set(-1);
        oauthClock.useSystemTime();
    }

    @Test
    void ownerStartAndCallbackPersistEncryptedCredentialAndRotateTheSameCredentialIdentity() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, false);
        OAuthAuthorizationResponse start = startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId());
        String firstState = stateFrom(start.authorizationUrl());

        assertThat(start.toString()).doesNotContain(firstState);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(googleOAuth.exchangeCalls.get()).isZero();
        assertThat(workflowRequestCount.get()).isZero(); // Owners skip the member-only usage query.

        googleOAuth.afterVerify = () -> pauseFixture(100);
        Instant before = Instant.now();
        ConnectionTestResult firstResult = completeOAuth.execute(firstState, "synthetic-code-1");
        Instant after = Instant.now();
        assertThat(firstResult.outcome()).isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);

        Credential firstCredential = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] firstCiphertext = firstCredential.getEncryptedPayload();
        byte[] firstPlaintext = credentialCrypto.decrypt(firstCiphertext);
        assertThat(Arrays.equals(firstCiphertext, firstPlaintext)).isFalse();
        Map<String, Object> firstPayload = payloadCodec.decode(
                connection, firstPlaintext);
        assertThat(firstPayload).containsEntry("accessToken", ACCESS_TOKEN)
                .containsEntry("refreshToken", REFRESH_TOKEN)
                .containsEntry("tokenType", "Bearer")
                .containsEntry("grantedScopes", List.of("openid", "email", GMAIL_SCOPE));
        assertThat(firstCredential.getExpiresAt()).isBetween(
                before.plusSeconds(3600), after.plusSeconds(3600));
        assertThat(firstCredential.getExpiresAt()).isBetween(
                googleOAuth.exchangedAt.plusSeconds(3599), googleOAuth.exchangedAt.plusSeconds(3601));
        assertThat(firstCredential.getExpiresAt()).isBefore(googleOAuth.verifiedAt.plusSeconds(3600));
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);

        googleOAuth.tokens = tokens("replacement-access-token", "replacement-refresh-token", gmailScopes());
        googleOAuth.afterVerify = () -> { };
        String secondState = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());
        completeOAuth.execute(secondState, "synthetic-code-2");

        Credential replacement = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(replacement.getId()).isEqualTo(firstCredential.getId());
        assertThat(replacement.getCreatedAt()).isEqualTo(firstCredential.getCreatedAt());
        assertThat(replacement.getEncryptedPayload()).isNotEqualTo(firstCiphertext);
        assertThat(replacement.getExpiresAt()).isAfter(firstCredential.getExpiresAt());
    }

    @Test
    void denialAndExchangeFailureConsumeStateAndLeaveExistingCredentialSafe() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        String denialState = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        assertThatThrownBy(() -> completeOAuth.execute(denialState, null, "access_denied"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google authorization was denied");
        assertThat(stateStore.consume(denialState)).isEmpty();
        assertThatThrownBy(() -> completeOAuth.execute(denialState, "synthetic-code"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google authorization state is invalid or expired");
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .isEqualTo(originalCiphertext);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(googleOAuth.exchangeCalls.get()).isZero();

        String exchangeState = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());
        googleOAuth.exchangeFailure = new DependencyUnavailableException();
        assertThatThrownBy(() -> completeOAuth.execute(exchangeState, "synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
        assertThat(stateStore.consume(exchangeState)).isEmpty();
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .isEqualTo(originalCiphertext);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
    }

    @Test
    void providerMismatchIsRejectedAfterStateIsConsumedAndBeforeRemoteExchange() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, false);
        String state = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());
        redis.opsForValue().set(stateKey(state), pendingJson(connection, ownerId, "GOOGLE_SHEETS"),
                Duration.ofMinutes(10));

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google authorization state does not match the connection");
        assertThat(stateStore.consume(state)).isEmpty();
        assertThat(googleOAuth.exchangeCalls.get()).isZero();
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();

        String wrongConnectionState = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());
        redis.opsForValue().set(stateKey(wrongConnectionState), pendingJson(
                connection.getWorkspaceId(), UUID.randomUUID(), ownerId, "GMAIL"), Duration.ofMinutes(10));
        assertThatThrownBy(() -> completeOAuth.execute(wrongConnectionState, "synthetic-code"))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(stateStore.consume(wrongConnectionState)).isEmpty();
        assertThat(googleOAuth.exchangeCalls.get()).isZero();
    }

    @Test
    void deniedScopeDoesNotCallVerifierOrReplaceStoredCredential() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        googleOAuth.tokens = tokens("new-synthetic-access", "new-synthetic-refresh", List.of("openid", "email"));
        String state = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google did not grant the required access");
        assertThat(googleOAuth.verifyCalls.get()).isZero();
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getId())
                .isEqualTo(original.getId());
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .isEqualTo(originalCiphertext);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
    }

    @Test
    void transientGoogleVerificationFailurePreservesThePriorCredentialAndSafeDisabledStatus() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        googleOAuth.verification = ConnectionTestResult.dependencyFailure();
        String state = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class);

        Credential current = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(current.getId()).isEqualTo(original.getId());
        assertThat(current.getEncryptedPayload()).isEqualTo(originalCiphertext);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
    }

    @Test
    void confirmedAuthFailureMarksConnectionInvalidWithoutDeletingPriorCredential() {
        UUID ownerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        googleOAuth.verification = ConnectionTestResult.authInvalid();
        String state = stateFrom(startOAuth.execute(ownerId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        ConnectionTestResult result = completeOAuth.execute(state, "synthetic-code");

        assertThat(result.outcome()).isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.INVALID);
        Credential current = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(current.getId()).isEqualTo(original.getId());
        assertThat(current.getEncryptedPayload()).isEqualTo(originalCiphertext);
    }

    @Test
    void memberUsageProtectionFailsClosedBeforeStartMutation() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, memberId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        workflowInUse.set(true);

        assertThatThrownBy(() -> startOAuth.execute(memberId,
                connection.getWorkspaceId(), connection.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Connection is used by a workflow");

        assertThat(workflowRequestCount.get()).isEqualTo(1);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .isEqualTo(originalCiphertext);

        workflowInUse.set(false);
        workflowStatus.set(503);
        assertThatThrownBy(() -> startOAuth.execute(memberId,
                connection.getWorkspaceId(), connection.getId()))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .isEqualTo(originalCiphertext);
    }

    @Test
    void memberUsageThatAppearsDuringRemoteVerificationStopsFinalPersistence() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, memberId, ConnectionProvider.GOOGLE_SHEETS, false);
        googleOAuth.tokens = tokens(ACCESS_TOKEN, REFRESH_TOKEN, sheetsScopes());
        googleOAuth.afterVerify = () -> workflowInUse.set(true);
        String state = stateFrom(startOAuth.execute(memberId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Connection is used by a workflow");
        assertThat(workflowRequestCount.get()).isEqualTo(3);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();
    }

    @Test
    void callbackRejectsTokenThatExpiresDuringFinalWorkflowUsageCheck() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, memberId, ConnectionProvider.GMAIL, true);
        Credential original = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] originalCiphertext = original.getEncryptedPayload();
        String state = stateFrom(startOAuth.execute(memberId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);

        oauthClock.freezeAt(Instant.parse("2026-09-19T10:00:00Z"));
        googleOAuth.tokens = tokens("new-expiring-access", "new-expiring-refresh", gmailScopes(), 1);
        advanceClockOnWorkflowRequest.set(3);

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");

        assertThat(workflowRequestCount.get()).isEqualTo(3);
        assertThat(stateStore.consume(state)).isEmpty();
        Credential current = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(current.getId()).isEqualTo(original.getId());
        assertThat(current.getEncryptedPayload()).isEqualTo(originalCiphertext);
        assertThat(current.getExpiresAt()).isEqualTo(original.getExpiresAt());
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
    }

    @Test
    void callbackRechecksMembershipAfterRemoteExchangeBeforeSaving() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, memberId, ConnectionProvider.GMAIL, false);
        googleOAuth.afterExchange = () -> jdbcTemplate.update(
                "delete from workspace.memberships where workspace_id = ? and user_id = ?",
                connection.getWorkspaceId(), memberId);
        String state = stateFrom(startOAuth.execute(memberId,
                connection.getWorkspaceId(), connection.getId()).authorizationUrl());

        assertThatThrownBy(() -> completeOAuth.execute(state, "synthetic-code"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Workspace not found not found");
        assertThat(googleOAuth.exchangeCalls.get()).isEqualTo(1);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();
    }

    @Test
    void startAndCallbackRequireCurrentManagePermission() {
        UUID ownerId = UUID.randomUUID();
        UUID strangerId = UUID.randomUUID();
        Connection connection = createConnection(ownerId, ownerId, ConnectionProvider.GMAIL, false);

        assertThatThrownBy(() -> startOAuth.execute(strangerId,
                connection.getWorkspaceId(), connection.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
    }

    private Connection createConnection(
            UUID ownerId,
            UUID actorId,
            ConnectionProvider provider,
            boolean withCredential) {
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Google OAuth " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        if (!ownerId.equals(actorId)) {
            membershipRepository.save(Membership.member(workspace.getId(), actorId));
        }
        Connection connection = Connection.createNew(
                workspace.getId(), actorId, "Google connection", provider, ConnectionAuthType.OAUTH2, Map.of());
        if (withCredential) {
            connection.markVerified(Instant.now());
        }
        connection = connectionRepository.save(connection);
        if (withCredential) {
            GoogleOAuthTokenResponse original = tokens(
                    "prior-synthetic-access", "prior-synthetic-refresh", scopes(provider));
            byte[] encrypted = credentialCrypto.encrypt(payloadCodec.encodeGoogleOAuth(connection, original));
            credentialRepository.save(Credential.createNew(
                    connection.getId(), encrypted, credentialCrypto.currentKeyVersion(), Instant.now().plusSeconds(1800)));
        }
        return connection;
    }

    private static String stateFrom(String authorizationUrl) {
        String query = URI.create(authorizationUrl).getRawQuery();
        return Arrays.stream(query.split("&"))
                .map(parameter -> parameter.split("=", 2))
                .filter(parameter -> "state".equals(URLDecoder.decode(parameter[0], StandardCharsets.UTF_8)))
                .map(parameter -> URLDecoder.decode(parameter[1], StandardCharsets.UTF_8))
                .findFirst()
                .orElseThrow();
    }

    private static String pendingJson(Connection connection, UUID userId, String provider) {
        return pendingJson(connection.getWorkspaceId(), connection.getId(), userId, provider);
    }

    private static String pendingJson(UUID workspaceId, UUID connectionId, UUID userId, String provider) {
        return "{\"workspaceId\":\"" + workspaceId
                + "\",\"connectionId\":\"" + connectionId
                + "\",\"userId\":\"" + userId
                + "\",\"provider\":\"" + provider + "\"}";
    }

    private static String stateKey(String state) {
        return "workspace:oauth-state:" + state;
    }

    private static GoogleOAuthTokenResponse tokens(String access, String refresh, List<String> scopes) {
        return tokens(access, refresh, scopes, 3600);
    }

    private static GoogleOAuthTokenResponse tokens(
            String access,
            String refresh,
            List<String> scopes,
            long expiresInSeconds) {
        return new GoogleOAuthTokenResponse(access, refresh, "Bearer", scopes, expiresInSeconds);
    }

    private static List<String> gmailScopes() {
        return List.of("openid", "email", GMAIL_SCOPE);
    }

    private static List<String> sheetsScopes() {
        return List.of("openid", "email", SHEETS_SCOPE);
    }

    private static List<String> scopes(ConnectionProvider provider) {
        return provider == ConnectionProvider.GMAIL ? gmailScopes() : sheetsScopes();
    }

    private static void pauseFixture(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Synthetic OAuth fixture interrupted");
        }
    }

    private static void ensureWorkflowServer() {
        if (workflowServer != null) {
            return;
        }
        try {
            workflowServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            workflowServer.createContext("/internal/workspaces/", GoogleOAuthUseCasesTest::handleWorkflowUsage);
            workflowServer.start();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not start local Workflow usage fixture", exception);
        }
    }

    private static String workflowBaseUrl() {
        return "http://127.0.0.1:" + workflowServer.getAddress().getPort();
    }

    private static void handleWorkflowUsage(HttpExchange exchange) throws IOException {
        int requestNumber = workflowRequestCount.incrementAndGet();
        if (requestNumber == advanceClockOnWorkflowRequest.get()) {
            MutableClock clock = sharedOAuthClock.get();
            if (clock == null) {
                throw new IllegalStateException("OAuth test clock was not initialized");
            }
            clock.advance(Duration.ofSeconds(2));
        }
        int status = workflowStatus.get();
        String body = status == 200 ? "{\"inUse\":" + workflowInUse.get() + "}" : "synthetic workflow unavailable";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> current;
        private final ZoneId zone;

        MutableClock() {
            this(new AtomicReference<>(), ZoneOffset.UTC);
        }

        private MutableClock(AtomicReference<Instant> current, ZoneId zone) {
            this.current = current;
            this.zone = zone;
        }

        void useSystemTime() {
            current.set(null);
        }

        void freezeAt(Instant instant) {
            current.set(instant);
        }

        void advance(Duration duration) {
            current.updateAndGet(instant -> {
                if (instant == null) {
                    throw new IllegalStateException("OAuth test clock is not frozen");
                }
                return instant.plus(duration);
            });
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId requestedZone) {
            return zone.equals(requestedZone) ? this : new MutableClock(current, requestedZone);
        }

        @Override
        public Instant instant() {
            Instant instant = current.get();
            return instant == null ? Instant.now() : instant;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class OAuthPortFixtureConfiguration {
        @Bean
        @Primary
        FixtureGoogleOAuthPort fixtureGoogleOAuthPort() {
            return new FixtureGoogleOAuthPort();
        }

        @Bean
        @Primary
        MutableClock oauthTestClock() {
            MutableClock clock = new MutableClock();
            sharedOAuthClock.set(clock);
            return clock;
        }
    }

    static final class FixtureGoogleOAuthPort implements GoogleOAuthPort {
        private final AtomicInteger exchangeCalls = new AtomicInteger();
        private final AtomicInteger verifyCalls = new AtomicInteger();
        private volatile GoogleOAuthTokenResponse tokens = tokens(ACCESS_TOKEN, REFRESH_TOKEN, gmailScopes());
        private volatile ConnectionTestResult verification = ConnectionTestResult.verified();
        private volatile RuntimeException exchangeFailure;
        private volatile Runnable afterExchange = () -> { };
        private volatile Runnable afterVerify = () -> { };
        private volatile Instant exchangedAt;
        private volatile Instant verifiedAt;

        @Override
        public String authorizationUrl(ConnectionProvider provider, String state) {
            return "https://accounts.google.com/o/oauth2/v2/auth?state="
                    + URLEncoder.encode(state, StandardCharsets.UTF_8)
                    + "&provider=" + provider.name();
        }

        @Override
        public GoogleOAuthTokenResponse exchangeAuthorizationCode(String authorizationCode) {
            exchangeCalls.incrementAndGet();
            if (exchangeFailure != null) {
                throw exchangeFailure;
            }
            afterExchange.run();
            exchangedAt = Instant.now();
            return tokens;
        }

        @Override
        public GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken) {
            throw new DependencyUnavailableException();
        }

        @Override
        public ConnectionTestResult verify(
                ConnectionProvider provider,
                String accessToken,
                List<String> grantedScopes) {
            verifyCalls.incrementAndGet();
            afterVerify.run();
            verifiedAt = Instant.now();
            return verification;
        }

        void reset() {
            tokens = tokens(ACCESS_TOKEN, REFRESH_TOKEN, gmailScopes());
            verification = ConnectionTestResult.verified();
            exchangeFailure = null;
            afterExchange = () -> { };
            afterVerify = () -> { };
            exchangedAt = null;
            verifiedAt = null;
            exchangeCalls.set(0);
            verifyCalls.set(0);
        }
    }
}
