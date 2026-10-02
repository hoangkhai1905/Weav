package com.weav.workspace.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "weav.internal")
public record InternalServiceKeyProperties(String serviceKey, String serviceJwksFile, boolean requireServiceJwt) {

    static final int MIN_KEY_LENGTH = 32;

    public InternalServiceKeyProperties {
        if (serviceKey != null && !serviceKey.isBlank() && serviceKey.length() < MIN_KEY_LENGTH) {
            throw new IllegalArgumentException(
                    "WEAV_INTERNAL_SERVICE_KEY must be at least " + MIN_KEY_LENGTH + " characters when set");
        }
    }

    public boolean isConfigured() {
        return serviceKey != null && !serviceKey.isBlank();
    }
}
