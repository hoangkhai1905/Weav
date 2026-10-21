package com.weav.workspace.domain.query;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Admin (UC027) listing filter. {@code searchPattern} is the normalized search text (trimmed,
 * lower-cased, or null); the persistence adapter escapes it into a LIKE pattern. {@code ids} may be empty.
 */
public record AdminWorkspaceQuery(String searchPattern, UUID ownerId, Set<UUID> ids, int page, int size) {

    public static final int MAX_SIZE = 100;

    public AdminWorkspaceQuery {
        searchPattern = searchPattern == null || searchPattern.isBlank()
                ? null
                : searchPattern.trim().toLowerCase(Locale.ROOT);
        ids = ids == null ? Set.of() : Set.copyOf(ids);
        if (page < 0) {
            throw new IllegalArgumentException("page must not be negative");
        }
        if (size < 1 || size > MAX_SIZE) {
            throw new IllegalArgumentException("size must be between 1 and " + MAX_SIZE);
        }
    }
}
