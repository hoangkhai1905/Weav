package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Creates a Google Doc (a Drive upload that Google converts to a Doc) or appends text to one, through the
 * connection's {@code drive.file} permission, so only Docs created or opened by Weav are reachable.
 */
@Component
public final class GoogleDocsNodeExecutor extends GoogleApiNodeExecutor {

    private static final String TYPE = "google.docs";
    private static final String PROVIDER = "GOOGLE_DRIVE";
    private static final String SERVICE = "Google Docs";
    private static final String DOC_MIME_TYPE = "application/vnd.google-apps.document";
    private static final Pattern DOCUMENT_ID = Pattern.compile("^[A-Za-z0-9_-]{10,200}$");
    private static final int MAX_LINE_LENGTH = 1024;
    /** Stays below the outbound request cap (1 MiB) once the multipart envelope is added. */
    private static final int MAX_CONTENT_BYTES = 512 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final GoogleApiClient client;

    public GoogleDocsNodeExecutor(GoogleApiClient client, WorkspaceConnectionPort workspaceConnections) {
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
            case "create" -> create(connectionId, config);
            case "append" -> append(connectionId, config);
            default -> throw configurationFailure();
        };
    }

    private Call create(UUID connectionId, Map<String, Object> config) {
        String title = requiredText(config.get("title"), MAX_LINE_LENGTH);
        byte[] content = config.get("content") == null ? new byte[0] : boundedContent(config.get("content"));
        String folderId = optionalText(config.get("folderId"), MAX_LINE_LENGTH);

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("name", title);
        metadata.put("mimeType", DOC_MIME_TYPE);
        if (folderId != null) {
            metadata.put("parents", List.of(folderId));
        }
        String boundary = "weav-" + UUID.randomUUID().toString().replace("-", "");
        PinnedHttpTransport.RawBody body = GoogleMultipart.related(
                boundary, JSON.writeValueAsString(metadata), "text/plain; charset=UTF-8", content);
        Map<String, String> query = Map.of("uploadType", "multipart", "fields", "id,name,webViewLink");

        return new Call(connectionId, connection -> {
            Map<String, Object> file = client.call(
                    connection, PROVIDER, SERVICE, "POST", "/upload/drive/v3/files", query, body);
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("documentId", file.get("id"));
            output.put("title", file.get("name"));
            output.put("url", file.get("webViewLink"));
            return output;
        });
    }

    private Call append(UUID connectionId, Map<String, Object> config) {
        if (!(config.get("documentId") instanceof String documentId) || !DOCUMENT_ID.matcher(documentId).matches()) {
            throw configurationFailure();
        }
        if (!(config.get("content") instanceof String content) || content.isBlank()) {
            throw configurationFailure();
        }
        boundedContent(content);
        Map<String, Object> body = Map.of("requests", List.of(Map.of("insertText",
                Map.of("endOfSegmentLocation", Map.of(), "text", "\n" + content))));

        return new Call(connectionId, connection -> {
            client.docsBatchUpdate(connection, PROVIDER, SERVICE, documentId, body);
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("documentId", documentId);
            output.put("url", "https://docs.google.com/document/d/" + documentId + "/edit");
            output.put("appendedCharacters", content.length());
            return output;
        });
    }

    /** The UTF-8 bytes of a text value of at most 512 KiB; anything else is a configuration error. */
    private byte[] boundedContent(Object value) {
        if (!(value instanceof String text)) {
            throw configurationFailure();
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_CONTENT_BYTES) {
            throw configurationFailure();
        }
        return bytes;
    }
}
