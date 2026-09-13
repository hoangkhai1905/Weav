package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.application.port.out.AfterCommitExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Objects;

public final class SpringAfterCommitExecutor implements AfterCommitExecutor {

    private static final Logger log = LoggerFactory.getLogger(SpringAfterCommitExecutor.class);

    @Override
    public void execute(Runnable action) {
        Objects.requireNonNull(action, "action must not be null");
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            runSafely(action);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                runSafely(action);
            }
        });
    }

    private void runSafely(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException exception) {
            log.warn("Workspace after-commit cache action failed");
        }
    }
}
