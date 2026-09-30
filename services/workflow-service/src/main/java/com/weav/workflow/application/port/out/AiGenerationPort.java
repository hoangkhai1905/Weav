package com.weav.workflow.application.port.out;

import java.util.Map;
import java.util.UUID;

/** Calls AI generation once. Throws NodeExecutor.Failure with the codes described in spec §4. */
public interface AiGenerationPort {
    Map<String, Object> generate(UUID workspaceId, Map<String, Object> payload);
}
