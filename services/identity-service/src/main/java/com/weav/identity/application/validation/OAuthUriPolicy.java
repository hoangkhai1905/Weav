package com.weav.identity.application.validation;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Validates redirect and origin values before they enter an OAuth
 * registration. HTTP is accepted only for loopback development targets.
 */
public final class OAuthUriPolicy {

    private OAuthUriPolicy() {
    }

    public static URI requireRedirectUri(String value, String name) {
        URI uri = parse(value, name);
        requireHttpOrHttps(uri, name);
        requireHost(uri, name);
        rejectUnsafeComponents(uri, name, false);
        if (uri.getRawPath() == null || uri.getRawPath().isBlank() || !uri.getRawPath().startsWith("/")) {
            throw new IllegalArgumentException(name + " must contain an absolute path");
        }
        if ("http".equalsIgnoreCase(uri.getScheme()) && !isLoopback(uri)) {
            throw new IllegalArgumentException(name + " may use HTTP only on loopback hosts");
        }
        return uri;
    }

    public static URI requireIssuerUri(String value, String name) {
        URI uri = parse(value, name);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException(name + " must use HTTPS");
        }
        requireHost(uri, name);
        rejectUnsafeComponents(uri, name, false);
        return uri;
    }

    public static String requireOrigin(String value, String name) {
        URI uri = parse(value, name);
        requireHttpOrHttps(uri, name);
        requireHost(uri, name);
        rejectUnsafeComponents(uri, name, true);
        if ("http".equalsIgnoreCase(uri.getScheme()) && !isLoopback(uri)) {
            throw new IllegalArgumentException(name + " may use HTTP only on loopback hosts");
        }
        return originOf(uri);
    }

    public static String originOf(URI uri) {
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.indexOf(':') >= 0 && !host.startsWith("[")) {
            host = "[" + host + "]";
        }
        String port = uri.getPort() < 0 || isDefaultPort(uri) ? "" : ":" + uri.getPort();
        return uri.getScheme().toLowerCase(Locale.ROOT) + "://" + host + port;
    }

    public static boolean isLoopback(URI uri) {
        String host = uri.getHost();
        if (host == null) {
            return false;
        }
        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("[") && normalized.endsWith("]")) {
            normalized = normalized.substring(1, normalized.length() - 1);
        }
        return normalized.equals("localhost")
                || normalized.equals("127.0.0.1")
                || normalized.equals("::1");
    }

    private static boolean isDefaultPort(URI uri) {
        return ("http".equalsIgnoreCase(uri.getScheme()) && uri.getPort() == 80)
                || ("https".equalsIgnoreCase(uri.getScheme()) && uri.getPort() == 443);
    }

    private static URI parse(String value, String name) {
        if (value == null || value.isBlank() || value.indexOf('*') >= 0) {
            throw new IllegalArgumentException(name + " must be a concrete URI without wildcards");
        }
        try {
            URI uri = new URI(value);
            if (!uri.isAbsolute()) {
                throw new IllegalArgumentException(name + " must be absolute");
            }
            return uri;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException(name + " is not a valid URI", exception);
        }
    }

    private static void requireHttpOrHttps(URI uri, String name) {
        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException(name + " must use HTTP or HTTPS");
        }
    }

    private static void requireHost(URI uri, String name) {
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException(name + " must contain a concrete host");
        }
        if (uri.getPort() == 0 || uri.getPort() < -1 || uri.getPort() > 65535) {
            throw new IllegalArgumentException(name + " contains an invalid port");
        }
    }

    private static void rejectUnsafeComponents(URI uri, String name, boolean originOnly) {
        if (uri.getRawUserInfo() != null || uri.getRawFragment() != null || uri.getRawQuery() != null) {
            throw new IllegalArgumentException(name + " must not contain userinfo, query or fragment");
        }
        if (originOnly && uri.getRawPath() != null && !uri.getRawPath().isEmpty()
                && !"/".equals(uri.getRawPath())) {
            throw new IllegalArgumentException(name + " must be an origin without a path");
        }
    }
}
