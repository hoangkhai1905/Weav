package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Small safety boundary for the connection metadata map.
 *
 * <p>Provider-specific shape validation belongs to provider strategies in a
 * later task. This policy rejects known credential fields, transport auth
 * headers, and URL user-info before config crosses the persistence boundary.
 * It cannot detect arbitrary secrets hidden in otherwise valid metadata.</p>
 */
public final class ConnectionConfigPolicy {

    private static final Set<String> SECRET_KEYS = Set.of(
            "token",
            "apikey",
            "password",
            "accesstoken",
            "refreshtoken",
            "clientsecret",
            "encryptedpayload",
            "encryptionkeyversion",
            "credentialid");

    private static final Set<String> SENSITIVE_HEADER_NAMES = Set.of(
            "authorization",
            "proxyauthorization",
            "cookie",
            "setcookie",
            "apikey",
            "xapikey");

    private static final Set<String> HEADER_CONTAINER_KEYS = Set.of(
            "header",
            "headers",
            "requestheader",
            "requestheaders",
            "defaultheader",
            "defaultheaders");

    private static final Set<String> HEADER_NAME_KEYS = Set.of(
            "header",
            "headername",
            "key",
            "name");

    private static final String REJECTED_CONFIG_MESSAGE =
            "Connection config must not contain credential material";

    public void validate(Map<String, Object> config) {
        if (config == null) {
            return;
        }
        validateValue(config, false);
    }

    private void validateValue(Object value, boolean headerContext) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = entry.getKey() instanceof String stringKey ? stringKey : null;
                if (key != null && isSecretKey(key)) {
                    reject();
                }
                if (key != null && isSensitiveHeaderName(key)) {
                    reject();
                }
                if (headerContext && key != null && isHeaderNameKey(key)
                        && entry.getValue() instanceof String headerName
                        && isSensitiveHeaderName(headerName)) {
                    reject();
                }

                if (key != null && isHeaderContainerKey(key)) {
                    validateHeaderValue(entry.getValue());
                } else {
                    validateValue(entry.getValue(), headerContext);
                }
            }
            return;
        }
        if (value instanceof List<?> list) {
            list.forEach(item -> validateValue(item, headerContext));
            return;
        }
        if (value instanceof String stringValue) {
            rejectUrlUserInfo(stringValue);
        }
    }

    private void validateHeaderValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = entry.getKey() instanceof String stringKey ? stringKey : null;
                if (key != null && isSensitiveHeaderName(key)) {
                    reject();
                }
                if (key != null && isHeaderNameKey(key)
                        && entry.getValue() instanceof String headerName
                        && isSensitiveHeaderName(headerName)) {
                    reject();
                }
                validateHeaderValue(entry.getValue());
            }
            return;
        }
        if (value instanceof List<?> list) {
            list.forEach(this::validateHeaderValue);
            return;
        }
        if (value instanceof String stringValue) {
            if (looksLikeSensitiveHeaderLine(stringValue)) {
                reject();
            }
            rejectUrlUserInfo(stringValue);
        }
    }

    private boolean isSecretKey(String key) {
        String normalized = key.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
        return SECRET_KEYS.contains(normalized)
                || normalized.contains("secret")
                || normalized.contains("credential");
    }

    private boolean isHeaderContainerKey(String key) {
        return HEADER_CONTAINER_KEYS.contains(normalize(key));
    }

    private boolean isHeaderNameKey(String key) {
        return HEADER_NAME_KEYS.contains(normalize(key));
    }

    private boolean isSensitiveHeaderName(String key) {
        return SENSITIVE_HEADER_NAMES.contains(normalize(key));
    }

    private String normalize(String value) {
        return value.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
    }

    private boolean looksLikeSensitiveHeaderLine(String value) {
        int separator = value.indexOf(':');
        return separator > 0 && isSensitiveHeaderName(value.substring(0, separator).trim());
    }

    private void rejectUrlUserInfo(String value) {
        try {
            URI uri = URI.create(value.trim());
            if (uri.getRawUserInfo() != null) {
                reject();
            }
        } catch (IllegalArgumentException ignored) {
            // Provider-specific URL validation belongs to the provider task.
        }
    }

    private void reject() {
        throw new BadRequestException(REJECTED_CONFIG_MESSAGE);
    }
}
