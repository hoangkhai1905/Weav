package com.weav.workspace.application.port.out;

import java.util.UUID;

/**
 * Asks the Workflow Service to stop every published workflow of a workspace that is about to be deleted.
 * The call is idempotent and retriable; a transport failure surfaces as
 * {@link com.weav.workspace.domain.exception.DependencyUnavailableException}, and a workflow that could not be
 * paused is reported in {@code failed}. Either way the delete aborts and the workspace is left untouched.
 */
public interface WorkflowShutdownPort {

    PauseAllResult pauseAll(UUID workspaceId);

    record PauseAllResult(int paused, int alreadyPaused, int failedTelegramUnregister, int failed) {
    }
}
