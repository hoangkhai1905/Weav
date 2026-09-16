package com.weav.workspace.infrastructure.security;

import com.weav.workspace.domain.exception.UnauthorizedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

public final class JwtActor {

    private JwtActor() {
    }

    public static UUID userId(Jwt jwt) {
        if (jwt == null || jwt.getSubject() == null) {
            throw new UnauthorizedException();
        }
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException exception) {
            throw new UnauthorizedException();
        }
    }
}
