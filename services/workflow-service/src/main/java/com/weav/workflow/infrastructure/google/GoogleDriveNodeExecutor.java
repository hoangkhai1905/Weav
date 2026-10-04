package com.weav.workflow.infrastructure.google;

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
    private static final int MAX_PAGE_SIZE = 100;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final GoogleApiClient client;

    public GoogleDriveNodeExecutor(GoogleApiClient client, WorkspaceConnectionPort workspaceConnections) {
        super(workspaceConnections, SERVICE);
        this.client = Objects.requireNonNull(client, "client must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    Call prepare(Map<String, Object> config) {
        UUID connectionId = parseConnectionId(config.get("connectionId"));
        return switch (config.get("operation") instanceof String operation ? operation : "") {
            case "upload" -> upload(connectionId, config);
            case "list" -> list(connectionId, config);
            default -> throw configurationFailure();
        };
    }

    private Call upload(UUID connectionId, Map<String, Object> config) {
        String name = requiredText(config.get("name"), MAX_LINE_LENGTH);
        Object rawContent = config.get("content");
        if (rawContent != null && !(rawContent instanceof String)) {
            throw configurationFailure();
        }
        byte[] content = rawContent == null ? new byte[0] : ((String) rawContent).getBytes(StandardCharsets.UTF_8);
        if (content.length > MAX_CONTENT_BYTES) {
            throw configurationFailure();
        }
        String mimeType = optionalText(config.get("mimeType"), MAX_MIME_TYPE_LENGTH);
        if (mimeType == null) {
            mimeType = DEFAULT_MIME_TYPE;
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

        return new Call(connectionId, connection -> client.call(
                connection, PROVIDER, SERVICE, "POST", "/upload/drive/v3/files", query, body));
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
