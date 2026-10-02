package com.weav.identity.application.dto;

import java.time.Instant;
import java.util.Objects;

public record IssuedAccessToken(String value, Instant expiresAt) {

    public IssuedAccessToken {
        Objects.requireNonNull(value, "value must not be null");
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
    }
}
