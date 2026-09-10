package com.weav.identity.application.usecase;

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
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.exception.InvalidOAuthClientException;
import com.weav.identity.domain.valueobject.OAuthProvider;

import java.net.URI;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import java.util.UUID;

/**
 * Framework-free coordinator for the server-side Google OAuth protocol.
 *
 * <p>The two exchange methods deliberately select the intent from trusted
 * application context rather than adding an intent field to the browser
 * request. The later HTTP transport must explicitly dispatch a request with
 * no {@code Authorization} header to {@link #exchangeLogin}, or a request
 * carrying its trusted bearer identity to {@link #exchangeLink}. A logged-in
 * browser that intentionally starts LOGIN must suppress its ambient bearer
 * header for this exchange. Bearer presence is only a dispatch convention;
 * LINK still requires the matching server-bound handoff and current
 * user/session checks, and a caller cannot select LINK by changing the
 * exchange DTO.</p>
 *
 * <p>This class only coordinates opaque state, provider exchange and the
 * already-approved account use cases. It does not build HTTP redirects,
 * cookies, CSRF headers or response envelopes.</p>
 */
public final class OAuthFlowCoordinator {

    private static final int MAX_HANDLE_COLLISION_ATTEMPTS = 3;
    private static final int OPAQUE_BYTES = 32;

    private final OAuthConfiguration configuration;
    private final OAuthProviderClient providerClient;
    private final OAuthTransactionStore transactionStore;
    private final KeyedFingerprint keyedFingerprint;
    private final SecureRandom secureRandom;
    private final LinkGoogleAccountUseCase linkUseCase;
    private final CompleteGoogleLoginUseCase loginUseCase;

    public OAuthFlowCoordinator(
            OAuthConfiguration configuration,
            OAuthProviderClient providerClient,
            OAuthTransactionStore transactionStore,
            KeyedFingerprint keyedFingerprint,
            SecureRandom secureRandom,
            LinkGoogleAccountUseCase linkUseCase,
            CompleteGoogleLoginUseCase loginUseCase
    ) {
        this.configuration = Objects.requireNonNull(configuration, "configuration must not be null");
        this.providerClient = Objects.requireNonNull(providerClient, "providerClient must not be null");
        this.transactionStore = Objects.requireNonNull(transactionStore, "transactionStore must not be null");
        this.keyedFingerprint = Objects.requireNonNull(keyedFingerprint, "keyedFingerprint must not be null");
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom must not be null");
        this.linkUseCase = Objects.requireNonNull(linkUseCase, "linkUseCase must not be null");
        this.loginUseCase = Objects.requireNonNull(loginUseCase, "loginUseCase must not be null");
    }

    /** Starts an anonymous LOGIN flow using only a registered logical client. */
    public OAuthStartResult startLogin(OAuthStartCommand command) {
        return start(OAuthTransactionStore.Intent.LOGIN, null, command);
    }

    /**
     * Starts an authenticated LINK flow. The supplied IDs are trusted
     * application identity, not request body user IDs; the use case captures
     * the current-password/session binding before a transaction is published.
     */
    public OAuthStartResult startLink(
            UUID authenticatedUserId,
            UUID authenticatedSessionId,
            String currentPassword,
            OAuthStartCommand command
    ) {
        requireAuthenticatedIdentity(authenticatedUserId, authenticatedSessionId);
        Registration registration = registration(command);
        LinkGoogleAccountUseCase.LinkBinding binding = linkUseCase.initiate(
                authenticatedUserId, authenticatedSessionId, currentPassword);
        return start(OAuthTransactionStore.Intent.LINK, binding, command, registration);
    }

    /**
     * Consumes the server-bound callback state before contacting Google. A
     * valid cancellation consumes state and returns only the registered safe
     * target; an invalid state/correlation pair returns no redirect data.
     */
    public OAuthCallbackResult callback(OAuthCallbackCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        requireEnabled();

        String providerStateFingerprint = OAuthFingerprintPolicy.googleState(
                keyedFingerprint, command.providerState().value());
        OAuthTransactionStore.CallbackConsumeResult callback = transactionStore.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        command.correlationTransactionId(),
                        command.correlationTransactionId(),
                        providerStateFingerprint));
        if (callback.status() != OAuthTransactionStore.CallbackStatus.CONSUMED) {
            return OAuthCallbackResult.invalid();
        }

        OAuthTransactionStore.Transaction transaction = callback.transaction();
        final Registration registration;
        try {
            registration = registration(transaction.clientId(), transaction.returnTargetId());
        } catch (RuntimeException exception) {
            return OAuthCallbackResult.invalid();
        }

        if (command.cancelled()) {
            return OAuthCallbackResult.cancelled(transaction.transactionId(), registration.returnTargetUri());
        }

        final OAuthProviderClient.ProviderIdentity identity;
        try {
            identity = providerClient.exchangeAuthorizationCode(new OAuthProviderClient.AuthorizationCodeRequest(
                    registration.clientRegistration(),
                    command.authorizationCode(),
                    transaction.providerCodeVerifier(),
                    transaction.nonceFingerprint()));
        } catch (DependencyUnavailableException exception) {
            return OAuthCallbackResult.providerUnavailable(
                    transaction.transactionId(), registration.returnTargetUri());
        } catch (RuntimeException exception) {
            // Provider diagnostics never cross this boundary. The transaction
            // is already consumed, so replaying the provider code is unsafe.
            return OAuthCallbackResult.providerUnavailable(
                    transaction.transactionId(), registration.returnTargetUri());
        }

        if (identity == null || identity.provider() != OAuthProvider.GOOGLE) {
            return OAuthCallbackResult.providerUnavailable(
                    transaction.transactionId(), registration.returnTargetUri());
        }

        if (transaction.intent() == OAuthTransactionStore.Intent.LINK) {
            try {
                // This is deliberately after provider network I/O and before
                // the handoff is published. The use case acquires the user
                // lock only for the recheck; no lock spans the network call.
                linkUseCase.recheckCallback(transaction);
            } catch (RuntimeException exception) {
                return OAuthCallbackResult.invalid();
            }
        }

        return issueHandoff(transaction, identity, registration.returnTargetUri());
    }

    /** Completes a consumed LOGIN handoff and creates one normal session. */
    public OAuthExchangeResult exchangeLogin(OAuthExchangeCommand command) {
        return exchangeLogin(command, null, null);
    }

    /**
     * Completes a consumed LOGIN handoff with bounded session metadata. The
     * handoff is consumed before account/session mutation and is never
     * restored or replayed when the mutation fails.
     */
    public OAuthExchangeResult exchangeLogin(
            OAuthExchangeCommand command,
            String userAgent,
            String ipAddress
    ) {
        Registration registration = registration(command.clientId(), command.returnTargetId());
        OAuthTransactionStore.Handoff handoff = consumeHandoff(
                command, OAuthTransactionStore.Intent.LOGIN, registration);
        return OAuthExchangeResult.login(loginUseCase.execute(handoff, userAgent, ipAddress));
    }

    /**
     * Completes a consumed LINK handoff for the currently authenticated
     * bearer. The bearer identity is supplied by the trusted transport
     * context, not by {@link OAuthExchangeCommand}; no session is minted.
     */
    public OAuthExchangeResult exchangeLink(
            UUID authenticatedUserId,
            UUID authenticatedSessionId,
            OAuthExchangeCommand command
    ) {
        requireAuthenticatedIdentity(authenticatedUserId, authenticatedSessionId);
        Registration registration = registration(command.clientId(), command.returnTargetId());
        OAuthTransactionStore.Handoff handoff = consumeHandoff(
                command, OAuthTransactionStore.Intent.LINK, registration);
        return OAuthExchangeResult.linked(linkUseCase.complete(
                authenticatedUserId, authenticatedSessionId, handoff));
    }

    private OAuthStartResult start(
            OAuthTransactionStore.Intent intent,
            LinkGoogleAccountUseCase.LinkBinding linkBinding,
            OAuthStartCommand command
    ) {
        return start(intent, linkBinding, command, registration(command));
    }

    private OAuthStartResult start(
            OAuthTransactionStore.Intent intent,
            LinkGoogleAccountUseCase.LinkBinding linkBinding,
            OAuthStartCommand command,
            Registration registration
    ) {
        for (int attempt = 0; attempt < MAX_HANDLE_COLLISION_ATTEMPTS; attempt++) {
            String transactionId = opaque();
            String state = opaque();
            String nonce = opaque();
            String providerCodeVerifier = opaque();
            OAuthTransactionStore.Transaction transaction = new OAuthTransactionStore.Transaction(
                    transactionId,
                    intent,
                    registration.clientRegistration().clientId(),
                    registration.clientRegistration().returnTargetId(),
                    OAuthFingerprintPolicy.googleState(keyedFingerprint, state),
                    OAuthFingerprintPolicy.googleNonce(keyedFingerprint, nonce),
                    new OAuthSecret(providerCodeVerifier),
                    command.codeChallenge(),
                    linkBinding == null ? null : linkBinding.userId(),
                    linkBinding == null ? null : linkBinding.sessionId(),
                    linkBinding == null ? null : linkBinding.credentialFingerprint(),
                    configuration.stateTtl());

            // Build the provider URL before publishing the transaction. A
            // provider/configuration failure therefore cannot leave an open
            // state record behind.
            OAuthProviderClient.AuthorizationUrl authorizationUrl = providerClient.buildAuthorizationUrl(
                    new OAuthProviderClient.AuthorizationRequest(
                            registration.clientRegistration(),
                            new OAuthSecret(state),
                            new OAuthSecret(nonce),
                            new OAuthSecret(providerCodeVerifier)));
            OAuthTransactionStore.TransactionReceipt receipt = transactionStore.start(transaction);
            if (receipt.accepted()) {
                return new OAuthStartResult(
                        transactionId,
                        authorizationUrl.value(),
                        registration.returnTargetUri());
            }
        }
        // A collision before publication is retryable, but an unbounded retry
        // would turn a dependency collision into an admission-control issue.
        throw new DependencyUnavailableException();
    }

    private OAuthCallbackResult issueHandoff(
            OAuthTransactionStore.Transaction transaction,
            OAuthProviderClient.ProviderIdentity identity,
            URI returnTargetUri
    ) {
        for (int attempt = 0; attempt < MAX_HANDLE_COLLISION_ATTEMPTS; attempt++) {
            String handoffCode = opaque();
            OAuthTransactionStore.Handoff handoff = new OAuthTransactionStore.Handoff(
                    OAuthFingerprintPolicy.googleHandoff(keyedFingerprint, handoffCode),
                    transaction.transactionId(),
                    transaction.intent(),
                    transaction.clientId(),
                    transaction.returnTargetId(),
                    transaction.handoffCodeChallenge(),
                    identity,
                    transaction.userId(),
                    transaction.sessionId(),
                    transaction.credentialFingerprint(),
                    configuration.handoffTtl(),
                    configuration.maxHandoffProofFailures());
            OAuthTransactionStore.HandoffReceipt receipt = transactionStore.issueHandoff(handoff);
            if (receipt.accepted()) {
                return OAuthCallbackResult.completed(
                        transaction.transactionId(), returnTargetUri, new OAuthSecret(handoffCode));
            }
        }
        throw new DependencyUnavailableException();
    }

    private OAuthTransactionStore.Handoff consumeHandoff(
            OAuthExchangeCommand command,
            OAuthTransactionStore.Intent intent,
            Registration registration
    ) {
        String challenge = OAuthProtocolPolicy.challengeForVerifier(command.codeVerifier().value());
        String handoffFingerprint = OAuthFingerprintPolicy.googleHandoff(
                keyedFingerprint, command.handoffCode().value());
        OAuthTransactionStore.HandoffConsumeResult result = transactionStore.consumeHandoff(
                new OAuthTransactionStore.HandoffBinding(
                        handoffFingerprint,
                        command.transactionId(),
                        intent,
                        registration.clientRegistration().clientId(),
                        registration.clientRegistration().returnTargetId(),
                        challenge));
        if (result.status() != OAuthTransactionStore.HandoffStatus.CONSUMED) {
            throw new com.weav.identity.domain.exception.OAuthHandoffInvalidException();
        }
        return result.handoff();
    }

    private Registration registration(OAuthStartCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return registration(command.clientId(), command.returnTargetId());
    }

    private Registration registration(String clientId, String returnTargetId) {
        requireEnabled();
        OAuthClientRegistration clientRegistration = configuration.webClient()
                .orElseThrow(DependencyUnavailableException::new);
        if (!clientRegistration.clientId().equals(clientId)
                || !clientRegistration.returnTargetId().equals(returnTargetId)
                || clientRegistration.provider() != OAuthProvider.GOOGLE) {
            throw new InvalidOAuthClientException();
        }
        return new Registration(clientRegistration);
    }

    private void requireEnabled() {
        if (!configuration.enabled()) {
            throw new DependencyUnavailableException();
        }
    }

    private static void requireAuthenticatedIdentity(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "authenticatedUserId must not be null");
        Objects.requireNonNull(sessionId, "authenticatedSessionId must not be null");
    }

    private String opaque() {
        byte[] bytes = new byte[OPAQUE_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private record Registration(OAuthClientRegistration clientRegistration) {
        private Registration {
            Objects.requireNonNull(clientRegistration, "clientRegistration must not be null");
        }

        private URI returnTargetUri() {
            return clientRegistration.returnTargetUri();
        }
    }
}
