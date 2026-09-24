package com.weav.workflow.infrastructure.http;

import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Removes credential-bearing fields and values before an HTTP result is persisted. */
public final class OutputSanitizer {

    private static final String REDACTED = "[REDACTED]";
    private static final String UNAVAILABLE = "[UNAVAILABLE]";
    private static final int MAX_DEPTH = 32;
    private static final int MAX_STRING_LENGTH = 16 * 1024;
    private static final Pattern SIGNED_QUERY_VALUE = Pattern.compile(
            "(?i)([?&](?:x-amz-signature|x-amz-credential|x-amz-security-token"
                    + "|x-goog-signature|googleaccessid|awsaccesskeyid|signature|sig"
                    + "|access[_-]?token|refresh[_-]?token|auth[_-]?token|token"
                    + "|se|sp|sv|sr|st)=)([^&#]*)");

    private OutputSanitizer() {
    }

    /**
     * Returns a detached, recursively sanitized JSON-compatible value. The
     * input is never modified. Cycles, unsupported values, and excessive
     * nesting are converted to an availability marker rather than escaping
     * into a persisted execution result.
     */
    public static Object sanitize(Object value, Set<String> activeSecretValues) {
        List<String> secrets = activeSecretValues == null
                ? List.of()
                : activeSecretValues.stream()
                .filter(secret -> secret != null && !secret.isEmpty())
                .distinct()
                .sorted(Comparator.comparingInt(String::length).reversed())
                .toList();
        return sanitizeValue(value, secrets, new IdentityHashMap<>(), 0);
    }

    private static Object sanitizeValue(
            Object value,
            List<String> secrets,
            IdentityHashMap<Object, Boolean> activeContainers,
            int depth) {
        if (value == null || value instanceof Boolean || value instanceof Number) {
            return value;
        }
        if (value instanceof String text) {
            return sanitizeString(text, secrets);
        }
        if (depth >= MAX_DEPTH) {
            return UNAVAILABLE;
        }
        if (value instanceof Map<?, ?> map) {
            if (activeContainers.put(value, Boolean.TRUE) != null) {
                return UNAVAILABLE;
            }
            try {
                Map<String, Object> copy = new LinkedHashMap<>();
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (!(entry.getKey() instanceof String key) || isSensitiveKey(key)) {
                        continue;
                    }
                    copy.put(key, sanitizeValue(entry.getValue(), secrets, activeContainers, depth + 1));
                }
                return copy;
            } finally {
                activeContainers.remove(value);
            }
        }
        if (value instanceof Iterable<?> iterable) {
            if (activeContainers.put(value, Boolean.TRUE) != null) {
                return UNAVAILABLE;
            }
            try {
                List<Object> copy = new ArrayList<>();
                for (Object item : iterable) {
                    copy.add(sanitizeValue(item, secrets, activeContainers, depth + 1));
                }
                return copy;
            } finally {
                activeContainers.remove(value);
            }
        }
        return UNAVAILABLE;
    }

    private static String sanitizeString(String value, List<String> secrets) {
        String result = value;
        for (String secret : secrets) {
            result = result.replace(secret, REDACTED);
        }
        Matcher matcher = SIGNED_QUERY_VALUE.matcher(result);
        result = matcher.replaceAll(matcherResult -> matcherResult.group(1) + REDACTED);
        if (result.length() > MAX_STRING_LENGTH) {
            return result.substring(0, MAX_STRING_LENGTH);
        }
        return result;
    }

    private static boolean isSensitiveKey(String key) {
        String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (normalized.isEmpty()) {
            return false;
        }
        return normalized.contains("authorization")
                || normalized.contains("proxyauthorization")
                || normalized.contains("cookie")
                || normalized.contains("password")
                || normalized.contains("passwd")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.contains("apikey")
                || normalized.contains("accesstoken")
                || normalized.contains("refreshtoken")
                || normalized.equals("token")
                || normalized.endsWith("token")
                || normalized.contains("signature")
                || normalized.equals("sig")
                || normalized.contains("privatekey")
                || normalized.equals("jwt")
                || normalized.equals("bearer");
    }

    /** Applies the same URL query redaction to a URI without logging its raw value. */
    public static URI sanitizeUri(URI uri, Set<String> activeSecretValues) {
        if (uri == null) {
            return null;
        }
        String redacted = sanitizeString(uri.toString(), activeSecretValues == null ? List.of()
                : activeSecretValues.stream().filter(value -> value != null && !value.isEmpty())
                .sorted(Comparator.comparingInt(String::length).reversed()).toList());
        try {
            return URI.create(redacted);
        } catch (IllegalArgumentException ignored) {
            return URI.create("about:blank");
        }
    }
}
