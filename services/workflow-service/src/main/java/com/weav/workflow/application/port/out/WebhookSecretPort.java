package com.weav.workflow.application.port.out;

/** Boundary for issuing one-time webhook credentials and checking stored verifiers. */
public interface WebhookSecretPort {
    String UNKNOWN_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

    IssuedKey provision();

    boolean matches(String supplied, String storedHash);

    record IssuedKey(String endpointKey, String secret, String secretHash) {
        @Override
        public String toString() {
            return "IssuedKey[endpointKey=<redacted>, secret=<redacted>, secretHash=<redacted>]";
        }
    }
}
