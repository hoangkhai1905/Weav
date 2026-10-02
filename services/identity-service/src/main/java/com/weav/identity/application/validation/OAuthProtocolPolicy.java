package com.weav.identity.application.validation;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * Framework-free bounds for OAuth opaque handles and RFC 7636 S256 values.
 * Browser handoff verifiers are validated here but are never part of the
 * backend transaction records; only their derived challenge is retained.
 */
public final class OAuthProtocolPolicy {

    public static final String S256 = "S256";
    public static final int OPAQUE_TOKEN_LENGTH = 43;
    public static final int MIN_VERIFIER_LENGTH = 43;
    public static final int MAX_VERIFIER_LENGTH = 128;

    private static final Pattern OPAQUE_TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final Pattern HOSTED_DOMAIN = Pattern.compile(
            "(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+"
                    + "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    );

    private OAuthProtocolPolicy() {
    }

    public static String requireOpaqueToken(String value, String name) {
        if (value == null || !OPAQUE_TOKEN.matcher(value).matches()) {
            throw new IllegalArgumentException(name + " must be exactly 43 unpadded base64url characters");
        }
        return value;
    }

    public static String requireLogicalId(String value, String name) {
        if (value == null || value.isBlank() || value.length() > 32
                || value.chars().anyMatch(character -> character < 0x20 || character > 0x7e
                || Character.isWhitespace(character))) {
            throw new IllegalArgumentException(name + " must be printable non-whitespace ASCII of length 1..32");
        }
        return value;
    }

    /**
     * Returns whether a signed provider hosted-domain claim is a DNS-style
     * organization domain. The check is deliberately syntax-only: it does not
     * compare the domain with the email address or apply product allowlists.
     */
    public static boolean isValidHostedDomain(String value) {
        return value != null
                && value.length() <= 253
                && HOSTED_DOMAIN.matcher(value).matches();
    }

    public static String requireS256Challenge(String challenge) {
        return requireOpaqueToken(challenge, "codeChallenge");
    }

    public static String requireS256Method(String method) {
        if (!S256.equals(method)) {
            throw new IllegalArgumentException("codeChallengeMethod must be S256");
        }
        return method;
    }

    public static String requireVerifier(String verifier) {
        if (verifier == null || verifier.length() < MIN_VERIFIER_LENGTH
                || verifier.length() > MAX_VERIFIER_LENGTH) {
            throw new IllegalArgumentException("codeVerifier must contain 43..128 RFC 7636 characters");
        }
        for (int index = 0; index < verifier.length(); index++) {
            char value = verifier.charAt(index);
            if (!isUnreservedAscii(value)) {
                throw new IllegalArgumentException("codeVerifier contains an invalid RFC 7636 character");
            }
        }
        return verifier;
    }

    public static String challengeForVerifier(String verifier) {
        byte[] digest;
        try {
            digest = MessageDigest.getInstance("SHA-256")
                    .digest(requireVerifier(verifier).getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }

    private static boolean isUnreservedAscii(char value) {
        return value >= 'A' && value <= 'Z'
                || value >= 'a' && value <= 'z'
                || value >= '0' && value <= '9'
                || value == '-' || value == '.' || value == '_' || value == '~';
    }
}
