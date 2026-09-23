package com.weav.workflow.domain.exception;

/** Public ingress error that deliberately gives no indication whether an endpoint exists or is active. */
public final class WebhookNotFoundException extends ResourceNotFoundException {
    public WebhookNotFoundException() {
        super("Webhook was not found");
    }
}
