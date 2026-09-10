package com.weav.identity.application.validation;

import java.util.Objects;

/**
 * Shared policy for when a validated Google email may establish local email
 * verification. Provider hosted-domain syntax is owned by the protocol policy;
 * this class only applies Google's authority rules to a canonical email.
 */
public final class GoogleEmailAuthorityPolicy {

    private GoogleEmailAuthorityPolicy() {
    }

    public static boolean isAuthoritative(String canonicalEmail, String hostedDomain) {
        Objects.requireNonNull(canonicalEmail, "canonicalEmail must not be null");
        int at = canonicalEmail.lastIndexOf('@');
        if (at < 1 || at == canonicalEmail.length() - 1) {
            return false;
        }
        String domain = canonicalEmail.substring(at + 1);
        return "gmail.com".equals(domain)
                || OAuthProtocolPolicy.isValidHostedDomain(hostedDomain);
    }
}
