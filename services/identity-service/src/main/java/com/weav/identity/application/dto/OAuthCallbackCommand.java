package com.weav.identity.application.dto;

import com.weav.identity.application.validation.OAuthProtocolPolicy;

import java.util.Objects;

/**
 * Trusted application input for the provider callback boundary.
 *
 * <p>The callback selects a transaction only with the server-issued
 * correlation handle. The provider state is supplied separately and is
 * compared by the transaction store before any provider call is made.</p>
 */
public record OAuthCallbackCommand(
        String correlationTransactionId,
        OAuthSecret providerState,
        OAuthSecret authorizationCode,
        boolean cancelled
) {

    public OAuthCallbackCommand {
        OAuthProtocolPolicy.requireOpaqueToken(correlationTransactionId, "correlationTransactionId");
        Objects.requireNonNull(providerState, "providerState must not be null");
        OAuthProtocolPolicy.requireOpaqueToken(providerState.value(), "providerState");
        if (cancelled) {
            if (authorizationCode != null) {
                throw new IllegalArgumentException("cancelled callback must not contain an authorization code");
            }
        } else {
            Objects.requireNonNull(authorizationCode, "authorizationCode must not be null");
            requireProviderCode(authorizationCode.value());
        }
    }

    public static OAuthCallbackCommand cancelled(String correlationTransactionId, OAuthSecret providerState) {
        return new OAuthCallbackCommand(correlationTransactionId, providerState, null, true);
    }

    public static OAuthCallbackCommand withAuthorizationCode(
            String correlationTransactionId,
            OAuthSecret providerState,
            OAuthSecret authorizationCode
    ) {
        return new OAuthCallbackCommand(correlationTransactionId, providerState, authorizationCode, false);
    }

    @Override
    public String toString() {
        return "OAuthCallbackCommand[correlationTransactionId=<redacted>, providerState=<redacted>, "
                + "authorizationCode=<redacted>, cancelled=" + cancelled + "]";
    }

    private static void requireProviderCode(String value) {
        if (value == null || value.length() < 1 || value.length() > 2048
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e)) {
            throw new IllegalArgumentException("authorizationCode must be printable ASCII of length 1..2048");
        }
    }
}
