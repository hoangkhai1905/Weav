package com.weav.workflow.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "weav.jwt")
public record JwtProperties(
        String accessSecret,
        String refreshSecret,
        Duration accessExpiresIn,
        Duration refreshExpiresIn
) {
}