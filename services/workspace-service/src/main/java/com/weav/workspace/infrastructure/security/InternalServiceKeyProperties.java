package com.weav.workspace.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "weav.internal")
public record InternalServiceKeyProperties(String serviceKey) {

    public boolean isConfigured() {
        return serviceKey != null && !serviceKey.isBlank();
    }
}
