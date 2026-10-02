package com.weav.workflow.domain.exception;

public final class WebhookRateLimitExceededException extends DomainException {
    public WebhookRateLimitExceededException() {
        super("RATE_LIMIT_EXCEEDED", "Webhook ingress rate limit exceeded");
    }
}
