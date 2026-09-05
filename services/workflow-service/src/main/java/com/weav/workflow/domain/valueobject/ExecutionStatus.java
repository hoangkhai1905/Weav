package com.weav.workflow.domain.valueobject;

public enum ExecutionStatus {
    QUEUED,
    RUNNING,
    WAITING,
    SUCCESS,
    FAILED,
    CANCELLED
}