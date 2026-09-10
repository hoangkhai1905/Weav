package com.weav.identity.application.dto;

import java.util.Objects;

/**
 * Discriminated result for the two server-selected exchange paths. LOGIN
 * contains the normal session token pair; LINK contains metadata only and
 * never mints a session.
 */
public record OAuthExchangeResult(
        Outcome outcome,
        TokenPairResult login,
        OAuthAccountMetadata linked
) {

    public enum Outcome {
        LOGIN,
        LINKED
    }

    public OAuthExchangeResult {
        Objects.requireNonNull(outcome, "outcome must not be null");
        if ((outcome == Outcome.LOGIN) != (login != null)
                || (outcome == Outcome.LINKED) != (linked != null)) {
            throw new IllegalArgumentException("exchange result payload does not match outcome");
        }
    }

    public static OAuthExchangeResult login(TokenPairResult result) {
        return new OAuthExchangeResult(Outcome.LOGIN, Objects.requireNonNull(result), null);
    }

    public static OAuthExchangeResult linked(OAuthAccountMetadata result) {
        return new OAuthExchangeResult(Outcome.LINKED, null, Objects.requireNonNull(result));
    }

    @Override
    public String toString() {
        return "OAuthExchangeResult[outcome=" + outcome
                + ", login=<redacted>, linked=<redacted>]";
    }
}
