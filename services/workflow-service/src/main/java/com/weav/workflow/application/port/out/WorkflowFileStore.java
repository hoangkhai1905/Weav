package com.weav.workflow.application.port.out;

import java.util.UUID;

/**
 * Workspace-scoped store for files that move between workflow nodes (Gmail attachments, email attachments, Drive
 * uploads). Failures are {@code NodeExecutor.Failure}: {@code DEPENDENCY_NOT_CONFIGURED}, {@code FILE_TOO_LARGE},
 * {@code FILE_NOT_FOUND} (unknown id, other workspace and expired look the same) and a retryable
 * {@code FILE_STORE_UNAVAILABLE}.
 */
public interface WorkflowFileStore {

    /** False when the object storage settings are missing; {@link #store} and {@link #read} then fail. */
    boolean configured();

    /** Stores the bytes and returns the reference that node output carries. */
    FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] bytes);

    /** Reads a file of {@code workspaceId}; {@code fileId} is the text from a {@link FileReference}. */
    StoredFile read(UUID workspaceId, String fileId);

    /** Deletes up to {@code limit} expired files (object first, then row); returns how many were removed. */
    int purgeExpired(int limit);

    /**
     * The one filename sanitizer (stored files, Content-Disposition names, attachment names). Drops path
     * separators, control, format (bidi overrides, zero-width) and line/paragraph separator characters, trims,
     * truncates to 255 chars without splitting a surrogate pair, and returns null when nothing usable is left
     * (empty or only dots). Callers pick their own fallback name.
     */
    static String safeFilename(String filename) {
        if (filename == null) {
            return null;
        }
        StringBuilder cleaned = new StringBuilder();
        filename.codePoints().filter(cp -> cp != '/' && cp != '\\' && !Character.isISOControl(cp)
                && Character.getType(cp) != Character.FORMAT
                && Character.getType(cp) != Character.LINE_SEPARATOR
                && Character.getType(cp) != Character.PARAGRAPH_SEPARATOR).forEach(cleaned::appendCodePoint);
        String name = cleaned.toString().strip();
        if (name.length() > 255) {
            name = name.substring(0, Character.isHighSurrogate(name.charAt(254)) ? 254 : 255).stripTrailing();
        }
        return name.isEmpty() || name.chars().allMatch(c -> c == '.') ? null : name;
    }

    /** Plain-JSON file reference: {@code {"fileId","filename","mimeType","size"}}. Only fileId matters when reading. */
    record FileReference(String fileId, String filename, String mimeType, long size) {
    }

    record StoredFile(FileReference reference, byte[] bytes) {
    }
}
