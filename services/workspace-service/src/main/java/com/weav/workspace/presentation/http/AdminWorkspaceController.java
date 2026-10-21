package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.AdminWorkspaceResponse;
import com.weav.workspace.application.usecase.ListAdminWorkspacesUseCase;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.query.AdminWorkspaceQuery;
import com.weav.workspace.infrastructure.security.JwtAccessTokenValidator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/** UC027: cross-owner workspace listing for system admins ({@code system_role=ADMIN}). */
@RestController
@RequestMapping("/admin/workspaces")
public final class AdminWorkspaceController {

    private static final int MAX_IDS = 100;

    private final ListAdminWorkspacesUseCase listAdminWorkspaces;

    public AdminWorkspaceController(ListAdminWorkspacesUseCase listAdminWorkspaces) {
        this.listAdminWorkspaces = listAdminWorkspaces;
    }

    @GetMapping
    public PageResult<AdminWorkspaceResponse> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String q,
            @RequestParam(required = false) UUID ownerId,
            @RequestParam(required = false) String ids,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(AdminWorkspaceQuery.MAX_SIZE) int size) {
        if (jwt == null || !"ADMIN".equals(jwt.getClaimAsString(JwtAccessTokenValidator.SYSTEM_ROLE_CLAIM))) {
            throw new ForbiddenException();
        }
        return listAdminWorkspaces.execute(new AdminWorkspaceQuery(q, ownerId, parseIds(ids), page, size));
    }

    private static Set<UUID> parseIds(String ids) {
        if (ids == null || ids.isBlank()) {
            return Set.of();
        }
        String[] tokens = ids.split(",", -1);
        if (tokens.length > MAX_IDS) {
            throw new BadRequestException("ids must contain at most " + MAX_IDS + " ids");
        }
        Set<UUID> parsed = new LinkedHashSet<>();
        for (String token : tokens) {
            try {
                parsed.add(UUID.fromString(token.trim()));
            } catch (IllegalArgumentException exception) {
                throw new BadRequestException("ids must be comma-separated UUIDs");
            }
        }
        return parsed;
    }
}
