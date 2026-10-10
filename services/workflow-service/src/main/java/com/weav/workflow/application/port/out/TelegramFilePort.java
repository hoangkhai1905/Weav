package com.weav.workflow.application.port.out;

import com.weav.workflow.application.trigger.TelegramUpdate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Downloads the file of an incoming Telegram message with the workspace bot's token and keeps it in the file store. */
public interface TelegramFilePort {

    /**
     * Stores the best candidate that fits the file size limit and returns the trigger input {@code file}:
     * {@code {fileId, filename, mimeType, size}}, or {@code {skipped: "too_large" | "not_stored" | "error",
     * filename, mimeType, size?}} when it could not be kept. Never throws and never exposes the bot token.
     *
     * @param candidates the offered files, largest first (not empty)
     */
    Map<String, Object> fetch(UUID workspaceId, UUID connectionId, List<TelegramUpdate.FileCandidate> candidates);
}
