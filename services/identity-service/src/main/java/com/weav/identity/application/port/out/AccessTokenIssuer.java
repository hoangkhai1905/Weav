package com.weav.identity.application.port.out;

import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.util.UUID;

public interface AccessTokenIssuer {

    IssuedAccessToken issue(UUID userId, UUID sessionId, SystemRole systemRole, UserStatus userStatus);
}
