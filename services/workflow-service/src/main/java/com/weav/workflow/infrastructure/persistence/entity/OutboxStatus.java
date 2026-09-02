package com.weav.workflow.infrastructure.persistence.entity;

public enum OutboxStatus {
    PENDING,
    PUBLISHED,
    FAILED
}