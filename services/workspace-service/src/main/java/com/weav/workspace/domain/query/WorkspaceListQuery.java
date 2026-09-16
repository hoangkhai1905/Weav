package com.weav.workspace.domain.query;

import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Locale;

public record WorkspaceListQuery(
        String search,
        MembershipRole role,
        int page,
        int size,
        WorkspaceSort sort,
        SortDirection direction) {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;

    public WorkspaceListQuery {
        search = normalizeSearch(search);
        if (page < 0) {
            throw new IllegalArgumentException("page must not be negative");
        }
        if (size < 1 || size > MAX_SIZE) {
            throw new IllegalArgumentException("size must be between 1 and " + MAX_SIZE);
        }
        sort = sort == null ? WorkspaceSort.NAME : sort;
        direction = direction == null ? SortDirection.ASC : direction;
    }

    public static WorkspaceListQuery defaults() {
        return new WorkspaceListQuery(null, null, 0, DEFAULT_SIZE, WorkspaceSort.NAME, SortDirection.ASC);
    }

    public boolean hasSearch() {
        return search != null;
    }

    private static String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return null;
        }
        return search.trim().toLowerCase(Locale.ROOT);
    }
}
