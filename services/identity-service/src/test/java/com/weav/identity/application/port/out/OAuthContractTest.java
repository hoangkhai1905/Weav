package com.weav.identity.application.port.out;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.domain.valueobject.OAuthProvider;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthContractTest {

    private static final String TOKEN = "a".repeat(43);
    private static final OAuthClientRegistration REGISTRATION = new OAuthClientRegistration(
            "web",
            "web",
            OAuthProvider.GOOGLE,
            "google-client-id",
            URI.create("https://identity.example.com/auth/oauth/google/callback"),
            URI.create("https://app.example.com/auth/callback"),
            Set.of("https://app.example.com")
    );

    @Test
    void secretBearingProviderContractsRedactValues() {
        String providerCode = "provider-code-value";
        String providerVerifier = "provider-verifier-value";
        String nonce = "nonce-value";
        OAuthProviderClient.AuthorizationCodeRequest request = new OAuthProviderClient.AuthorizationCodeRequest(
                REGISTRATION,
                new OAuthSecret(providerCode),
                new OAuthSecret(providerVerifier),
                "a".repeat(43)
        );
        OAuthProviderClient.AuthorizationUrl url = new OAuthProviderClient.AuthorizationUrl(
                URI.create("https://accounts.google.com/o/oauth2/v2/auth?state=secret-state")
        );

        assertFalse(request.toString().contains(providerCode));
        assertFalse(request.toString().contains(providerVerifier));
        assertFalse(request.toString().contains(nonce));
        assertFalse(url.toString().contains("secret-state"));
        assertTrue(new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "provider-subject", "person@example.com", true, "example.com", Instant.EPOCH
        ).toString().contains("<redacted>"));
    }

    @Test
    void transactionAndHandoffContractsSeparateProviderVerifierFromClientChallenge() {
        String challenge = "b".repeat(43);
        OAuthTransactionStore.Transaction transaction = new OAuthTransactionStore.Transaction(
                TOKEN,
                OAuthTransactionStore.Intent.LOGIN,
                "web",
                "web",
                "c".repeat(43),
                "d".repeat(43),
                new OAuthSecret("backend-provider-verifier"),
                challenge,
                null,
                null,
                null,
                Duration.ofMinutes(10)
        );
        OAuthTransactionStore.Handoff handoff = new OAuthTransactionStore.Handoff(
                "e".repeat(43),
                TOKEN,
                OAuthTransactionStore.Intent.LOGIN,
                "web",
                "web",
                challenge,
                new OAuthProviderClient.ProviderIdentity(
                        OAuthProvider.GOOGLE, "provider-subject", "person@example.com", true, "example.com", Instant.EPOCH
                ),
                null,
                null,
                null,
                Duration.ofSeconds(60),
                5
        );

        assertTrue(handoff.providerIdentity().provider() == OAuthProvider.GOOGLE);
        assertTrue(handoff.providerIdentity().providerSubject().equals("provider-subject"));
        assertFalse(handoff.toString().contains("provider-subject"));
        assertFalse(handoff.toString().contains("person@example.com"));
        assertFalse(handoff.toString().contains("example.com"));
        assertFalse(handoff.toString().contains("backend-provider-verifier"));

        OAuthTransactionStore.Handoff linkHandoff = new OAuthTransactionStore.Handoff(
                "f".repeat(43),
                TOKEN,
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                challenge,
                new OAuthProviderClient.ProviderIdentity(
                        OAuthProvider.GOOGLE, "provider-subject", "person@example.com", true, "example.com", Instant.EPOCH
                ),
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                new OAuthSecret("credential-fingerprint"),
                Duration.ofSeconds(60),
                5
        );

        assertTrue(linkHandoff.providerIdentity().equals(handoff.providerIdentity()));
        assertFalse(linkHandoff.toString().contains("provider-subject"));
        assertFalse(transaction.toString().contains(challenge));

        assertThrows(NullPointerException.class, () -> new OAuthTransactionStore.Handoff(
                "f".repeat(43), TOKEN, OAuthTransactionStore.Intent.LOGIN, "web", "web", challenge,
                null, null, null, null, Duration.ofSeconds(60), 5
        ));
    }

    @Test
    void linkBindingsAreRequiredAndFailureResultsCannotExposeState() {
        assertThrows(NullPointerException.class, () -> new OAuthTransactionStore.Transaction(
                TOKEN,
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "c".repeat(43),
                "d".repeat(43),
                new OAuthSecret("backend-provider-verifier"),
                "b".repeat(43),
                null,
                null,
                null,
                Duration.ofMinutes(10)
        ));

        OAuthTransactionStore.CallbackConsumeResult mismatch = new OAuthTransactionStore.CallbackConsumeResult(
                OAuthTransactionStore.CallbackStatus.MISMATCH,
                null
        );
        OAuthTransactionStore.HandoffConsumeResult invalid = new OAuthTransactionStore.HandoffConsumeResult(
                OAuthTransactionStore.HandoffStatus.MISMATCH,
                null
        );

        assertTrue(mismatch.transaction() == null);
        assertTrue(invalid.handoff() == null);

        assertThrows(IllegalArgumentException.class, () -> new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "s".repeat(256), "person@example.com", true, "example.com", Instant.EPOCH
        ));
    }

    @Test
    void subjectOnlyIdentityIsValidAndWhitespaceSubjectIsRejected() {
        OAuthProviderClient.ProviderIdentity subjectOnly = new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "provider-subject-only", null, true, null, Instant.EPOCH
        );

        assertTrue(subjectOnly.providerEmail() == null);
        assertThrows(IllegalArgumentException.class, () -> new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, "   ", null, false, null, Instant.EPOCH
        ));
    }

    @Test
    void enabledConfigurationPinsGoogleIssuerEvenWhenConstructedDirectly() {
        assertThrows(IllegalArgumentException.class, () -> OAuthConfiguration.enabled(
                REGISTRATION,
                URI.create("https://issuer.example.com"),
                new OAuthSecret("provider-secret"),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                Duration.ofSeconds(5),
                5,
                OAuthConfiguration.CookiePolicy.defaults(),
                Set.of()
        ));
    }
}
