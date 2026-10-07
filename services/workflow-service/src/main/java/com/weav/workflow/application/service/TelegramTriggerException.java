package com.weav.workflow.application.service;

/** A Telegram trigger cannot be published or resumed; {@link #code()} is a stable, documented error code. */
public final class TelegramTriggerException extends RuntimeException {
    public static final String BOT_IN_USE = "TELEGRAM_BOT_IN_USE";
    public static final String REGISTRATION_FAILED = "TELEGRAM_WEBHOOK_REGISTRATION_FAILED";

    private final String code;

    public TelegramTriggerException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
