package com.weav.workspace.presentation.http;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.domain.query.WorkspaceSort;
import com.weav.workspace.domain.valueobject.MembershipRole;

final class WorkspaceHttpQueryParser {

    private static final int MAX_SEARCH_LENGTH = 120;

    private WorkspaceHttpQueryParser() {
    }

    static WorkspaceListQuery workspaceList(
            String search,
            String role,
            int page,
            int size,
            String sort,
            String direction) {
        validateSearch(search);
        try {
            return new WorkspaceListQuery(
                    search,
                    parseRole(role),
                    page,
                    size,
                    parseWorkspaceSort(sort),
                    parseDirection(direction));
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }
    }

    static MemberListQuery memberList(
            String search,
            String role,
            Boolean canPublishWorkflow,
            Boolean canManageWorkflowState,
            int page,
            int size,
            String sort,
            String direction) {
        validateSearch(search);
        try {
            return new MemberListQuery(
                    search,
                    parseRole(role),
                    canPublishWorkflow,
                    canManageWorkflowState,
                    page,
                    size,
                    parseMemberSort(sort),
                    parseDirection(direction));
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }
    }

    private static void validateSearch(String search) {
        if (search != null && search.trim().length() > MAX_SEARCH_LENGTH) {
            throw new BadRequestException("search must be at most " + MAX_SEARCH_LENGTH + " characters");
        }
    }

    private static MembershipRole parseRole(String value) {
        if (value == null) {
            return null;
        }
        if (value.isBlank()) {
            throw new BadRequestException("role must be OWNER or MEMBER");
        }
        try {
            return MembershipRole.valueOf(value);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("role must be OWNER or MEMBER");
        }
    }

    private static WorkspaceSort parseWorkspaceSort(String value) {
        if (value == null) {
            return WorkspaceSort.NAME;
        }
        return switch (value) {
            case "name" -> WorkspaceSort.NAME;
            case "createdAt" -> WorkspaceSort.CREATED_AT;
            case "updatedAt" -> WorkspaceSort.UPDATED_AT;
            default -> throw new BadRequestException("sort is invalid");
        };
    }

    private static MemberSort parseMemberSort(String value) {
        if (value == null) {
            return MemberSort.DISPLAY_NAME;
        }
        return switch (value) {
            case "displayName" -> MemberSort.DISPLAY_NAME;
            case "joinedAt" -> MemberSort.JOINED_AT;
            case "role" -> MemberSort.ROLE;
            default -> throw new BadRequestException("sort is invalid");
        };
    }

    private static SortDirection parseDirection(String value) {
        if (value == null) {
            return SortDirection.ASC;
        }
        return switch (value) {
            case "asc" -> SortDirection.ASC;
            case "desc" -> SortDirection.DESC;
            default -> throw new BadRequestException("direction must be asc or desc");
        };
    }
}
