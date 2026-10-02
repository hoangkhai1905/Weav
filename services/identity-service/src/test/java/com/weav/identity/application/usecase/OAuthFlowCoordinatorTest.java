package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.dto.OAuthCallbackCommand;
import com.weav.identity.application.dto.OAuthCallbackResult;
import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthExchangeCommand;
import com.weav.identity.application.dto.OAuthExchangeResult;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.dto.OAuthStartCommand;
import com.weav.identity.application.dto.OAuthStartResult;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.validation.OAuthFingerprintPolicy;
import com.weav.identity.application.validation.OAuthProtocolPolicy;
import com.weav.identity.domain.exception.OAuthHandoffInvalidException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.authstate.HmacKeyedFingerprint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OAuthFlowCoordinatorTest {

    private static final String CLIENT_ID = "web";
    private static final String RETURN_TARGET_ID = "web";
    private static final URI PROVIDER_CALLBACK = URI.create("http://identity.test/auth/oauth/google/callback");
    private static final URI RETURN_TARGET = URI.create("http://web.test/auth/callback");
    private static final String HMAC_SECRET = "01234567890123456789012345678901";
    private static final String VERIFIER = "client-verifier-012345678901234567890123456789012";
    private static final Instant NOW = Instant.parse("2026-09-10T00:00:00Z");
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

    private final OAuthProviderClient providerClient = mock(OAuthProviderClient.class);
    private final OAuthTransactionStore transactionStore = mock(OAuthTransactionStore.class);
    private final KeyedFingerprint fingerprint = new HmacKeyedFingerprint(HMAC_SECRET);
    private final LinkGoogleAccountUseCase linkUseCase = mock(LinkGoogleAccountUseCase.class);
    private final CompleteGoogleLoginUseCase loginUseCase = mock(CompleteGoogleLoginUseCase.class);
    private final OAuthClientRegistration registration = new OAuthClientRegistration(
            CLIENT_ID,
            RETURN_TARGET_ID,
            OAuthProvider.GOOGLE,
            "google-client",
            PROVIDER_CALLBACK,
            RETURN_TARGET,
            Set.of("http://web.test"));
    private final OAuthConfiguration configuration = OAuthConfiguration.enabled(
            registration,
            OAuthConfiguration.GOOGLE_ISSUER_URI,
            new OAuthSecret("provider-secret"),
            Duration.ofMinutes(10),
            Duration.ofSeconds(60),
            Duration.ofMinutes(10),
            Duration.ofSeconds(5),
            5,
            OAuthConfiguration.CookiePolicy.defaults(),
            Set.of());
    private final OAuthFlowCoordinator coordinator = new OAuthFlowCoordinator(
            configuration,
            providerClient,
            transactionStore,
            fingerprint,
            new java.security.SecureRandom(),
            linkUseCase,
            loginUseCase);

    @BeforeEach
    void providerUrlDefaults() {
        when(providerClient.buildAuthorizationUrl(any()))
                .thenReturn(new OAuthProviderClient.AuthorizationUrl(URI.create(
                        "https://accounts.google.com/o/oauth2/v2/auth?state=server-value")));
    }

    @Test
    void loginStartPublishesOnlyAfterProviderUrlAndUsesRegisteredTarget() {
        when(transactionStore.start(any())).thenReturn(new OAuthTransactionStore.TransactionReceipt(true, 600));

        OAuthStartResult result = coordinator.startLogin(startCommand());

        assertEquals(CLIENT_ID, registration.clientId());
        assertEquals(43, result.transactionId().length());
        assertEquals(RETURN_TARGET, result.returnTargetUri());
        assertFalse(result.toString().contains("server-value"));
        var order = inOrder(providerClient, transactionStore);
        order.verify(providerClient).buildAuthorizationUrl(any());
        order.verify(transactionStore).start(any());
    }

    @Test
    void startRetriesOnlyAprePublicationCollisionWithFreshTransaction() {
        when(transactionStore.start(any()))
                .thenReturn(new OAuthTransactionStore.TransactionReceipt(false, 500),
                        new OAuthTransactionStore.TransactionReceipt(true, 600));

        OAuthStartResult result = coordinator.startLogin(startCommand());

        assertEquals(43, result.transactionId().length());
        var transactionCaptor = org.mockito.ArgumentCaptor.forClass(OAuthTransactionStore.Transaction.class);
        verify(transactionStore, org.mockito.Mockito.times(2)).start(transactionCaptor.capture());
        assertFalse(transactionCaptor.getAllValues().get(0).transactionId()
                .equals(transactionCaptor.getAllValues().get(1).transactionId()));
        verify(providerClient, org.mockito.Mockito.times(2)).buildAuthorizationUrl(any());
    }

    @Test
    void callbackMismatchDoesNotCallProviderOrIssueHandoff() {
        when(transactionStore.consumeCallback(any())).thenReturn(new OAuthTransactionStore.CallbackConsumeResult(
                OAuthTransactionStore.CallbackStatus.MISMATCH, null));

        OAuthCallbackResult result = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                token(11), new OAuthSecret(token(12)), new OAuthSecret("provider-code")));

        assertEquals(OAuthCallbackResult.Status.INVALID, result.status());
        verify(providerClient, never()).exchangeAuthorizationCode(any());
        verify(transactionStore, never()).issueHandoff(any());
    }

    @Test
    void validCancellationConsumesStateWithoutProviderCallOrHandoff() {
        OAuthTransactionStore.Transaction transaction = loginTransaction(token(20));
        when(transactionStore.consumeCallback(any())).thenReturn(new OAuthTransactionStore.CallbackConsumeResult(
                OAuthTransactionStore.CallbackStatus.CONSUMED, transaction));

        OAuthCallbackResult result = coordinator.callback(OAuthCallbackCommand.cancelled(
                transaction.transactionId(), new OAuthSecret(token(21))));

        assertEquals(OAuthCallbackResult.Status.CANCELLED, result.status());
        assertEquals(RETURN_TARGET, result.returnTargetUri());
        assertNotNull(result.transactionId());
        verify(providerClient, never()).exchangeAuthorizationCode(any());
        verify(transactionStore, never()).issueHandoff(any());
    }

    @Test
    void callbackExchangesProviderAfterStateConsumeAndPreservesLinkBinding() {
        OAuthTransactionStore.Transaction transaction = linkTransaction(token(30));
        OAuthProviderClient.ProviderIdentity identity = new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "subject", "person@gmail.com", true, null, NOW);
        when(transactionStore.consumeCallback(any())).thenReturn(new OAuthTransactionStore.CallbackConsumeResult(
                OAuthTransactionStore.CallbackStatus.CONSUMED, transaction));
        when(providerClient.exchangeAuthorizationCode(any())).thenReturn(identity);
        when(transactionStore.issueHandoff(any())).thenReturn(
                new OAuthTransactionStore.HandoffReceipt(true, 60));

        OAuthCallbackResult result = coordinator.callback(OAuthCallbackCommand.withAuthorizationCode(
                transaction.transactionId(), new OAuthSecret(token(31)), new OAuthSecret("provider-code")));

        assertEquals(OAuthCallbackResult.Status.COMPLETED, result.status());
        assertNotNull(result.handoffCode());
        var handoffCaptor = org.mockito.ArgumentCaptor.forClass(OAuthTransactionStore.Handoff.class);
        verify(transactionStore).issueHandoff(handoffCaptor.capture());
        OAuthTransactionStore.Handoff handoff = handoffCaptor.getValue();
        assertEquals(OAuthTransactionStore.Intent.LINK, handoff.intent());
        assertEquals(USER_ID, handoff.userId());
        assertEquals(SESSION_ID, handoff.sessionId());
        assertEquals(identity, handoff.providerIdentity());
        verify(linkUseCase).recheckCallback(transaction);
        var order = inOrder(providerClient, linkUseCase, transactionStore);
        order.verify(providerClient).exchangeAuthorizationCode(any());
        order.verify(linkUseCase).recheckCallback(transaction);
        order.verify(transactionStore).issueHandoff(any());
    }

    @Test
    void exchangeUsesVerifierChallengeAndLoginUseCaseOnlyForLoginIntent() {
        OAuthTransactionStore.Transaction transaction = loginTransaction(token(40));
        OAuthProviderClient.ProviderIdentity identity = new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "subject", "person@gmail.com", true, null, NOW);
        OAuthTransactionStore.Handoff handoff = handoff(transaction, identity);
        when(transactionStore.consumeHandoff(any())).thenReturn(new OAuthTransactionStore.HandoffConsumeResult(
                OAuthTransactionStore.HandoffStatus.CONSUMED, handoff));
        when(loginUseCase.execute(handoff, "agent", "ip"))
                .thenReturn(new com.weav.identity.application.dto.TokenPairResult(
                        "access", "refresh", "Bearer", 900, NOW.plusSeconds(900),
                        new AuthenticatedUserResult(
                                USER_ID,
                                "person@gmail.com",
                                null,
                                null,
                                com.weav.identity.domain.valueobject.SystemRole.USER,
                                com.weav.identity.domain.valueobject.UserStatus.ACTIVE,
                                NOW,
                                NOW)));

        OAuthExchangeResult result = coordinator.exchangeLogin(exchangeCommand(transaction, handoff), "agent", "ip");

        assertEquals(OAuthExchangeResult.Outcome.LOGIN, result.outcome());
        verify(loginUseCase).execute(handoff, "agent", "ip");
        var bindingCaptor = org.mockito.ArgumentCaptor.forClass(OAuthTransactionStore.HandoffBinding.class);
        verify(transactionStore).consumeHandoff(bindingCaptor.capture());
        assertEquals(OAuthProtocolPolicy.challengeForVerifier(VERIFIER), bindingCaptor.getValue().codeChallenge());
    }

    @Test
    void wrongExchangeProofIsFixedFailureAndDoesNotInvokeAccountMutation() {
        OAuthTransactionStore.Transaction transaction = loginTransaction(token(50));
        when(transactionStore.consumeHandoff(any())).thenReturn(new OAuthTransactionStore.HandoffConsumeResult(
                OAuthTransactionStore.HandoffStatus.MISMATCH, null));

        assertThrows(OAuthHandoffInvalidException.class,
                () -> coordinator.exchangeLogin(exchangeCommand(transaction, handoff(
                        transaction,
                        new OAuthProviderClient.ProviderIdentity(
                                OAuthProvider.GOOGLE, "subject", null, false, null, NOW)))));
        verify(loginUseCase, never()).execute(any(), any(), any());
    }

    @Test
    void linkExchangeReturnsMetadataWithoutCallingLoginSessionIssuer() {
        OAuthTransactionStore.Transaction transaction = linkTransaction(token(60));
        OAuthTransactionStore.Handoff handoff = handoff(transaction,
                new OAuthProviderClient.ProviderIdentity(
                        OAuthProvider.GOOGLE, "subject", "person@gmail.com", true, null, NOW));
        OAuthAccountMetadata metadata = new OAuthAccountMetadata(
                UUID.randomUUID(), OAuthProvider.GOOGLE, "person@gmail.com", NOW, NOW);
        when(transactionStore.consumeHandoff(any())).thenReturn(new OAuthTransactionStore.HandoffConsumeResult(
                OAuthTransactionStore.HandoffStatus.CONSUMED, handoff));
        when(linkUseCase.complete(USER_ID, SESSION_ID, handoff)).thenReturn(metadata);

        OAuthExchangeResult result = coordinator.exchangeLink(USER_ID, SESSION_ID,
                exchangeCommand(transaction, handoff));

        assertEquals(OAuthExchangeResult.Outcome.LINKED, result.outcome());
        assertEquals(metadata, result.linked());
        verify(linkUseCase).complete(USER_ID, SESSION_ID, handoff);
        verify(loginUseCase, never()).execute(any(), any(), any());
    }

    @Test
    void allCoordinatorResultStringsRedactProtocolSecrets() {
        OAuthStartResult start = new OAuthStartResult(token(70),
                URI.create("https://provider.test/auth?state=raw-state&nonce=raw-nonce"), RETURN_TARGET);
        OAuthCallbackResult callback = OAuthCallbackResult.completed(
                token(71), RETURN_TARGET, new OAuthSecret("raw-handoff"));
        OAuthExchangeResult exchange = OAuthExchangeResult.login(
                new com.weav.identity.application.dto.TokenPairResult(
                        "raw-access", "raw-refresh", "Bearer", 60, NOW, null));

        assertFalse(start.toString().contains("raw-state"));
        assertFalse(callback.toString().contains("raw-handoff"));
        assertFalse(exchange.toString().contains("raw-access"));
        assertFalse(exchange.toString().contains("raw-refresh"));
    }

    private OAuthStartCommand startCommand() {
        return new OAuthStartCommand(CLIENT_ID, RETURN_TARGET_ID,
                OAuthProtocolPolicy.challengeForVerifier(VERIFIER), OAuthProtocolPolicy.S256);
    }

    private OAuthExchangeCommand exchangeCommand(
            OAuthTransactionStore.Transaction transaction,
            OAuthTransactionStore.Handoff handoff
    ) {
        return new OAuthExchangeCommand(
                transaction.clientId(),
                transaction.returnTargetId(),
                transaction.transactionId(),
                new OAuthSecret(handoffCodeFor(handoff)),
                new OAuthSecret(VERIFIER));
    }

    private OAuthTransactionStore.Transaction loginTransaction(String transactionId) {
        return new OAuthTransactionStore.Transaction(
                transactionId,
                OAuthTransactionStore.Intent.LOGIN,
                CLIENT_ID,
                RETURN_TARGET_ID,
                fingerprint.fingerprint(OAuthFingerprintPolicy.GOOGLE_STATE_NAMESPACE, token(99)),
                fingerprint.fingerprint(OAuthFingerprintPolicy.GOOGLE_NONCE_NAMESPACE, token(98)),
                new OAuthSecret("provider-verifier"),
                OAuthProtocolPolicy.challengeForVerifier(VERIFIER),
                null,
                null,
                null,
                Duration.ofMinutes(10));
    }

    private OAuthTransactionStore.Transaction linkTransaction(String transactionId) {
        return new OAuthTransactionStore.Transaction(
                transactionId,
                OAuthTransactionStore.Intent.LINK,
                CLIENT_ID,
                RETURN_TARGET_ID,
                fingerprint.fingerprint(OAuthFingerprintPolicy.GOOGLE_STATE_NAMESPACE, token(97)),
                fingerprint.fingerprint(OAuthFingerprintPolicy.GOOGLE_NONCE_NAMESPACE, token(96)),
                new OAuthSecret("provider-verifier"),
                OAuthProtocolPolicy.challengeForVerifier(VERIFIER),
                USER_ID,
                SESSION_ID,
                new OAuthSecret("credential-fingerprint"),
                Duration.ofMinutes(10));
    }

    private OAuthTransactionStore.Handoff handoff(
            OAuthTransactionStore.Transaction transaction,
            OAuthProviderClient.ProviderIdentity identity
    ) {
        String code = handoffCodeFor(transaction);
        return new OAuthTransactionStore.Handoff(
                OAuthFingerprintPolicy.googleHandoff(fingerprint, code),
                transaction.transactionId(),
                transaction.intent(),
                transaction.clientId(),
                transaction.returnTargetId(),
                transaction.handoffCodeChallenge(),
                identity,
                transaction.userId(),
                transaction.sessionId(),
                transaction.credentialFingerprint(),
                Duration.ofSeconds(60),
                5);
    }

    private static String handoffCodeFor(OAuthTransactionStore.Handoff handoff) {
        return "C".repeat(43);
    }

    private static String handoffCodeFor(OAuthTransactionStore.Transaction transaction) {
        return "C".repeat(43);
    }

    private static String token(long seed) {
        byte[] bytes = new byte[32];
        ByteBuffer.wrap(bytes).putLong(seed).putLong(~seed);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
