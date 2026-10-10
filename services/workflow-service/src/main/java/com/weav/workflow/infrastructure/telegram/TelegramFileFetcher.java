package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.TelegramFilePort;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.trigger.TelegramUpdate;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Downloads the photo or document of an incoming Telegram message (Bot API getFile, then the file endpoint) with the
 * workspace bot's token and keeps it in the workflow file store. The Bot API serves at most 20 MB per file. Logs only
 * a failure code, never the bot token, the download URL or the file.
 */
@Component
public class TelegramFileFetcher implements TelegramFilePort {

    private static final Logger log = LoggerFactory.getLogger(TelegramFileFetcher.class);
    /** Telegram's own download limit for bots. */
    private static final long BOT_API_MAX_BYTES = 20L * 1024 * 1024;

    private final TelegramBotApiClient telegram;
    private final WorkspaceConnectionPort connections;
    private final WorkflowFileStore files;
    private final WorkflowFileProperties properties;

    public TelegramFileFetcher(TelegramBotApiClient telegram, WorkspaceConnectionPort connections,
                               WorkflowFileStore files, WorkflowFileProperties properties) {
        this.telegram = Objects.requireNonNull(telegram, "telegram must not be null");
        this.connections = Objects.requireNonNull(connections, "connections must not be null");
        this.files = Objects.requireNonNull(files, "files must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    @Override
    public Map<String, Object> fetch(UUID workspaceId, UUID connectionId, List<TelegramUpdate.FileCandidate> candidates) {
        TelegramUpdate.FileCandidate largest = candidates.get(0);
        if (!files.configured()) {
            return skipped(largest, "not_stored");
        }
        long limit = Math.min(properties.getMaxFileBytes(), BOT_API_MAX_BYTES);
        // Photos come in several sizes: take the largest one that fits; an unknown size is checked on download.
        TelegramUpdate.FileCandidate pick = candidates.stream()
                .filter(candidate -> candidate.size() == null || candidate.size() <= limit)
                .findFirst().orElse(null);
        if (pick == null) {
            return skipped(largest, "too_large");
        }
        try (ResolvedConnection connection = connections.resolve(workspaceId, connectionId)) {
            TelegramBotApiClient.RemoteFile remote = telegram.getFile(connection, pick.telegramFileId());
            if (remote.size() != null && remote.size() > limit) {
                return skipped(pick, "too_large");
            }
            byte[] bytes = telegram.downloadFile(connection, remote.filePath(), (int) limit);
            WorkflowFileStore.FileReference stored = files.store(
                    workspaceId, null, pick.filename(), pick.mimeType(), bytes);
            Map<String, Object> file = new LinkedHashMap<>();
            file.put("fileId", stored.fileId());
            file.put("filename", stored.filename());
            file.put("mimeType", stored.mimeType());
            file.put("size", stored.size());
            return file;
        } catch (NodeExecutor.Failure failure) {
            String reason = switch (failure.code()) {
                case "FILE_TOO_LARGE", "HTTP_RESPONSE_TOO_LARGE" -> "too_large";
                case "DEPENDENCY_NOT_CONFIGURED" -> "not_stored";
                default -> "error";
            };
            log.warn("event=telegram_file_skipped reason={} code={}", reason, failure.code());
            return skipped(pick, reason);
        } catch (RuntimeException exception) {
            log.warn("event=telegram_file_skipped reason=error errorType={}", exception.getClass().getSimpleName());
            return skipped(pick, "error");
        }
    }

    private static Map<String, Object> skipped(TelegramUpdate.FileCandidate candidate, String reason) {
        Map<String, Object> file = new LinkedHashMap<>();
        file.put("skipped", reason);
        file.put("filename", candidate.filename());
        file.put("mimeType", candidate.mimeType());
        if (candidate.size() != null) {
            file.put("size", candidate.size());
        }
        return file;
    }
}
