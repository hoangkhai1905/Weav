package com.weav.workflow.application.port.out;

import java.util.UUID;

/** Outbound boundary to the Telegram Bot API webhook registration of a workspace's own bot. */
public interface TelegramWebhookPort {

    /**
     * The configured public HTTPS base URL of the gateway (no trailing slash), or null when it is unset or not
     * https; without it Telegram cannot reach a trigger, so trigger.telegram stays DEPENDENCY_NOT_CONFIGURED.
     */
    String publicBaseUrl();

    /**
     * Points the connection's bot at {@code webhookUrl} with {@code secretToken}, replacing any earlier webhook.
     *
     * @throws com.weav.workflow.application.service.TelegramTriggerException with a stable code on failure
     */
    void register(UUID workspaceId, UUID connectionId, String webhookUrl, String secretToken);

    /** Removes the bot's webhook. Best effort: failures are logged without secrets and never thrown. */
    void unregister(UUID workspaceId, UUID connectionId);
}
