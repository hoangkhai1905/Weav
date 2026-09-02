package com.weav.workflow.infrastructure.persistence.entity;

public enum ExecutionStatus {
    QUEUED,
    RUNNING,
    WAITING,
    SUCCESS,
    FAILED,
    CANCELLED
}