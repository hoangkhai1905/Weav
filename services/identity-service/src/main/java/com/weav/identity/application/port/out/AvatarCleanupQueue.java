package com.weav.identity.application.port.out;

import java.util.UUID;

public interface AvatarCleanupQueue {

    void enqueue(UUID userId, String objectKey);
}
