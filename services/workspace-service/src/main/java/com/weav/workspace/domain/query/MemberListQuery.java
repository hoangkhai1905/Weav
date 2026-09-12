package com.weav.workspace.domain.query;

import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Locale;

public record MemberListQuery(
        String search,
        MembershipRole role,
        Boolean canPublishWorkflow,
        Boolean canManageWorkflowState,
        int page,
        int size,
        MemberSort sort,
        SortDirection direction) {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;

    public MemberListQuery {
        search = normalizeSearch(search);
        if (page < 0) {
            throw new IllegalArgumentException("page must not be negative");
        }
        if (size < 1 || size > MAX_SIZE) {
            throw new IllegalArgumentException("size must be between 1 and " + MAX_SIZE);
        }
        sort = sort == null ? MemberSort.DISPLAY_NAME : sort;
        direction = direction == null ? SortDirection.ASC : direction;
    }

    public static MemberListQuery defaults() {
        return new MemberListQuery(
                null,
                null,
                null,
                null,
                0,
                DEFAULT_SIZE,
                MemberSort.DISPLAY_NAME,
                SortDirection.ASC);
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
