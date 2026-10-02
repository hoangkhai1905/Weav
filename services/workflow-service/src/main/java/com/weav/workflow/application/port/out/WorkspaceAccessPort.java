package com.weav.workflow.application.port.out;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Authoritative Workspace membership and capability lookup. */
public interface WorkspaceAccessPort {

    Access getAccess(UUID workspaceId, UUID userId);

    record Access(UUID workspaceId, UUID userId, String role, Set<String> capabilities) {

        public Access {
            Objects.requireNonNull(workspaceId, "workspaceId must not be null");
            Objects.requireNonNull(userId, "userId must not be null");
            if (role == null || role.isBlank()) {
                throw new IllegalArgumentException("role must not be blank");
            }
            Objects.requireNonNull(capabilities, "capabilities must not be null");
            LinkedHashSet<String> copy = new LinkedHashSet<>();
            for (String capability : capabilities) {
                if (capability == null || capability.isBlank()) {
                    throw new IllegalArgumentException("capabilities must not contain blank values");
                }
                copy.add(capability);
            }
            capabilities = Collections.unmodifiableSet(copy);
        }
    }
}
