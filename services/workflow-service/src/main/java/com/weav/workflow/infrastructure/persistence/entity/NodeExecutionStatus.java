package com.weav.workflow.infrastructure.persistence.entity;

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