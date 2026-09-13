package com.weav.workspace.application.port.out;

public interface AfterCommitExecutor {

    void execute(Runnable action);
}
