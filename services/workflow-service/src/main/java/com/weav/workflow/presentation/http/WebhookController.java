package com.weav.workflow.presentation.http;

import com.weav.workflow.application.trigger.WebhookTriggerService;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import java.util.LinkedHashMap;
import java.util.Map;
import com.weav.workflow.presentation.http.response.ExecutionResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public webhook ingress; the secret header is never copied into a response or log. */
@RestController
@RequestMapping("/webhooks")
public final class WebhookController {
    private final WebhookTriggerService webhooks;

    public WebhookController(WebhookTriggerService webhooks) {
        this.webhooks = webhooks;
    }

    @PostMapping("/{endpointKey}")
    public ResponseEntity<ExecutionResponse.Accepted> accept(
            @PathVariable String endpointKey,
            @RequestHeader(value = "X-Webhook-Secret", required = false) String secret,
            @RequestBody(required = false) Object input,
            HttpServletRequest request,
            @RequestHeader(value = "traceparent", required = false) String traceparent,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var admission = webhooks.accept(endpointKey, secret, input,
                CorrelationIdFilter.requestId(request), traceparent, idempotencyKey);
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(new ExecutionResponse.Accepted(admission.executionId(), admission.workflowId(),
                        admission.workflowVersionId(), admission.status()));
    }

    /**
     * Telegram delivers updates here (registered by publishing a trigger.telegram). Telegram only needs a 2xx, so
     * an admitted update, a redelivery and a non-text update are all answered with 200.
     */
    @PostMapping("/telegram/{endpointKey}")
    public ResponseEntity<Map<String, Object>> acceptTelegram(
            @PathVariable String endpointKey,
            @RequestHeader(value = "X-Telegram-Bot-Api-Secret-Token", required = false) String secret,
            @RequestBody(required = false) Object update,
            HttpServletRequest request,
            @RequestHeader(value = "traceparent", required = false) String traceparent) {
        var admission = webhooks.acceptTelegram(endpointKey, secret, update,
                CorrelationIdFilter.requestId(request), traceparent);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        admission.ifPresent(accepted -> body.put("executionId", accepted.executionId()));
        return ResponseEntity.ok(body);
    }
}
