package com.weav.workspace.application.usecase;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.ResolvedConnectionCredential;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.AuthenticationRejectedException;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvalidStateException;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import({TestcontainersConfiguration.class, InternalConnectionUseCasesTest.FixtureConfiguration.class})
@SpringBootTest
class InternalConnectionUseCasesTest {

    private static final String GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
    private static final String SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
    private static final String EMAIL_ALIAS = "https://www.googleapis.com/auth/userinfo.email";
    private static final String OLD_ACCESS_TOKEN = "synthetic-old-access-token";
    private static final String OLD_REFRESH_TOKEN = "synthetic-old-refresh-token";

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
    private TransactionRunner transactionRunner;

    @Autowired
    private GoogleOAuthScopePolicy scopePolicy;

    @Autowired
    private ResolveConnectionUseCase resolveConnection;

    @Autowired
    private AuthorizeConnectionAttachmentUseCase authorizeAttachment;

    @Autowired
    private ReportConnectionAuthFailureUseCase reportAuthFailure;

    @Autowired
    private FixtureGoogleOAuthPort googleOAuth;

    @Autowired
    private MutableClock clock;

    @BeforeEach
    void resetFixtures() {
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        googleOAuth.reset();
    }

    @Test
    void resolutionIsWorkspaceScopedActiveOnlyAndRequiresAStoredCredential() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection disabled = createConnection(
                workspace, ownerId, ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN,
                ConnectionStatus.DISABLED, Map.of());
        Connection invalid = createConnection(
                workspace, ownerId, ConnectionProvider.HTTP, ConnectionAuthType.BASIC,
                ConnectionStatus.INVALID, Map.of("baseUrl", "https://api.example.test"));
        Connection missingCredential = createConnection(
                workspace, ownerId, ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN,
                ConnectionStatus.ACTIVE, Map.of());

        assertThatThrownBy(() -> resolveConnection.execute(UUID.randomUUID(), disabled.getId()))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Connection not found");
        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), disabled.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection is not active");
        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), invalid.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection is not active");
        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), missingCredential.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection credential is missing");
        assertThat(googleOAuth.refreshCalls.get()).isZero();
    }

    @Test
    void expiredNonRefreshableCredentialIsRejectedWithoutMutation() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.HTTP, ConnectionAuthType.BASIC,
                ConnectionStatus.ACTIVE, Map.of("baseUrl", "https://api.example.test"));
        Credential credential = saveCredential(connection,
                Map.of("username", "synthetic-user", "password", "synthetic-password"),
                clock.instant().minusSeconds(1));

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection credential has expired");
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .containsExactly(credential.getEncryptedPayload());
        assertThat(googleOAuth.refreshCalls.get()).isZero();
    }

    @Test
    void returnsOnlyTheActiveTelegramAndHttpBasicAuthenticationFields() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection telegram = createConnection(
                workspace, ownerId, ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN,
                ConnectionStatus.ACTIVE, Map.of());
        Connection basic = createConnection(
                workspace, ownerId, ConnectionProvider.HTTP, ConnectionAuthType.BASIC,
                ConnectionStatus.ACTIVE, Map.of("baseUrl", "https://api.example.test"));
        saveCredential(telegram, Map.of("token", "synthetic-telegram-token"), null);
        saveCredential(basic, Map.of("username", "synthetic-user", "password", "synthetic-password"), null);

        ResolvedConnectionCredential telegramResolved = resolveConnection.execute(workspace.getId(), telegram.getId());
        ResolvedConnectionCredential basicResolved = resolveConnection.execute(workspace.getId(), basic.getId());

        assertThat(telegramResolved.auth()).containsExactly(Map.entry("token", "synthetic-telegram-token"));
        assertThat(basicResolved.auth()).containsOnlyKeys("username", "password")
                .containsEntry("username", "synthetic-user")
                .containsEntry("password", "synthetic-password");
        assertThat(telegramResolved.toString()).doesNotContain("synthetic-telegram-token");
        assertThat(basicResolved.toString()).doesNotContain("synthetic-user", "synthetic-password");
    }

    @Test
    void validGoogleAccessTokenReturnsNoRefreshTokenAndSkipsRemoteRefresh() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN, gmailScopes(),
                clock.instant().plusSeconds(60));

        ResolvedConnectionCredential resolved = resolveConnection.execute(workspace.getId(), connection.getId());

        assertThat(resolved.provider()).isEqualTo(ConnectionProvider.GMAIL);
        assertThat(resolved.authType()).isEqualTo(ConnectionAuthType.OAUTH2);
        assertThat(resolved.auth()).containsExactly(Map.entry("accessToken", OLD_ACCESS_TOKEN))
                .doesNotContainKey("refreshToken");
        assertThat(resolved.toString()).doesNotContain(OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN);
        assertThat(googleOAuth.refreshCalls.get()).isZero();
    }

    @Test
    void expiredGoogleAccessTokenRefreshesAndPreservesAnOmittedRefreshTokenEncryptedAtRest() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        byte[] originalCiphertext = original.getEncryptedPayload();
        googleOAuth.response.set(refreshResponse("synthetic-new-access-token", null, gmailScopes()));

        ResolvedConnectionCredential resolved = resolveConnection.execute(workspace.getId(), connection.getId());

        assertThat(resolved.auth()).containsExactly(Map.entry("accessToken", "synthetic-new-access-token"))
                .doesNotContainKey("refreshToken");
        assertThat(googleOAuth.refreshCalls.get()).isEqualTo(1);
        assertThat(googleOAuth.lastRefreshToken.get()).isEqualTo(OLD_REFRESH_TOKEN);
        assertThat(googleOAuth.calledInsideTransaction.get()).isFalse();
        Credential refreshed = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(refreshed.getId()).isEqualTo(original.getId());
        assertThat(refreshed.getExpiresAt()).isAfter(clock.instant());
        assertThat(refreshed.getEncryptedPayload()).isNotEqualTo(originalCiphertext);
        Map<String, Object> decrypted = decode(connection, refreshed);
        assertThat(decrypted).containsEntry("accessToken", "synthetic-new-access-token")
                .containsEntry("refreshToken", OLD_REFRESH_TOKEN)
                .containsEntry("tokenType", "Bearer");
        byte[] plaintext = credentialCrypto.decrypt(refreshed.getEncryptedPayload());
        assertThat(refreshed.getEncryptedPayload()).isNotEqualTo(plaintext);
        assertThat(new String(refreshed.getEncryptedPayload(), java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain("synthetic-new-access-token", OLD_REFRESH_TOKEN);
        assertThat(resolved.toString()).doesNotContain("synthetic-new-access-token", OLD_REFRESH_TOKEN);
    }

    @Test
    void refreshPersistsGoogleReplacementRefreshTokenAndAcceptsDocumentedEmailAlias() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GOOGLE_SHEETS, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN, sheetsScopes(),
                clock.instant().minusSeconds(1));
        googleOAuth.response.set(refreshResponse(
                "synthetic-sheets-access", "synthetic-rotated-refresh",
                List.of("openid", EMAIL_ALIAS, SHEETS_SCOPE)));

        ResolvedConnectionCredential resolved = resolveConnection.execute(workspace.getId(), connection.getId());

        Credential refreshed = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        Map<String, Object> payload = decode(connection, refreshed);
        assertThat(resolved.auth()).containsExactly(Map.entry("accessToken", "synthetic-sheets-access"));
        assertThat(payload).containsEntry("refreshToken", "synthetic-rotated-refresh")
                .containsEntry("grantedScopes", List.of("openid", EMAIL_ALIAS, SHEETS_SCOPE));
        assertThat(scopePolicy.containsRequiredScopes(connection.getProvider(),
                (List<String>) payload.get("grantedScopes"))).isTrue();
    }

    @Test
    void accessTokenAtExactExpiryBoundaryIsRefreshed() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN, gmailScopes(), clock.instant());
        googleOAuth.response.set(refreshResponse("synthetic-boundary-access", null, gmailScopes()));

        ResolvedConnectionCredential resolved = resolveConnection.execute(workspace.getId(), connection.getId());

        assertThat(resolved.auth()).containsEntry("accessToken", "synthetic-boundary-access");
        assertThat(googleOAuth.refreshCalls.get()).isEqualTo(1);
    }

    @Test
    void confirmedInvalidGrantMarksOnlyTheCurrentConnectionInvalidAndPreservesCredential() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.failure.set(new AuthenticationRejectedException());

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Google connection authorization was rejected");

        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.INVALID);
        Credential retained = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(retained.getId()).isEqualTo(original.getId());
        assertThat(retained.getEncryptedPayload()).containsExactly(original.getEncryptedPayload());
    }

    @Test
    void transientOrMalformedRefreshFailurePreservesTheActiveConnectionAndCredential() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.failure.set(new DependencyUnavailableException());

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
        assertUnchanged(connection, original);

        googleOAuth.failure.set(null);
        googleOAuth.response.set(null);
        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
        assertUnchanged(connection, original);
        assertThat(googleOAuth.refreshCalls.get()).isEqualTo(2);
    }

    @Test
    void insufficientRefreshScopesAreConfirmedAuthorizationFailure() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.response.set(refreshResponse("synthetic-under-scoped-access", null, List.of("openid", "email")));

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Google connection authorization no longer grants required access");
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.INVALID);
        assertThat(credentialRepository.findByConnectionId(connection.getId()).orElseThrow().getEncryptedPayload())
                .containsExactly(original.getEncryptedPayload());
    }

    @Test
    void refreshDoesNotPersistAfterConnectionIsDisabledWhileGoogleIsResponding() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.beforeRefresh.set(() -> {
            Connection current = connectionRepository.findById(connection.getId()).orElseThrow();
            current.markDisabled();
            connectionRepository.save(current);
        });

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection changed during credential refresh");
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        Credential retained = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(retained.getId()).isEqualTo(original.getId());
        assertThat(retained.getEncryptedPayload()).containsExactly(original.getEncryptedPayload());
    }

    @Test
    void refreshDoesNotOverwriteCredentialReplacedWhileGoogleIsResponding() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        Credential original = saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN,
                gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.beforeRefresh.set(() -> {
            transactionRunner.required(() -> {
                credentialRepository.deleteByConnectionId(connection.getId());
                saveGoogleCredential(connection, "synthetic-other-account-access",
                        "synthetic-other-account-refresh", gmailScopes(), clock.instant().plusSeconds(1800));
                return Boolean.TRUE;
            });
        });

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(InvalidStateException.class)
                .hasMessage("Connection credential changed during refresh");
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
        Credential retained = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(retained.getId()).isNotEqualTo(original.getId());
        assertThat(decode(connection, retained)).containsEntry("accessToken", "synthetic-other-account-access")
                .containsEntry("refreshToken", "synthetic-other-account-refresh");
    }

    @Test
    void refreshDoesNotRecreateConnectionDeletedWhileGoogleIsResponding() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN, gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.beforeRefresh.set(() -> {
            Connection current = connectionRepository.findById(connection.getId()).orElseThrow();
            connectionRepository.delete(current);
        });

        assertThatThrownBy(() -> resolveConnection.execute(workspace.getId(), connection.getId()))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Connection not found");
        assertThat(connectionRepository.findByWorkspaceIdAndId(workspace.getId(), connection.getId())).isEmpty();
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();
    }

    @Test
    void duplicateConcurrentRefreshRequestsAreAllowedWithoutDistributedLocking() throws Exception {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection connection = createConnection(
                workspace, ownerId, ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                ConnectionStatus.ACTIVE, Map.of());
        saveGoogleCredential(connection, OLD_ACCESS_TOKEN, OLD_REFRESH_TOKEN, gmailScopes(), clock.instant().minusSeconds(1));
        googleOAuth.response.set(refreshResponse("synthetic-concurrent-access", null, gmailScopes()));
        CyclicBarrier bothCallsReachedGoogle = new CyclicBarrier(2);
        googleOAuth.beforeRefresh.set(() -> {
            try {
                bothCallsReachedGoogle.await(5, TimeUnit.SECONDS);
            } catch (Exception exception) {
                throw new DependencyUnavailableException();
            }
        });
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> resolveConnection.execute(workspace.getId(), connection.getId()));
            var second = executor.submit(() -> resolveConnection.execute(workspace.getId(), connection.getId()));
            assertThat(first.get(10, TimeUnit.SECONDS).auth())
                    .containsEntry("accessToken", "synthetic-concurrent-access");
            assertThat(second.get(10, TimeUnit.SECONDS).auth())
                    .containsEntry("accessToken", "synthetic-concurrent-access");
        } finally {
            executor.shutdownNow();
        }

        assertThat(googleOAuth.refreshCalls.get()).isEqualTo(2);
        assertThat(googleOAuth.calledInsideTransaction.get()).isFalse();
        Credential stored = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(stored.getExpiresAt()).isAfter(clock.instant());
        assertThat(decode(connection, stored)).containsEntry("accessToken", "synthetic-concurrent-access")
                .containsEntry("refreshToken", OLD_REFRESH_TOKEN);
    }

    @Test
    void attachmentAuthorizationAllowsOwnerAndCreatorEvenWhenNotActive() {
        UUID ownerId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID otherMemberId = UUID.randomUUID();
        UUID outsiderId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        membershipRepository.save(Membership.member(workspace.getId(), creatorId));
        membershipRepository.save(Membership.member(workspace.getId(), otherMemberId));
        Connection disabled = createConnection(
                workspace, creatorId, ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN,
                ConnectionStatus.DISABLED, Map.of());

        authorizeAttachment.execute(ownerId, workspace.getId(), disabled.getId());
        authorizeAttachment.execute(creatorId, workspace.getId(), disabled.getId());

        Connection invalid = connectionRepository.findById(disabled.getId()).orElseThrow();
        invalid.markInvalid();
        connectionRepository.save(invalid);
        authorizeAttachment.execute(ownerId, workspace.getId(), disabled.getId());
        authorizeAttachment.execute(creatorId, workspace.getId(), disabled.getId());

        assertThatThrownBy(() -> authorizeAttachment.execute(otherMemberId, workspace.getId(), disabled.getId()))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> authorizeAttachment.execute(outsiderId, workspace.getId(), disabled.getId()))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> authorizeAttachment.execute(ownerId, UUID.randomUUID(), disabled.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void onlyTypedAuthenticationRejectionInvalidatesAnActiveConnection() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = createWorkspace(ownerId);
        Connection active = createConnection(
                workspace, ownerId, ConnectionProvider.TELEGRAM, ConnectionAuthType.TOKEN,
                ConnectionStatus.ACTIVE, Map.of());
        Connection disabled = createConnection(
                workspace, ownerId, ConnectionProvider.HTTP, ConnectionAuthType.NONE,
                ConnectionStatus.DISABLED, Map.of());
        Instant disabledUpdatedAt = connectionRepository.findById(disabled.getId()).orElseThrow().getUpdatedAt();

        reportAuthFailure.execute(workspace.getId(), active.getId(),
                ConnectionAuthFailureCode.AUTHENTICATION_REJECTED);
        reportAuthFailure.execute(workspace.getId(), disabled.getId(),
                ConnectionAuthFailureCode.AUTHENTICATION_REJECTED);

        assertThat(connectionRepository.findById(active.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.INVALID);
        Connection retainedDisabled = connectionRepository.findById(disabled.getId()).orElseThrow();
        assertThat(retainedDisabled.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
        assertThat(retainedDisabled.getUpdatedAt()).isEqualTo(disabledUpdatedAt);
        assertThatThrownBy(() -> reportAuthFailure.execute(
                workspace.getId(), active.getId(), null))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Connection auth failure code is invalid");
        assertThatThrownBy(() -> reportAuthFailure.execute(
                UUID.randomUUID(), active.getId(), ConnectionAuthFailureCode.AUTHENTICATION_REJECTED))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private Workspace createWorkspace(UUID ownerId) {
        Workspace workspace = workspaceRepository.save(
                Workspace.createNew("Runtime connections " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        return workspace;
    }

    private Connection createConnection(
            Workspace workspace,
            UUID createdBy,
            ConnectionProvider provider,
            ConnectionAuthType authType,
            ConnectionStatus status,
            Map<String, Object> config) {
        Connection connection = Connection.createNew(
                workspace.getId(), createdBy, "Connection " + UUID.randomUUID(), provider, authType, config);
        if (status == ConnectionStatus.ACTIVE) {
            connection.markVerified(clock.instant());
        } else if (status == ConnectionStatus.INVALID) {
            connection.markInvalid();
        }
        return connectionRepository.save(connection);
    }

    private Credential saveCredential(Connection connection, Map<String, Object> payload, Instant expiresAt) {
        byte[] plaintext = payloadCodec.encode(connection, payload);
        return saveEncryptedCredential(connection, plaintext, expiresAt);
    }

    private Credential saveGoogleCredential(
            Connection connection,
            String accessToken,
            String refreshToken,
            List<String> scopes,
            Instant expiresAt) {
        GoogleOAuthTokenResponse tokens = new GoogleOAuthTokenResponse(
                accessToken, refreshToken, "Bearer", scopes, 3600);
        return saveEncryptedCredential(connection, payloadCodec.encodeGoogleOAuth(connection, tokens), expiresAt);
    }

    private Credential saveEncryptedCredential(Connection connection, byte[] plaintext, Instant expiresAt) {
        Instant now = clock.instant();
        return credentialRepository.save(new Credential(
                UUID.randomUUID(), connection.getId(), credentialCrypto.encrypt(plaintext),
                credentialCrypto.currentKeyVersion(), expiresAt, now, now));
    }

    private Map<String, Object> decode(Connection connection, Credential credential) {
        return payloadCodec.decode(connection, credentialCrypto.decrypt(credential.getEncryptedPayload()));
    }

    private void assertUnchanged(Connection connection, Credential original) {
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
        Credential retained = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(retained.getId()).isEqualTo(original.getId());
        assertThat(retained.getEncryptedPayload()).containsExactly(original.getEncryptedPayload());
        assertThat(retained.getExpiresAt()).isEqualTo(original.getExpiresAt());
    }

    private GoogleOAuthRefreshResponse refreshResponse(String accessToken, String refreshToken, List<String> scopes) {
        return new GoogleOAuthRefreshResponse(accessToken, refreshToken, "Bearer", scopes, 3600);
    }

    private List<String> gmailScopes() {
        return List.of("openid", "email", GMAIL_SCOPE);
    }

    private List<String> sheetsScopes() {
        return List.of("openid", "email", SHEETS_SCOPE);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixtureConfiguration {
        @Bean
        @Primary
        FixtureGoogleOAuthPort task8GoogleOAuthPort() {
            return new FixtureGoogleOAuthPort();
        }

        @Bean
        @Primary
        MutableClock task8Clock() {
            return new MutableClock();
        }
    }

    static final class FixtureGoogleOAuthPort implements GoogleOAuthPort {
        private final AtomicInteger refreshCalls = new AtomicInteger();
        private final AtomicReference<GoogleOAuthRefreshResponse> response = new AtomicReference<>(
                new GoogleOAuthRefreshResponse("synthetic-refreshed-access", null, "Bearer",
                        List.of("openid", "email", GMAIL_SCOPE), 3600));
        private final AtomicReference<RuntimeException> failure = new AtomicReference<>();
        private final AtomicReference<Runnable> beforeRefresh = new AtomicReference<>(() -> { });
        private final AtomicReference<String> lastRefreshToken = new AtomicReference<>();
        private final AtomicBoolean calledInsideTransaction = new AtomicBoolean();

        @Override
        public String authorizationUrl(ConnectionProvider provider, String state) {
            throw new DependencyUnavailableException();
        }

        @Override
        public GoogleOAuthTokenResponse exchangeAuthorizationCode(String authorizationCode) {
            throw new DependencyUnavailableException();
        }

        @Override
        public GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken) {
            refreshCalls.incrementAndGet();
            lastRefreshToken.set(refreshToken);
            calledInsideTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            beforeRefresh.get().run();
            RuntimeException error = failure.get();
            if (error != null) {
                throw error;
            }
            return response.get();
        }

        @Override
        public ConnectionTestResult verify(
                ConnectionProvider provider,
                String accessToken,
                List<String> grantedScopes) {
            throw new DependencyUnavailableException();
        }

        void reset() {
            refreshCalls.set(0);
            response.set(new GoogleOAuthRefreshResponse(
                    "synthetic-refreshed-access", null, "Bearer", List.of("openid", "email", GMAIL_SCOPE), 3600));
            failure.set(null);
            beforeRefresh.set(() -> { });
            lastRefreshToken.set(null);
            calledInsideTransaction.set(false);
        }
    }

    static final class MutableClock extends Clock {
        private final AtomicReference<Instant> current = new AtomicReference<>(Instant.now());
        private final ZoneId zone;

        MutableClock() {
            this(ZoneOffset.UTC);
        }

        private MutableClock(ZoneId zone) {
            this.zone = zone;
        }

        void set(Instant instant) {
            current.set(instant);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId requestedZone) {
            return zone.equals(requestedZone) ? this : new MutableClock(requestedZone);
        }

        @Override
        public Instant instant() {
            return current.get();
        }
    }
}
