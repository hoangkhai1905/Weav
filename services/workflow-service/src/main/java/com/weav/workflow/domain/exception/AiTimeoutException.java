package com.weav.workflow.domain.exception;

public final class AiTimeoutException extends DomainException {
    public AiTimeoutException() {
        super("AI_TIMEOUT", "AI generation timed out. Try a shorter request.");
    }
}
