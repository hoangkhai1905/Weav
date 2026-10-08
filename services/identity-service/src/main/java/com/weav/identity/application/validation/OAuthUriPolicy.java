package com.weav.identity.application.validation;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;

/**
 * Validates redirect and origin values before they enter an OAuth
 * registration. HTTP is accepted only for loopback development targets.
 */
public final class OAuthUriPolicy {

    /** Custom URL schemes the mobile app registers; extend only together with the app config. */
    private static final Set<String> MOBILE_SCHEMES = Set.of("weav");

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

    /**
     * Validates the mobile app deep-link return target, for example {@code weav://auth/callback}. Only the
     * allowlisted app scheme is accepted (never http, https, javascript or data), with a host and an absolute
     * path and without userinfo, query or fragment. It is never checked against web origins; the web rules in
     * {@link #requireRedirectUri} stay unchanged.
     */
    public static URI requireMobileReturnTarget(String value, String name) {
        URI parsed = parse(value, name);
        String scheme = parsed.getScheme().toLowerCase(Locale.ROOT);
        if (!MOBILE_SCHEMES.contains(scheme)) {
            throw new IllegalArgumentException(name + " must use the scheme " + MOBILE_SCHEMES);
        }
        requireHost(parsed, name);
        rejectUnsafeComponents(parsed, name, false);
        if (parsed.getRawPath() == null || parsed.getRawPath().isBlank() || !parsed.getRawPath().startsWith("/")) {
            throw new IllegalArgumentException(name + " must contain an absolute path");
        }
        // Schemes are case-insensitive; register the redirect in canonical lowercase form (no query or
        // fragment can exist here, so the scheme-specific part is the whole remainder).
        return URI.create(scheme + ":" + parsed.getRawSchemeSpecificPart());
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
