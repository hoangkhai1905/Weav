package com.weav.workspace.presentation.http;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import com.weav.workspace.infrastructure.provider.google.GoogleConnectionProvider;
import com.weav.workspace.infrastructure.provider.http.HttpConnectionProvider;
import com.weav.workspace.infrastructure.security.JwtProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
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
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real HTTP and Spring Security coverage with PostgreSQL, Valkey, and synthetic provider fixtures. */
@Testcontainers
@Import({TestcontainersConfiguration.class, WorkspaceConnectionHttpIntegrationTest.Fixtures.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
class WorkspaceConnectionHttpIntegrationTest {

    private static final String INTERNAL_KEY = "test-workspace-key";
    private static final String ACCESS_TOKEN = "access-token-fixture";
    private static final String REFRESH_TOKEN = "refresh-token-fixture";
    private static final String TELEGRAM_SECRET = "telegram-secret-123";
    private static final String TELEGRAM_REPLACEMENT_SECRET = "telegram-rotated-secret-456";
    private static final String HTTP_PASSWORD_SECRET = "http-password-123";
    private static final String HTTP_PASSWORD_REPLACEMENT_SECRET = "http-password-rotated-456";
    private static final String GOOGLE_ACCESS_SECRET = "google-access-secret";
    private static final String GOOGLE_REFRESH_SECRET = "google-refresh-secret";
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @LocalServerPort
    private int port;

    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private MembershipRepository membershipRepository;
    @Autowired private ConnectionRepository connectionRepository;
    @Autowired private CredentialRepository credentialRepository;
    @Autowired private CredentialCryptoPort credentialCrypto;
    @Autowired private TransactionRunner transactionRunner;
    @Autowired private StringRedisTemplate redis;
    @Autowired private JwtProperties jwtProperties;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private FixtureWorkflowUsage workflowUsage;
    @Autowired private FixtureGoogleOAuthPort googleOAuth;
    @Autowired private FixtureTelegramProvider telegramProvider;
    @Autowired private FixtureConnectionRepository faultingConnections;

    private UUID ownerId;
    private UUID memberId;
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
    void seedWorkspace() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        workflowUsage.reset();
        googleOAuth.reset();
        telegramProvider.reset();
        faultingConnections.reset();
        ownerId = UUID.randomUUID();
        memberId = UUID.randomUUID();
        workspace = transactionRunner.required(() -> {
            Workspace created = workspaceRepository.save(
                    Workspace.createNew("Connection API " + UUID.randomUUID(), ownerId));
            membershipRepository.save(Membership.owner(created.getId(), ownerId));
            membershipRepository.save(Membership.member(created.getId(), memberId));
            return created;
        });
    }

    @Test
    void publicRoutesUseJwtAndKeepCredentialValuesWriteOnly() throws Exception {
        String workspacePath = "/workspaces/" + workspace.getId() + "/connections";
        String rejectedSecret = "synthetic-rejected-api-token";
        HttpResponse<String> rejectedConfig = request("POST", workspacePath, ownerId, null,
                "{\"name\":\"Rejected attempt\",\"provider\":\"HTTP\",\"authType\":\"API_KEY\","
                        + "\"config\":{\"token\":\"" + rejectedSecret + "\"}}");
        assertEquals(400, rejectedConfig.statusCode());
        assertThat(rejectedConfig.body()).doesNotContain(rejectedSecret);

        HttpResponse<String> created = request("POST", workspacePath, ownerId, null,
                "{\"name\":\"HTTP account\",\"provider\":\"HTTP\",\"authType\":\"API_KEY\","
                        + "\"config\":{\"baseUrl\":\"https://api.example.test\","
                        + "\"apiKeyHeaderName\":\"X-Api-Key\"}}");
        assertEquals(201, created.statusCode());
        JsonNode createdJson = json(created);
        UUID connectionId = UUID.fromString(createdJson.path("id").asText());
        assertEquals("DISABLED", createdJson.path("status").asText());
        assertFalse(createdJson.path("hasCredential").asBoolean());
        assertThat(createdJson.has("credential")).isFalse();
        assertThat(created.body()).doesNotContain("accessToken", "refreshToken", "encryptedPayload");

        HttpResponse<String> ownerList = request("GET", workspacePath, ownerId, null, null);
        assertEquals(200, ownerList.statusCode());
        assertEquals(1, json(ownerList).size());
        String connectionPath = workspacePath + "/" + connectionId;

        HttpResponse<String> memberDetail = request("GET", connectionPath, memberId, null, null);
        assertEquals(200, memberDetail.statusCode());
        assertTrue(json(memberDetail).path("config").isNull());
        assertFalse(memberDetail.body().contains("apiKey"));
        assertEquals(403, request("PUT", connectionPath + "/credential", memberId, null,
                "{\"payload\":{\"apiKey\":\"api-key-fixture\"}}").statusCode());

        HttpResponse<String> updated = request("PATCH", connectionPath, ownerId, null,
                "{\"name\":\"HTTP account renamed\"}");
        assertEquals(200, updated.statusCode());
        assertEquals("HTTP account renamed", json(updated).path("name").asText());

        HttpResponse<String> configUpdated = request("PATCH", connectionPath, ownerId, null,
                "{\"config\":{\"baseUrl\":\"https://api-updated.example.test\","
                        + "\"apiKeyHeaderName\":\"X-Api-Key\"}}");
        assertEquals(200, configUpdated.statusCode());
        assertEquals("https://api-updated.example.test",
                json(configUpdated).path("config").path("baseUrl").asText());
        assertEquals("DISABLED", json(configUpdated).path("status").asText());
        assertEquals(400, request("PATCH", connectionPath, ownerId, null, "{}").statusCode());

        HttpResponse<String> saved = request("PUT", connectionPath + "/credential", ownerId, null,
                "{\"payload\":{\"apiKey\":\"api-key-fixture\"}}");
        assertEquals(200, saved.statusCode());
        assertTrue(json(saved).path("hasCredential").asBoolean());
        assertFalse(saved.body().contains("api-key-fixture"));

        HttpResponse<String> tested = request("POST", connectionPath + "/test", ownerId, null, null);
        assertEquals(200, tested.statusCode());
        assertEquals("VERIFIED", json(tested).path("outcome").asText());
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        HttpResponse<String> disabled = request("POST", connectionPath + "/disable", ownerId, null, null);
        assertEquals(200, disabled.statusCode());
        assertEquals("DISABLED", json(disabled).path("status").asText());
        HttpResponse<String> removedCredential = request(
                "DELETE", connectionPath + "/credential", ownerId, null, null);
        assertEquals(200, removedCredential.statusCode());
        assertFalse(json(removedCredential).path("hasCredential").asBoolean());
        assertEquals(204, request("DELETE", connectionPath, ownerId, null, null).statusCode());
        assertThat(connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)).isEmpty();

        assertEquals(401, request("GET", workspacePath, null, INTERNAL_KEY, null).statusCode());
    }

    @Test
    void callbackConsumesStateAndInternalRoutesNeverExposeRefreshTokens() throws Exception {
        String connectionsPath = "/workspaces/" + workspace.getId() + "/connections";
        HttpResponse<String> created = request("POST", connectionsPath, ownerId, null,
                "{\"name\":\"Gmail account\",\"provider\":\"GMAIL\",\"authType\":\"OAUTH2\",\"config\":{}}");
        assertEquals(201, created.statusCode());
        UUID connectionId = UUID.fromString(json(created).path("id").asText());
        String connectionPath = connectionsPath + "/" + connectionId;

        assertEquals(401, request("POST", connectionPath + "/oauth/authorize", null, null, null).statusCode());
        HttpResponse<String> authorization = request(
                "POST", connectionPath + "/oauth/authorize", ownerId, null, null);
        assertEquals(200, authorization.statusCode());
        assertEquals("no-store", authorization.headers().firstValue("Cache-Control").orElseThrow());
        String state = queryParameter(URI.create(json(authorization).path("authorizationUrl").asText()), "state");
        String internalPath = "/internal/workspaces/" + workspace.getId() + "/connections/" + connectionId;
        assertEquals(401, request("POST", internalPath + "/resolve", null, null, null).statusCode());
        assertEquals(401, request("POST", internalPath + "/resolve", null, "wrong-service-key", null).statusCode());

        HttpResponse<String> callback = request(
                "GET", "/oauth/google/callback?state=" + state + "&code=synthetic-code", null, null, null);
        assertEquals(302, callback.statusCode());
        URI successLocation = URI.create(callback.headers().firstValue("Location").orElseThrow());
        Map<String, String> successQuery = queryParameters(successLocation);
        assertEquals("success", successQuery.get("oauth"));
        assertEquals(connectionId.toString(), successQuery.get("connectionId"));
        assertEquals("localhost", successLocation.getHost());
        assertEquals("/connections", successLocation.getPath());
        assertThat(successLocation.toString()).doesNotContain(state, "synthetic-code");
        assertEquals("no-store", callback.headers().firstValue("Cache-Control").orElseThrow());
        assertFalse(successLocation.toString().contains(ACCESS_TOKEN));
        assertFalse(successLocation.toString().contains(REFRESH_TOKEN));
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        var credential = credentialRepository.findByConnectionId(connectionId).orElseThrow();
        String ciphertext = new String(credential.getEncryptedPayload(), StandardCharsets.UTF_8);
        assertFalse(ciphertext.contains(ACCESS_TOKEN));
        assertFalse(ciphertext.contains(REFRESH_TOKEN));
        String plaintext = new String(credentialCrypto.decrypt(credential.getEncryptedPayload()),
                StandardCharsets.UTF_8);
        assertTrue(plaintext.contains(ACCESS_TOKEN));
        assertTrue(plaintext.contains(REFRESH_TOKEN));

        assertEquals(204, request("POST", internalPath + "/authorize-attachment", null, INTERNAL_KEY,
                "{\"userId\":\"" + ownerId + "\"}").statusCode());
        assertEquals(403, request("POST", internalPath + "/authorize-attachment", null, INTERNAL_KEY,
                "{\"userId\":\"" + memberId + "\"}").statusCode());

        HttpResponse<String> resolved = request("POST", internalPath + "/resolve", null, INTERNAL_KEY, null);
        assertEquals(200, resolved.statusCode());
        assertEquals("no-store", resolved.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(ACCESS_TOKEN, json(resolved).path("auth").path("accessToken").asText());
        assertFalse(resolved.body().contains(REFRESH_TOKEN));

        HttpResponse<String> replay = request(
                "GET", "/oauth/google/callback?state=" + state + "&code=synthetic-code", null, null, null);
        assertEquals(302, replay.statusCode());
        Map<String, String> replayQuery = queryParameters(
                URI.create(replay.headers().firstValue("Location").orElseThrow()));
        assertEquals("failed", replayQuery.get("oauth"));
        assertEquals("state_invalid", replayQuery.get("reason"));
        assertFalse(replayQuery.containsKey("connectionId"));

        assertEquals(204, request("POST", internalPath + "/auth-failure", null, INTERNAL_KEY,
                "{\"failureCode\":\"AUTHENTICATION_REJECTED\"}").statusCode());
        assertEquals(ConnectionStatus.INVALID,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());
        assertEquals(422, request("POST", internalPath + "/resolve", null, INTERNAL_KEY, null).statusCode());

        HttpResponse<String> reauthorization = request(
                "POST", connectionPath + "/oauth/authorize", ownerId, null, null);
        assertEquals(200, reauthorization.statusCode());
        String denialState = queryParameter(
                URI.create(json(reauthorization).path("authorizationUrl").asText()), "state");
        HttpResponse<String> deniedCallback = request(
                "GET", "/oauth/google/callback?state=" + denialState
                        + "&error=synthetic-private-provider-detail"
                        + "&redirect_uri=https%3A%2F%2Fevil.example%2Fcollect", null, null, null);
        assertEquals(302, deniedCallback.statusCode());
        Map<String, String> deniedQuery = queryParameters(
                URI.create(deniedCallback.headers().firstValue("Location").orElseThrow()));
        assertEquals("authorization_denied", deniedQuery.get("reason"));
        assertEquals(connectionId.toString(), deniedQuery.get("connectionId"));
        URI deniedLocation = URI.create(deniedCallback.headers().firstValue("Location").orElseThrow());
        assertEquals("localhost", deniedLocation.getHost());
        assertThat(deniedLocation.toString()).doesNotContain("synthetic-private-provider-detail", "evil.example");
        assertThat(credentialRepository.findByConnectionId(connectionId)).isPresent();
    }

    @Test
    void callbackMapsDenialExchangeAndVerificationFailuresToSafeRedirectsWithoutJwt() throws Exception {
        UUID deniedConnectionId = createGoogleConnection(ownerId, "Denied account");
        String deniedState = startOAuth(ownerId, deniedConnectionId);
        HttpResponse<String> denied = request(
                "GET", "/oauth/google/callback?state=" + deniedState
                        + "&error=access_denied&error_description=synthetic-private-denial-detail",
                null, null, null);
        assertSafeCallbackFailure(
                denied, "authorization_denied", deniedConnectionId,
                "access_denied", "synthetic-private-denial-detail");

        UUID exchangeFailureConnectionId = createGoogleConnection(ownerId, "Exchange failure account");
        String exchangeFailureState = startOAuth(ownerId, exchangeFailureConnectionId);
        String exchangeFailureCode = "synthetic-exchange-failure-code";
        HttpResponse<String> exchangeFailure = request(
                "GET", "/oauth/google/callback?state=" + exchangeFailureState
                        + "&code=" + exchangeFailureCode,
                null, null, null);
        assertSafeCallbackFailure(
                exchangeFailure, "token_exchange_failed", exchangeFailureConnectionId,
                exchangeFailureCode, "private-token-endpoint-detail");

        UUID verificationFailureConnectionId = createGoogleConnection(ownerId, "Verification failure account");
        String verificationFailureState = startOAuth(ownerId, verificationFailureConnectionId);
        String verificationFailureCode = "synthetic-verification-failure-code";
        HttpResponse<String> verificationFailure = request(
                "GET", "/oauth/google/callback?state=" + verificationFailureState
                        + "&code=" + verificationFailureCode,
                null, null, null);
        assertSafeCallbackFailure(
                verificationFailure, "verification_failed", verificationFailureConnectionId,
                verificationFailureCode, "private-verification-detail");
    }

    @Test
    void callbackMapsRemovedMembershipAndPersistenceFailureSafelyAfterConsumingState() throws Exception {
        UUID memberConnectionId = createGoogleConnection(memberId, "Member connection");
        String memberState = startOAuth(memberId, memberConnectionId);
        googleOAuth.beforeNextExchange(() -> transactionRunner.required(() -> {
            Membership membership = membershipRepository
                    .findByWorkspaceIdAndUserId(workspace.getId(), memberId)
                    .orElseThrow();
            membershipRepository.delete(membership);
            return Boolean.TRUE;
        }));
        HttpResponse<String> removedMemberCallback = request(
                "GET", "/oauth/google/callback?state=" + memberState + "&code=synthetic-code",
                null, null, null);
        assertSafeCallbackFailure(
                removedMemberCallback, "authorization_changed", memberConnectionId,
                "synthetic-code", "access-token-fixture", "refresh-token-fixture");
        assertThat(membershipRepository.findByWorkspaceIdAndUserId(workspace.getId(), memberId)).isEmpty();

        HttpResponse<String> removedMemberReplay = request(
                "GET", "/oauth/google/callback?state=" + memberState + "&code=synthetic-code",
                null, null, null);
        assertInvalidStateWithoutConnectionId(removedMemberReplay);

        UUID persistenceFailureConnectionId = createGoogleConnection(ownerId, "Persistence failure account");
        String persistenceFailureState = startOAuth(ownerId, persistenceFailureConnectionId);
        faultingConnections.failNextSave();
        HttpResponse<String> persistenceFailure = request(
                "GET", "/oauth/google/callback?state=" + persistenceFailureState
                        + "&code=synthetic-code",
                null, null, null);
        assertSafeCallbackFailure(
                persistenceFailure, "authorization_changed", persistenceFailureConnectionId,
                "synthetic-code", "synthetic-persistence-private-detail",
                "access-token-fixture", "refresh-token-fixture");
        assertEquals(ConnectionStatus.DISABLED,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), persistenceFailureConnectionId)
                        .orElseThrow().getStatus());
        assertThat(credentialRepository.findByConnectionId(persistenceFailureConnectionId)).isEmpty();

        HttpResponse<String> persistenceFailureReplay = request(
                "GET", "/oauth/google/callback?state=" + persistenceFailureState
                        + "&code=synthetic-code",
                null, null, null);
        assertInvalidStateWithoutConnectionId(persistenceFailureReplay);
    }

    @Test
    void telegramCredentialLifecycleResolvesOnlyThroughInternalHttpAndRedactsSecretPaths(
            CapturedOutput output) throws Exception {
        String connectionsPath = "/workspaces/" + workspace.getId() + "/connections";
        HttpResponse<String> created = request("POST", connectionsPath, ownerId, null,
                "{\"name\":\"Telegram bot\",\"provider\":\"TELEGRAM\","
                        + "\"authType\":\"TOKEN\",\"config\":{}}");
        assertEquals(201, created.statusCode());
        UUID connectionId = UUID.fromString(json(created).path("id").asText());
        assertEquals("DISABLED", json(created).path("status").asText());
        assertThat(created.body()).doesNotContain(TELEGRAM_SECRET);
        String connectionPath = connectionsPath + "/" + connectionId;

        HttpResponse<String> forbiddenSave = request("PUT", connectionPath + "/credential", memberId, null,
                "{\"payload\":{\"token\":\"" + TELEGRAM_SECRET + "\"}}");
        assertEquals(403, forbiddenSave.statusCode());
        assertThat(forbiddenSave.body()).doesNotContain(TELEGRAM_SECRET);
        assertThat(credentialRepository.findByConnectionId(connectionId)).isEmpty();

        HttpResponse<String> saved = request("PUT", connectionPath + "/credential", ownerId, null,
                "{\"payload\":{\"token\":\"" + TELEGRAM_SECRET + "\"}}");
        assertEquals(200, saved.statusCode());
        assertEquals("DISABLED", json(saved).path("status").asText());
        assertTrue(json(saved).path("hasCredential").asBoolean());
        assertThat(saved.body()).doesNotContain(TELEGRAM_SECRET);

        HttpResponse<String> publicDetail = request("GET", connectionPath, ownerId, null, null);
        assertEquals(200, publicDetail.statusCode());
        assertThat(publicDetail.body()).doesNotContain(TELEGRAM_SECRET);
        assertThat(json(publicDetail).has("credential")).isFalse();
        assertThat(publicDetail.body()).doesNotContain("\"token\"");

        HttpResponse<String> tested = request("POST", connectionPath + "/test", ownerId, null, null);
        assertEquals(200, tested.statusCode());
        assertEquals("VERIFIED", json(tested).path("outcome").asText());
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());
        assertEquals(Map.of("token", TELEGRAM_SECRET), telegramProvider.lastTestCredential());
        assertThat(tested.body()).doesNotContain(TELEGRAM_SECRET);

        String internalPath = "/internal/workspaces/" + workspace.getId()
                + "/connections/" + connectionId;
        HttpResponse<String> missingKey = request("POST", internalPath + "/resolve", null, null, null);
        HttpResponse<String> wrongKey = request("POST", internalPath + "/resolve", null, "wrong-service-key", null);
        assertEquals(401, missingKey.statusCode());
        assertEquals(401, wrongKey.statusCode());
        assertThat(missingKey.body()).doesNotContain(TELEGRAM_SECRET);
        assertThat(wrongKey.body()).doesNotContain(TELEGRAM_SECRET);

        HttpResponse<String> resolved = request("POST", internalPath + "/resolve", null, INTERNAL_KEY, null);
        assertEquals(200, resolved.statusCode());
        assertEquals("no-store", resolved.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(1, json(resolved).path("auth").size());
        assertEquals(TELEGRAM_SECRET, json(resolved).path("auth").path("token").asText());

        HttpResponse<String> replaced = request("PUT", connectionPath + "/credential", ownerId, null,
                "{\"payload\":{\"token\":\"" + TELEGRAM_REPLACEMENT_SECRET + "\"}}");
        assertEquals(200, replaced.statusCode());
        assertEquals("DISABLED", json(replaced).path("status").asText());
        assertThat(replaced.body()).doesNotContain(TELEGRAM_SECRET, TELEGRAM_REPLACEMENT_SECRET);
        assertEquals(ConnectionStatus.DISABLED,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());
        var stored = credentialRepository.findByConnectionId(connectionId).orElseThrow();
        String ciphertext = new String(stored.getEncryptedPayload(), StandardCharsets.UTF_8);
        assertThat(ciphertext).doesNotContain(TELEGRAM_SECRET, TELEGRAM_REPLACEMENT_SECRET);
        String plaintext = new String(credentialCrypto.decrypt(stored.getEncryptedPayload()), StandardCharsets.UTF_8);
        assertThat(plaintext).contains(TELEGRAM_REPLACEMENT_SECRET).doesNotContain(TELEGRAM_SECRET);
        assertThat(output.getAll()).doesNotContain(TELEGRAM_SECRET, TELEGRAM_REPLACEMENT_SECRET);
    }

    @Test
    void googleSheetsOAuthKeepsStateAndFailuresSecretFreeAndResolvesAccessTokenOnly(
            CapturedOutput output) throws Exception {
        UUID connectionId = createGoogleSheetsConnection(ownerId, "Sheets account");
        HttpResponse<String> publicCreated = request(
                "GET", "/workspaces/" + workspace.getId() + "/connections/" + connectionId,
                ownerId, null, null);
        assertEquals(200, publicCreated.statusCode());
        assertThat(publicCreated.body()).doesNotContain(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);

        String state = startOAuth(ownerId, connectionId);
        Set<String> pendingStateKeys = redis.keys("workspace:oauth-state:*");
        assertThat(pendingStateKeys).hasSize(1);
        String redisState = redis.opsForValue().get(pendingStateKeys.iterator().next());
        assertThat(redisState)
                .contains(workspace.getId().toString(), connectionId.toString(), ownerId.toString(), "GOOGLE_SHEETS")
                .doesNotContain(TELEGRAM_SECRET, HTTP_PASSWORD_SECRET, GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);

        String code = "synthetic-sheets-code";
        HttpResponse<String> callback = request(
                "GET", "/oauth/google/callback?state=" + state + "&code=" + code, null, null, null);
        assertEquals(302, callback.statusCode());
        assertEquals("no-store", callback.headers().firstValue("Cache-Control").orElseThrow());
        URI successLocation = URI.create(callback.headers().firstValue("Location").orElseThrow());
        assertEquals("success", queryParameters(successLocation).get("oauth"));
        assertEquals(connectionId.toString(), queryParameters(successLocation).get("connectionId"));
        assertThat(successLocation.toString()).doesNotContain(
                state, code, GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);
        assertThat(callback.body()).isEmpty();
        assertThat(redis.keys("workspace:oauth-state:*")).isEmpty();
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        var stored = credentialRepository.findByConnectionId(connectionId).orElseThrow();
        String ciphertext = new String(stored.getEncryptedPayload(), StandardCharsets.UTF_8);
        assertThat(ciphertext).doesNotContain(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);
        String plaintext = new String(credentialCrypto.decrypt(stored.getEncryptedPayload()), StandardCharsets.UTF_8);
        assertThat(plaintext).contains(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET, "spreadsheets")
                .doesNotContain("gmail.metadata");

        HttpResponse<String> publicDetail = request(
                "GET", "/workspaces/" + workspace.getId() + "/connections/" + connectionId,
                ownerId, null, null);
        assertEquals(200, publicDetail.statusCode());
        assertThat(publicDetail.body()).doesNotContain(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);

        String internalPath = "/internal/workspaces/" + workspace.getId()
                + "/connections/" + connectionId;
        for (String serviceKey : new String[]{null, "wrong-service-key"}) {
            HttpResponse<String> rejected = request("POST", internalPath + "/resolve", null, serviceKey, null);
            assertEquals(401, rejected.statusCode());
            assertThat(rejected.body()).doesNotContain(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);
        }
        HttpResponse<String> resolved = request("POST", internalPath + "/resolve", null, INTERNAL_KEY, null);
        assertEquals(200, resolved.statusCode());
        assertEquals(1, json(resolved).path("auth").size());
        assertEquals(GOOGLE_ACCESS_SECRET, json(resolved).path("auth").path("accessToken").asText());
        assertThat(resolved.body()).doesNotContain(GOOGLE_REFRESH_SECRET);

        HttpResponse<String> replay = request(
                "GET", "/oauth/google/callback?state=" + state + "&code=" + code, null, null, null);
        assertInvalidStateWithoutConnectionId(replay);
        assertThat(URI.create(replay.headers().firstValue("Location").orElseThrow()).toString())
                .doesNotContain(state, code, GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);

        UUID failedConnectionId = createGoogleSheetsConnection(ownerId, "Sheets verification failure");
        String failedState = startOAuth(ownerId, failedConnectionId);
        String failedCode = "synthetic-sheets-verification-failure-code";
        googleOAuth.failNextVerification();
        HttpResponse<String> failedCallback = request(
                "GET", "/oauth/google/callback?state=" + failedState + "&code=" + failedCode,
                null, null, null);
        assertSafeCallbackFailure(
                failedCallback, "verification_failed", failedConnectionId,
                failedState, failedCode, GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);
        assertEquals(ConnectionStatus.DISABLED,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), failedConnectionId)
                        .orElseThrow().getStatus());
        assertThat(credentialRepository.findByConnectionId(failedConnectionId)).isEmpty();
        assertThat(redis.keys("workspace:oauth-state:*")).isEmpty();
        assertThat(output.getAll()).doesNotContain(GOOGLE_ACCESS_SECRET, GOOGLE_REFRESH_SECRET);
    }

    @Test
    void workflowUsageBlocksReferencedMemberChangesAndFailsClosedOnOutage(CapturedOutput output) throws Exception {
        String connectionsPath = "/workspaces/" + workspace.getId() + "/connections";
        HttpResponse<String> created = request("POST", connectionsPath, memberId, null,
                "{\"name\":\"HTTP account\",\"provider\":\"HTTP\",\"authType\":\"BASIC\","
                        + "\"config\":{\"baseUrl\":\"https://api.example.test\"}}");
        assertEquals(201, created.statusCode());
        UUID connectionId = UUID.fromString(json(created).path("id").asText());
        String connectionPath = connectionsPath + "/" + connectionId;
        assertEquals("DISABLED", json(created).path("status").asText());

        HttpResponse<String> credentialSaved = request("PUT", connectionPath + "/credential", memberId, null,
                "{\"payload\":{\"username\":\"synthetic-user\",\"password\":\""
                        + HTTP_PASSWORD_SECRET + "\"}}");
        assertEquals(200, credentialSaved.statusCode());
        assertThat(credentialSaved.body()).doesNotContain(HTTP_PASSWORD_SECRET);
        HttpResponse<String> tested = request("POST", connectionPath + "/test", memberId, null, null);
        assertEquals(200, tested.statusCode());
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        workflowUsage.setInUse(true);
        HttpResponse<String> blockedUpdate = request("PATCH", connectionPath, memberId, null,
                "{\"name\":\"Blocked member update\"}");
        assertEquals(409, blockedUpdate.statusCode());
        assertThat(blockedUpdate.body()).doesNotContain(HTTP_PASSWORD_SECRET);
        assertEquals("HTTP account", connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                .orElseThrow().getName());
        assertEquals(ConnectionStatus.ACTIVE,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        int checksBeforeOwnerRotation = workflowUsage.checkCount();
        HttpResponse<String> ownerRotation = request("PUT", connectionPath + "/credential", ownerId, null,
                "{\"payload\":{\"username\":\"synthetic-user\",\"password\":\""
                        + HTTP_PASSWORD_REPLACEMENT_SECRET + "\"}}");
        assertEquals(200, ownerRotation.statusCode());
        assertEquals(checksBeforeOwnerRotation, workflowUsage.checkCount());
        assertThat(ownerRotation.body()).doesNotContain(HTTP_PASSWORD_SECRET, HTTP_PASSWORD_REPLACEMENT_SECRET);
        assertEquals(ConnectionStatus.DISABLED,
                connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                        .orElseThrow().getStatus());

        HttpResponse<String> blockedDelete = request("DELETE", connectionPath, ownerId, null, null);
        assertEquals(409, blockedDelete.statusCode());
        assertThat(blockedDelete.body()).doesNotContain(HTTP_PASSWORD_SECRET, HTTP_PASSWORD_REPLACEMENT_SECRET);
        assertThat(connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)).isPresent();
        assertThat(credentialRepository.findByConnectionId(connectionId)).isPresent();

        workflowUsage.setUnavailable(true);
        HttpResponse<String> unavailableUpdate = request("PATCH", connectionPath, memberId, null,
                "{\"name\":\"Must not be persisted\"}");
        assertEquals(503, unavailableUpdate.statusCode());
        assertThat(unavailableUpdate.body()).doesNotContain(HTTP_PASSWORD_SECRET, HTTP_PASSWORD_REPLACEMENT_SECRET);
        assertEquals("HTTP account", connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)
                .orElseThrow().getName());

        HttpResponse<String> unavailableDelete = request("DELETE", connectionPath, ownerId, null, null);
        assertEquals(503, unavailableDelete.statusCode());
        assertThat(unavailableDelete.body()).doesNotContain(HTTP_PASSWORD_SECRET, HTTP_PASSWORD_REPLACEMENT_SECRET);
        assertThat(connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connectionId)).isPresent();
        assertThat(credentialRepository.findByConnectionId(connectionId)).isPresent();
        String plaintext = new String(credentialCrypto.decrypt(
                credentialRepository.findByConnectionId(connectionId).orElseThrow().getEncryptedPayload()),
                StandardCharsets.UTF_8);
        assertThat(plaintext).contains(HTTP_PASSWORD_REPLACEMENT_SECRET).doesNotContain(HTTP_PASSWORD_SECRET);
        assertThat(output.getAll()).doesNotContain(HTTP_PASSWORD_SECRET, HTTP_PASSWORD_REPLACEMENT_SECRET);
    }

    private UUID createGoogleConnection(UUID actorId, String name) throws Exception {
        HttpResponse<String> created = request(
                "POST", "/workspaces/" + workspace.getId() + "/connections", actorId, null,
                "{\"name\":\"" + name + "\",\"provider\":\"GMAIL\",\"authType\":\"OAUTH2\",\"config\":{}}");
        assertEquals(201, created.statusCode());
        return UUID.fromString(json(created).path("id").asText());
    }

    private UUID createGoogleSheetsConnection(UUID actorId, String name) throws Exception {
        HttpResponse<String> created = request(
                "POST", "/workspaces/" + workspace.getId() + "/connections", actorId, null,
                "{\"name\":\"" + name + "\",\"provider\":\"GOOGLE_SHEETS\","
                        + "\"authType\":\"OAUTH2\",\"config\":{}}");
        assertEquals(201, created.statusCode());
        return UUID.fromString(json(created).path("id").asText());
    }

    private String startOAuth(UUID actorId, UUID connectionId) throws Exception {
        HttpResponse<String> authorization = request(
                "POST", "/workspaces/" + workspace.getId() + "/connections/" + connectionId + "/oauth/authorize",
                actorId, null, null);
        assertEquals(200, authorization.statusCode());
        return queryParameter(URI.create(json(authorization).path("authorizationUrl").asText()), "state");
    }

    private void assertSafeCallbackFailure(
            HttpResponse<String> response,
            String expectedReason,
            UUID expectedConnectionId,
            String... forbiddenValues) {
        assertEquals(302, response.statusCode());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertThat(response.body()).isEmpty();
        URI location = URI.create(response.headers().firstValue("Location").orElseThrow());
        assertEquals("http", location.getScheme());
        assertEquals("localhost", location.getHost());
        assertEquals(3000, location.getPort());
        assertEquals("/connections", location.getPath());
        Map<String, String> query = queryParameters(location);
        assertEquals("failed", query.get("oauth"));
        assertEquals(expectedReason, query.get("reason"));
        assertEquals(expectedConnectionId.toString(), query.get("connectionId"));
        assertThat(query.keySet()).containsExactlyInAnyOrder("oauth", "reason", "connectionId");
        assertThat(location.toString()).doesNotContain(forbiddenValues);
    }

    private void assertInvalidStateWithoutConnectionId(HttpResponse<String> response) {
        assertEquals(302, response.statusCode());
        URI location = URI.create(response.headers().firstValue("Location").orElseThrow());
        assertEquals("http", location.getScheme());
        Map<String, String> query = queryParameters(location);
        assertEquals("failed", query.get("oauth"));
        assertEquals("state_invalid", query.get("reason"));
        assertFalse(query.containsKey("connectionId"));
        assertThat(query.keySet()).containsExactlyInAnyOrder("oauth", "reason");
    }

    private HttpResponse<String> request(
            String method, String path, UUID subject, String serviceKey, String body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + "/workspace" + path))
                .timeout(Duration.ofSeconds(10));
        if (subject != null) {
            builder.header("Authorization", "Bearer " + signedToken(subject));
        }
        if (serviceKey != null) {
            builder.header("X-Internal-Service-Key", serviceKey);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        builder.method(method, body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode json(HttpResponse<String> response) throws Exception {
        return objectMapper.readTree(response.body());
    }

    private String signedToken(UUID subject) {
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

    private String queryParameter(URI uri, String name) {
        String value = queryParameters(uri).get(name);
        if (value == null) {
            throw new AssertionError("Expected query parameter " + name);
        }
        return value;
    }

    private Map<String, String> queryParameters(URI uri) {
        if (uri.getRawQuery() == null || uri.getRawQuery().isBlank()) {
            return Map.of();
        }
        return java.util.Arrays.stream(uri.getRawQuery().split("&"))
                .map(pair -> pair.split("=", 2))
                .filter(pair -> pair.length == 2)
                .collect(java.util.stream.Collectors.toMap(
                        pair -> URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
                        pair -> URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixtures {

        @Bean
        @Primary
        ConnectionProviderRegistry fixtureConnectionProviderRegistry(
                FixtureTelegramProvider telegramProvider,
                HttpConnectionProvider httpProvider,
                @Qualifier("gmailConnectionProvider") GoogleConnectionProvider gmailProvider,
                @Qualifier("googleSheetsConnectionProvider") GoogleConnectionProvider sheetsProvider) {
            return new ConnectionProviderRegistry(telegramProvider, httpProvider, gmailProvider, sheetsProvider);
        }

        @Bean
        FixtureTelegramProvider fixtureTelegramProvider() {
            return new FixtureTelegramProvider();
        }

        @Bean
        @Primary
        FixtureGoogleOAuthPort fixtureGoogleOAuthPort(GoogleOAuthScopePolicy policy) {
            return new FixtureGoogleOAuthPort(policy);
        }

        @Bean
        @Primary
        FixtureWorkflowUsage fixtureWorkflowUsage() {
            return new FixtureWorkflowUsage();
        }

        @Bean
        @Primary
        FixtureConnectionRepository fixtureConnectionRepository(
                @Qualifier("connectionRepositoryAdapter") ConnectionRepository delegate) {
            return new FixtureConnectionRepository(delegate);
        }
    }

    static final class FixtureGoogleOAuthPort implements GoogleOAuthPort {

        private final GoogleOAuthScopePolicy policy;
        private final AtomicReference<Runnable> beforeExchange = new AtomicReference<>();
        private final AtomicBoolean failNextVerification = new AtomicBoolean();

        FixtureGoogleOAuthPort(GoogleOAuthScopePolicy policy) {
            this.policy = policy;
        }

        @Override
        public String authorizationUrl(ConnectionProvider provider, String state) {
            return "https://accounts.google.com/o/oauth2/v2/auth?provider=" + provider.name() + "&state=" + state;
        }

        @Override
        public GoogleOAuthTokenResponse exchangeAuthorizationCode(String code) {
            Runnable exchangeHook = beforeExchange.getAndSet(null);
            if (exchangeHook != null) {
                exchangeHook.run();
            }
            boolean sheetsCode = "synthetic-sheets-code".equals(code)
                    || "synthetic-sheets-verification-failure-code".equals(code);
            if ("synthetic-exchange-failure-code".equals(code)) {
                throw new DependencyUnavailableException();
            }
            if (!"synthetic-code".equals(code)
                    && !sheetsCode
                    && !"synthetic-verification-failure-code".equals(code)) {
                throw new BadRequestException("Google authorization response is invalid");
            }
            if (sheetsCode) {
                return new GoogleOAuthTokenResponse(
                        GOOGLE_ACCESS_SECRET,
                        GOOGLE_REFRESH_SECRET,
                        "Bearer",
                        policy.requiredScopes(ConnectionProvider.GOOGLE_SHEETS),
                        3600);
            }
            String accessToken = "synthetic-verification-failure-code".equals(code)
                    ? "verification-access-token-fixture"
                    : ACCESS_TOKEN;
            return new GoogleOAuthTokenResponse(
                    accessToken, REFRESH_TOKEN, "Bearer", policy.requiredScopes(ConnectionProvider.GMAIL), 3600);
        }

        @Override
        public GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken) {
            throw new UnsupportedOperationException("Task 9 fixture does not exercise token refresh");
        }

        @Override
        public ConnectionTestResult verify(ConnectionProvider provider, String accessToken, List<String> scopes) {
            if (failNextVerification.compareAndSet(true, false)
                    || "verification-access-token-fixture".equals(accessToken)) {
                return ConnectionTestResult.dependencyFailure();
            }
            return ConnectionTestResult.verified();
        }

        void failNextVerification() {
            failNextVerification.set(true);
        }

        void beforeNextExchange(Runnable action) {
            beforeExchange.set(action);
        }

        void reset() {
            beforeExchange.set(null);
            failNextVerification.set(false);
        }
    }

    static final class FixtureTelegramProvider implements ConnectionProviderPort {

        private final AtomicReference<Map<String, Object>> lastTestCredential = new AtomicReference<>();

        @Override
        public ConnectionProvider provider() {
            return ConnectionProvider.TELEGRAM;
        }

        @Override
        public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
            if (authType != ConnectionAuthType.TOKEN || (config != null && !config.isEmpty())) {
                throw new BadRequestException("Telegram connection configuration is invalid");
            }
        }

        @Override
        public ConnectionTestResult test(Connection connection, Map<String, Object> decryptedCredential) {
            lastTestCredential.set(Map.copyOf(decryptedCredential));
            return ConnectionTestResult.verified();
        }

        Map<String, Object> lastTestCredential() {
            return lastTestCredential.get();
        }

        void reset() {
            lastTestCredential.set(null);
        }
    }

    static final class FixtureConnectionRepository implements ConnectionRepository {

        private final ConnectionRepository delegate;
        private final AtomicBoolean failNextSave = new AtomicBoolean();

        FixtureConnectionRepository(ConnectionRepository delegate) {
            this.delegate = delegate;
        }

        @Override
        public com.weav.workspace.domain.model.Connection save(
                com.weav.workspace.domain.model.Connection connection) {
            if (failNextSave.compareAndSet(true, false)) {
                throw new DataAccessResourceFailureException("synthetic-persistence-private-detail");
            }
            return delegate.save(connection);
        }

        @Override
        public java.util.Optional<com.weav.workspace.domain.model.Connection> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public java.util.Optional<com.weav.workspace.domain.model.Connection> findByWorkspaceIdAndId(
                UUID workspaceId,
                UUID connectionId) {
            return delegate.findByWorkspaceIdAndId(workspaceId, connectionId);
        }

        @Override
        public java.util.List<com.weav.workspace.domain.model.Connection> findAllByWorkspaceId(UUID workspaceId) {
            return delegate.findAllByWorkspaceId(workspaceId);
        }

        @Override
        public boolean existsByWorkspaceIdAndNameNormalized(
                UUID workspaceId,
                String normalizedName,
                UUID excludingConnectionId) {
            return delegate.existsByWorkspaceIdAndNameNormalized(
                    workspaceId, normalizedName, excludingConnectionId);
        }

        @Override
        public void delete(com.weav.workspace.domain.model.Connection connection) {
            delegate.delete(connection);
        }

        void failNextSave() {
            failNextSave.set(true);
        }

        void reset() {
            failNextSave.set(false);
        }
    }

    static final class FixtureWorkflowUsage implements WorkflowConnectionUsagePort {

        private final AtomicBoolean inUse = new AtomicBoolean();
        private final AtomicBoolean unavailable = new AtomicBoolean();
        private final AtomicInteger checkCount = new AtomicInteger();

        @Override
        public boolean isInUse(UUID workspaceId, UUID connectionId) {
            checkCount.incrementAndGet();
            if (unavailable.get()) {
                throw new DependencyUnavailableException();
            }
            return inUse.get();
        }

        void setInUse(boolean value) {
            inUse.set(value);
        }

        void setUnavailable(boolean value) {
            unavailable.set(value);
        }

        int checkCount() {
            return checkCount.get();
        }

        void reset() {
            inUse.set(false);
            unavailable.set(false);
            checkCount.set(0);
        }
    }
}
