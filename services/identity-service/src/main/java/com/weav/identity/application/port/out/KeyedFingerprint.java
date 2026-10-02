package com.weav.identity.application.port.out;

/**
 * Produces a keyed, domain-separated fingerprint for short-lived auth state.
 * Implementations must not expose the configured key or accept an unkeyed
 * fallback.
 */
public interface KeyedFingerprint {

    String fingerprint(String namespace, String value);
}
