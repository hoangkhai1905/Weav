package com.weav.identity.application.dto;

import java.util.Objects;

/**
 * A transient OAuth value that must never appear in an automatically generated
 * string representation. The value is intentionally exposed only through an
 * explicit method at the protocol boundary that needs it.
 */
public final class OAuthSecret {

    private final String value;

    public OAuthSecret(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("OAuth secret must not be blank");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return "<redacted>";
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof OAuthSecret that)) {
            return false;
        }
        return value.equals(that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
