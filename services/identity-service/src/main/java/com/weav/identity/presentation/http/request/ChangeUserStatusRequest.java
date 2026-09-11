package com.weav.identity.presentation.http.request;

import com.weav.identity.domain.valueobject.UserStatus;
import jakarta.validation.constraints.NotNull;

public record ChangeUserStatusRequest(
        @NotNull UserStatus status
) {
}
