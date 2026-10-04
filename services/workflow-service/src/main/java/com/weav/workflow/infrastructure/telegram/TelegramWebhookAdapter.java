package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.node.IntegrationReadiness;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.service.TelegramTriggerException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.UUID;

/** Registers and removes Telegram webhooks with the bot token held by a workspace connection. */
@Component
public class TelegramWebhookAdapter implements TelegramWebhookPort {

    private static final Logger log = LoggerFactory.getLogger(TelegramWebhookAdapter.class);

    private final TelegramBotApiClient telegram;
    private final WorkspaceConnectionPort workspaceConnections;
    private final String publicBaseUrl;

    public TelegramWebhookAdapter(
            TelegramBotApiClient telegram,
            WorkspaceConnectionPort workspaceConnections,
            @Value("${weav.workflow.public-base-url:}") String publicBaseUrl) {
        this.telegram = Objects.requireNonNull(telegram, "telegram must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
        this.publicBaseUrl = IntegrationReadiness.httpsBaseUrl(publicBaseUrl);
    }

    @Override
    public String publicBaseUrl() {
        return publicBaseUrl;
    }

    @Override
    public void register(UUID workspaceId, UUID connectionId, String webhookUrl, String secretToken) {
        try (ResolvedConnection connection = workspaceConnections.resolve(workspaceId, connectionId)) {
            try {
                telegram.setWebhook(connection, webhookUrl, secretToken);
            } catch (NodeExecutor.Failure failure) {
                if ("AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(workspaceId, connectionId, connection);
                }
                throw registrationFailed(failure.safeMessage());
            }
        } catch (TelegramTriggerException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            log.warn("event=telegram_webhook_register_failed connectionId={} errorType={}",
                    connectionId, exception.getClass().getSimpleName());
            throw registrationFailed("The Telegram connection could not be used.");
        }
    }

    @Override
    public void unregister(UUID workspaceId, UUID connectionId) {
        try (ResolvedConnection connection = workspaceConnections.resolve(workspaceId, connectionId)) {
            telegram.deleteWebhook(connection);
        } catch (RuntimeException exception) {
            log.warn("event=telegram_webhook_unregister_failed connectionId={} errorType={}",
                    connectionId, exception.getClass().getSimpleName());
        }
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // Telegram confirmed the rejection; the publish still fails with its own safe error.
        }
    }

    private static TelegramTriggerException registrationFailed(String reason) {
        return new TelegramTriggerException(TelegramTriggerException.REGISTRATION_FAILED,
                "The Telegram webhook could not be registered: " + reason);
    }
}
