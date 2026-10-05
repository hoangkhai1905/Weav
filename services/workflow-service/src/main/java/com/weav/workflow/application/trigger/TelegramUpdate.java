package com.weav.workflow.application.trigger;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Reduces a Telegram Bot API update to the stable trigger input
 * {@code {updateId, message: {messageId, date, text, chat: {id, type}, from: {id, username, firstName}}}}.
 * Only fields that are present are copied; everything else Telegram sends is dropped.
 */
public record TelegramUpdate(long updateId, Map<String, Object> input) {

    /** The idempotency key for one update; Telegram numbers updates, so a redelivery repeats it. */
    public String idempotencyKey() {
        return "telegram:" + updateId;
    }

    /** Empty when the update carries no non-blank text message (nothing to run). */
    public static Optional<TelegramUpdate> from(Object body) {
        if (!(body instanceof Map<?, ?> update) || !(update.get("update_id") instanceof Number number)
                || !isWhole(number) || number.longValue() < 0) {
            return Optional.empty();
        }
        if (!(update.get("message") instanceof Map<?, ?> message)
                || !(message.get("text") instanceof String text) || text.isBlank()) {
            return Optional.empty();
        }
        long updateId = number.longValue();
        Map<String, Object> normalized = new LinkedHashMap<>();
        copyWhole(message, "message_id", normalized, "messageId");
        copyWhole(message, "date", normalized, "date");
        normalized.put("text", text);
        if (message.get("chat") instanceof Map<?, ?> chat) {
            Map<String, Object> target = new LinkedHashMap<>();
            copyWhole(chat, "id", target, "id");
            copyText(chat, "type", target, "type");
            normalized.put("chat", target);
        }
        if (message.get("from") instanceof Map<?, ?> from) {
            Map<String, Object> target = new LinkedHashMap<>();
            copyWhole(from, "id", target, "id");
            copyText(from, "username", target, "username");
            copyText(from, "first_name", target, "firstName");
            normalized.put("from", target);
        }
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("updateId", updateId);
        input.put("message", normalized);
        return Optional.of(new TelegramUpdate(updateId, input));
    }

    private static void copyWhole(Map<?, ?> source, String key, Map<String, Object> target, String name) {
        if (source.get(key) instanceof Number number && isWhole(number)) {
            target.put(name, number.longValue());
        }
    }

    private static void copyText(Map<?, ?> source, String key, Map<String, Object> target, String name) {
        if (source.get(key) instanceof String text) {
            target.put(name, text);
        }
    }

    private static boolean isWhole(Number number) {
        try {
            new BigDecimal(number.toString()).longValueExact();
            return true;
        } catch (ArithmeticException | NumberFormatException exception) {
            return false;
        }
    }
}
