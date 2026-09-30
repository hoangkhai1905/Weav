package com.weav.workflow.domain.exception;

public final class AiUnavailableException extends DomainException {
    public AiUnavailableException() {
        super("AI_UNAVAILABLE", "AI generation is temporarily unavailable.");
    }
}
