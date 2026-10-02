package com.weav.workflow.domain.exception;

public final class AiQuotaExceededException extends DomainException {
    public AiQuotaExceededException() {
        super("AI_QUOTA_EXCEEDED", "The daily AI limit for this workspace has been reached. Try again tomorrow.");
    }
}
