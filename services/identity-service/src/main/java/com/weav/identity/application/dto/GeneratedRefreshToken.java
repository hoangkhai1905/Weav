package com.weav.identity.application.dto;

import java.util.Objects;

public record GeneratedRefreshToken(String value, String hash) {

    public GeneratedRefreshToken {
        Objects.requireNonNull(value, "value must not be null");
        Objects.requireNonNull(hash, "hash must not be null");
    }
}
