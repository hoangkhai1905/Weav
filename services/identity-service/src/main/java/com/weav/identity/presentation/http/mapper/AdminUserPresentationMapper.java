package com.weav.identity.presentation.http.mapper;

import com.weav.identity.application.dto.AdminUserPageResult;
import com.weav.identity.application.dto.AdminUserResult;
import com.weav.identity.presentation.http.response.AdminUserPageResponse;
import com.weav.identity.presentation.http.response.AdminUserResponse;
import org.springframework.stereotype.Component;

@Component
public class AdminUserPresentationMapper {

    public AdminUserResponse toResponse(AdminUserResult user) {
        return new AdminUserResponse(
                user.id(),
                user.email(),
                user.displayName(),
                user.systemRole(),
                user.status(),
                user.createdAt(),
                user.updatedAt(),
                user.emailVerifiedAt(),
                user.avatarPresent());
    }

    public AdminUserPageResponse toResponse(AdminUserPageResult page) {
        return new AdminUserPageResponse(
                page.items().stream().map(this::toResponse).toList(),
                page.page(),
                page.size(),
                page.totalItems(),
                page.totalPages());
    }
}
