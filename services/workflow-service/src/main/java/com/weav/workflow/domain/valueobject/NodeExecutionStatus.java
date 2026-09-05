package com.weav.workflow.domain.valueobject;

public enum NodeExecutionStatus {
    PENDING,
    READY,
    RUNNING,
    WAITING,
    SUCCESS,
    FAILED,
    SKIPPED,
    CANCELLED
}