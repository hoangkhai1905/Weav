package com.weav.identity.application.dto;

import java.util.List;

public record UserDirectoryPage(
        List<UserDirectorySummary> items,
        int page,
        int size,
        long totalElements,
        int totalPages) {

    public UserDirectoryPage {
        items = List.copyOf(items);
    }
}
