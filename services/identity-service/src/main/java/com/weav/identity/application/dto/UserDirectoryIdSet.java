package com.weav.identity.application.dto;

import java.util.Set;
import java.util.UUID;

public record UserDirectoryIdSet(Set<UUID> matchingUserIds) {

    public UserDirectoryIdSet {
        matchingUserIds = Set.copyOf(matchingUserIds);
    }
}
