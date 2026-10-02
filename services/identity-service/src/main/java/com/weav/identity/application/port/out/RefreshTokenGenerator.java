package com.weav.identity.application.port.out;

import com.weav.identity.application.dto.GeneratedRefreshToken;

public interface RefreshTokenGenerator {

    GeneratedRefreshToken generate();

    String hash(String token);
}
