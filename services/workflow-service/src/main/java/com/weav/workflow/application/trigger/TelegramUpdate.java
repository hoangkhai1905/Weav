package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.WorkflowFileStore;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Reduces a Telegram Bot API update to the stable trigger input
 * {@code {updateId, message: {messageId, date, text, caption, chat: {id, type}, from: {id, username, firstName}}}}.
 * Only fields that are present are copied; everything else Telegram sends is dropped. A message with a
 * {@code photo} or {@code document} also yields {@link #files()}, the downloadable candidates (largest first); the
 * caller downloads one and adds it to the input as {@code file}.
 */
public record TelegramUpdate(long updateId, Map<String, Object> input, List<FileCandidate> files) {

    /**
     * One file Telegram offers for a message: its Bot API {@code file_id}, the name and type Weav will store it
     * under, and the size Telegram declared (null when unknown).
     */
    public record FileCandidate(String telegramFileId, String filename, String mimeType, Long size) {
    }

    public TelegramUpdate {
        files = List.copyOf(files);
    }

    public TelegramUpdate(long updateId, Map<String, Object> input) {
        this(updateId, input, List.of());
    }

    /** The idempotency key for one update; Telegram numbers updates, so a redelivery repeats it. */
    public String idempotencyKey() {
        return "telegram:" + updateId;
    }

    /** Empty when the update carries no text, caption or file (nothing to run). */
    public static Optional<TelegramUpdate> from(Object body) {
        if (!(body instanceof Map<?, ?> update) || !(update.get("update_id") instanceof Number number)
                || !isWhole(number) || number.longValue() < 0) {
            return Optional.empty();
        }
        if (!(update.get("message") instanceof Map<?, ?> message)) {
            return Optional.empty();
        }
        String text = message.get("text") instanceof String value && !value.isBlank() ? value : null;
        String caption = message.get("caption") instanceof String value && !value.isBlank() ? value : null;
        List<FileCandidate> files = files(message);
        if (text == null && caption == null && files.isEmpty()) {
            return Optional.empty();
        }
        long updateId = number.longValue();
        Map<String, Object> normalized = new LinkedHashMap<>();
        copyWhole(message, "message_id", normalized, "messageId");
        copyWhole(message, "date", normalized, "date");
        if (text != null) {
            normalized.put("text", text);
        }
        if (caption != null) {
            normalized.put("caption", caption);
        }
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
        return Optional.of(new TelegramUpdate(updateId, input, files));
    }

    /** The document, or the photo sizes from largest to smallest; entries without a usable file_id are dropped. */
    private static List<FileCandidate> files(Map<?, ?> message) {
        List<FileCandidate> files = new ArrayList<>();
        if (message.get("document") instanceof Map<?, ?> document && document.get("file_id") instanceof String id
                && validFileId(id)) {
            String name = document.get("file_name") instanceof String value ? WorkflowFileStore.safeFilename(value) : null;
            String mime = document.get("mime_type") instanceof String value && !value.isBlank() && value.length() <= 127
                    ? value : "application/octet-stream";
            files.add(new FileCandidate(id, name == null ? "document" : name, mime, size(document.get("file_size"))));
        }
        if (files.isEmpty() && message.get("photo") instanceof List<?> sizes) {
            List<FileCandidate> photos = new ArrayList<>();
            List<Long> areas = new ArrayList<>();
            for (Object item : sizes) {
                if (item instanceof Map<?, ?> photo && photo.get("file_id") instanceof String id && validFileId(id)) {
                    Long width = size(photo.get("width"));
                    Long height = size(photo.get("height"));
                    photos.add(new FileCandidate(id, "photo.jpg", "image/jpeg", size(photo.get("file_size"))));
                    areas.add(width == null || height == null ? 0L : width * height);
                }
            }
            List<Integer> order = new ArrayList<>();
            for (int i = 0; i < photos.size(); i++) {
                order.add(i);
            }
            order.sort(Comparator.comparing((Integer i) -> areas.get(i)).reversed());
            order.forEach(i -> files.add(photos.get(i)));
        }
        return files;
    }

    private static boolean validFileId(String id) {
        return !id.isBlank() && id.length() <= 256;
    }

    private static Long size(Object value) {
        return value instanceof Number number && isWhole(number) && number.longValue() >= 0 ? number.longValue() : null;
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
