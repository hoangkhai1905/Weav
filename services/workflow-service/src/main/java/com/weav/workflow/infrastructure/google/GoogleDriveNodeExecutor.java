package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** Uploads a text file to, or lists files in, Google Drive with Workspace-owned OAuth credentials. */
@Component
public final class GoogleDriveNodeExecutor extends GoogleApiNodeExecutor {

    private static final String TYPE = "google.drive";
    private static final String PROVIDER = "GOOGLE_DRIVE";
    private static final String SERVICE = "Google Drive";
    private static final String DEFAULT_MIME_TYPE = "text/plain";
    private static final Pattern MIME_TYPE = Pattern.compile("^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$");
    private static final int MAX_LINE_LENGTH = 1024;
    private static final int MAX_MIME_TYPE_LENGTH = 127;
    /** Stays below the outbound request cap (1 MiB) once the multipart envelope is added. */
    static final int MAX_CONTENT_BYTES = 512 * 1024;
    /** A stored file goes up as one multipart request (resumable upload is not supported). */
    static final int MAX_FILE_BYTES = 5 * 1024 * 1024;
    private static final int UPLOAD_CAP_BYTES = MAX_FILE_BYTES + 64 * 1024;
    private static final int MAX_PAGE_SIZE = 100;
    /** A download is kept in the workflow file store, whose default per-file limit is the same. */
    static final int MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final GoogleApiClient client;
    private final WorkflowFileStore files;

    public GoogleDriveNodeExecutor(GoogleApiClient client, WorkspaceConnectionPort workspaceConnections,
                                   WorkflowFileStore files) {
        super(workspaceConnections, SERVICE);
        this.client = Objects.requireNonNull(client, "client must not be null");
        this.files = Objects.requireNonNull(files, "files must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    Call prepare(Map<String, Object> config) {
        return prepare(null, config);
    }

    @Override
    Call prepare(Context context, Map<String, Object> config) {
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        return switch (config.get("operation") instanceof String operation ? operation : "") {
            case "upload" -> upload(context, connectionId, config);
            case "list" -> list(connectionId, config);
            case "download" -> download(context, connectionId, config);
            default -> throw configurationFailure();
        };
    }

    private Call upload(Context context, UUID connectionId, Map<String, Object> config) {
        Object rawContent = config.get("content");
        Object rawFile = config.get("file");
        if (rawContent != null && !(rawContent instanceof String)
                || rawFile != null && rawContent instanceof String text && !text.isBlank()) {
            throw configurationFailure(); // content and file together; neither is the old empty upload
        }
        WorkflowFileStore.StoredFile stored = rawFile == null ? null : readFile(context, rawFile);
        String name = stored == null ? requiredText(config.get("name"), MAX_LINE_LENGTH)
                : optionalText(config.get("name"), MAX_LINE_LENGTH);
        if (name == null && stored != null) {
            name = stored.reference().filename();
        }
        byte[] content;
        if (stored != null) {
            content = stored.bytes();
        } else {
            content = rawContent == null ? new byte[0] : ((String) rawContent).getBytes(StandardCharsets.UTF_8);
            if (content.length > MAX_CONTENT_BYTES) {
                throw configurationFailure();
            }
        }
        String mimeType = optionalText(config.get("mimeType"), MAX_MIME_TYPE_LENGTH);
        if (mimeType == null) {
            mimeType = stored != null && MIME_TYPE.matcher(stored.reference().mimeType()).matches()
                    ? stored.reference().mimeType() : stored != null ? "application/octet-stream" : DEFAULT_MIME_TYPE;
        } else if (!MIME_TYPE.matcher(mimeType).matches()) {
            throw configurationFailure();
        }
        String folderId = optionalText(config.get("folderId"), MAX_LINE_LENGTH);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("name", name);
        metadata.put("mimeType", mimeType);
        if (folderId != null) {
            metadata.put("parents", List.of(folderId));
        }
        String boundary = "weav-" + UUID.randomUUID().toString().replace("-", "");
        PinnedHttpTransport.RawBody body = multipart(boundary, JSON.writeValueAsString(metadata), mimeType, content);
        Map<String, String> query = Map.of(
                "uploadType", "multipart", "fields", "id,name,mimeType,webViewLink");

        int cap = stored != null ? UPLOAD_CAP_BYTES : 0; // content uploads keep the default cap and the 5-argument call
        return new Call(connectionId, connection -> client.call(
                connection, PROVIDER, SERVICE, "POST", "/upload/drive/v3/files", query, body, cap));
    }

    /** Reads the referenced file of this workspace; a missing or oversized file is a non-retryable failure. */
    private WorkflowFileStore.StoredFile readFile(Context context, Object reference) {
        if (context == null || !(reference instanceof Map<?, ?> map) || !(map.get("fileId") instanceof String fileId)
                || fileId.isBlank() || fileId.length() > MAX_LINE_LENGTH) {
            throw new NodeExecutor.Failure("CONFIGURATION_ERROR", "file must be a file reference object with fileId", false);
        }
        WorkflowFileStore.StoredFile stored = files.read(context.workspaceId(), fileId);
        if (stored.reference().size() > MAX_FILE_BYTES || stored.bytes().length > MAX_FILE_BYTES) {
            throw new NodeExecutor.Failure("FILE_TOO_LARGE",
                    "The file is larger than the 5 MiB that Google Drive upload supports here.", false);
        }
        return stored;
    }

    /**
     * Downloads one Drive file into the workflow file store and returns a file reference under "file". Google-native
     * documents (Docs, Sheets, Slides) have no binary content and fail with a clear non-retryable error; exporting
     * them is left out on purpose.
     */
    private Call download(Context context, UUID connectionId, Map<String, Object> config) {
        String driveFileId = requiredText(config.get("fileId"), MAX_LINE_LENGTH);
        if (context == null) {
            throw configurationFailure();
        }
        String path = "/drive/v3/files/" + GoogleApiClient.encodePathSegment(driveFileId, SERVICE);
        if (!files.configured()) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                    "File storage is not configured, so the Drive file cannot be kept for the next steps.", false);
        }
        return new Call(connectionId, connection -> {
            Map<String, Object> meta = client.call(connection, PROVIDER, SERVICE, "GET", path,
                    Map.of("fields", "id,name,mimeType,size"), null);
            String mimeType = meta.get("mimeType") instanceof String text ? text : "application/octet-stream";
            if (mimeType.startsWith("application/vnd.google-apps.")) {
                throw new NodeExecutor.Failure("CONFIGURATION_ERROR",
                        "This is a Google Docs, Sheets or Slides file, which cannot be downloaded as is. "
                                + "Pick a regular file such as a PDF or an image.", false);
            }
            if (meta.get("size") instanceof String size && size.matches("[0-9]{1,18}")
                    && Long.parseLong(size) > MAX_DOWNLOAD_BYTES) {
                throw tooLarge();
            }
            byte[] bytes;
            try {
                bytes = client.download(connection, PROVIDER, SERVICE, path, Map.of("alt", "media"),
                        MAX_DOWNLOAD_BYTES);
            } catch (NodeExecutor.Failure failure) {
                throw "HTTP_RESPONSE_TOO_LARGE".equals(failure.code()) ? tooLarge() : failure;
            }
            String name = meta.get("name") instanceof String text ? WorkflowFileStore.safeFilename(text) : null;
            WorkflowFileStore.FileReference stored = files.store(context.workspaceId(), context.executionId(),
                    name == null ? "drive-file" : name, mimeType, bytes);
            Map<String, Object> reference = new LinkedHashMap<>();
            reference.put("fileId", stored.fileId());
            reference.put("filename", stored.filename());
            reference.put("mimeType", stored.mimeType());
            reference.put("size", stored.size());
            return Map.of("file", reference);
        });
    }

    private static NodeExecutor.Failure tooLarge() {
        return new NodeExecutor.Failure("FILE_TOO_LARGE",
                "The Drive file is larger than the 10 MiB that can be downloaded here.", false);
    }

    private Call list(UUID connectionId, Map<String, Object> config) {
        String folderId = optionalText(config.get("folderId"), MAX_LINE_LENGTH);
        String nameContains = optionalText(config.get("nameContains"), MAX_LINE_LENGTH);
        StringBuilder q = new StringBuilder("trashed = false");
        if (folderId != null) {
            q.append(" and '").append(escape(folderId)).append("' in parents");
        }
        if (nameContains != null) {
            q.append(" and name contains '").append(escape(nameContains)).append('\'');
        }
        Map<String, String> query = Map.of(
                "q", q.toString(),
                "fields", "files(id,name,mimeType,modifiedTime,webViewLink)",
                "pageSize", Integer.toString(pageSize(config.get("pageSize"))));

        return new Call(connectionId, connection -> {
            Map<String, Object> response = client.call(
                    connection, PROVIDER, SERVICE, "GET", "/drive/v3/files", query, null);
            List<Object> files = new ArrayList<>();
            if (response.get("files") instanceof List<?> found) {
                for (Object file : found) {
                    if (file instanceof Map<?, ?>) {
                        files.add(file);
                    }
                }
            }
            return Map.of("files", files);
        });
    }

    private int pageSize(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return MAX_PAGE_SIZE;
        }
        BigDecimal number;
        try {
            number = value instanceof Number n ? new BigDecimal(n.toString())
                    : value instanceof String text ? new BigDecimal(text.trim()) : null;
        } catch (NumberFormatException exception) {
            throw configurationFailure();
        }
        if (number == null || number.signum() <= 0 || number.stripTrailingZeros().scale() > 0) {
            throw configurationFailure();
        }
        return number.compareTo(BigDecimal.valueOf(MAX_PAGE_SIZE)) > 0 ? MAX_PAGE_SIZE : number.intValueExact();
    }

    /** Escapes a value for a single-quoted Drive query string literal. */
    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("'", "\\'");
    }

    private static PinnedHttpTransport.RawBody multipart(
            String boundary, String metadataJson, String mimeType, byte[] content) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(content.length + metadataJson.length() + 256);
        write(out, "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadataJson + "\r\n--" + boundary + "\r\nContent-Type: " + mimeType + "\r\n\r\n");
        out.writeBytes(content);
        write(out, "\r\n--" + boundary + "--");
        return new PinnedHttpTransport.RawBody(out.toByteArray(), "multipart/related; boundary=" + boundary);
    }

    private static void write(ByteArrayOutputStream out, String text) {
        out.writeBytes(text.getBytes(StandardCharsets.UTF_8));
    }
}
