package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Adapts the published {@code ocr.extract} node configuration to the private OCR request. */
@Component
public final class OcrNodeExecutor implements NodeExecutor {

    private static final String TYPE = "ocr.extract";
    private static final Set<String> CONFIG_FIELDS = Set.of("artifactId", "fileUrl", "file", "language", "detectTables");
    /** The OCR service rejects larger uploads (its bounded spool is 10 MiB), so never send more. */
    static final int MAX_FILE_BYTES = 10 * 1024 * 1024;

    private final OcrClient client;
    private final WorkflowFileStore files;

    public OcrNodeExecutor(OcrClient client, WorkflowFileStore files) {
        this.client = Objects.requireNonNull(client, "client must not be null");
        this.files = Objects.requireNonNull(files, "files must not be null");
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> resolvedConfig) {
        if (context == null || resolvedConfig == null
                || resolvedConfig.keySet().stream().anyMatch(key -> !(key instanceof String))
                || !CONFIG_FIELDS.containsAll(resolvedConfig.keySet())) {
            throw invalidConfiguration();
        }
        boolean hasArtifact = resolvedConfig.containsKey("artifactId");
        boolean hasUrl = resolvedConfig.containsKey("fileUrl");
        boolean hasFile = resolvedConfig.containsKey("file");
        if ((hasArtifact ? 1 : 0) + (hasUrl ? 1 : 0) + (hasFile ? 1 : 0) != 1) {
            throw invalidConfiguration();
        }
        String fileId = hasFile ? fileId(resolvedConfig.get("file")) : null;

        Map<String, Object> source = new LinkedHashMap<>();
        if (hasArtifact) {
            String artifactId = canonicalUuid(resolvedConfig.get("artifactId"));
            if (artifactId == null) {
                throw invalidConfiguration();
            }
            source.put("type", "artifact");
            source.put("artifactId", artifactId);
        } else if (hasUrl) {
            Object fileUrl = resolvedConfig.get("fileUrl");
            if (!(fileUrl instanceof String value) || value.isBlank() || value.length() > 4096) {
                throw invalidConfiguration();
            }
            source.put("type", "url");
            source.put("fileUrl", value);
        }

        Object language = resolvedConfig.getOrDefault("language", "vi+en");
        if (!(language instanceof String text) || !Set.of("vi", "en", "vi+en").contains(text)) {
            throw invalidConfiguration();
        }
        Object detectTables = resolvedConfig.getOrDefault("detectTables", Boolean.TRUE);
        if (!(detectTables instanceof Boolean)) {
            throw invalidConfiguration();
        }

        if (hasFile) {
            WorkflowFileStore.StoredFile stored = files.read(context.workspaceId(), fileId);
            if (stored.reference().size() > MAX_FILE_BYTES || stored.bytes().length > MAX_FILE_BYTES) {
                throw new Failure("FILE_TOO_LARGE", "The file is larger than the 10 MiB that OCR accepts.", false);
            }
            return new Result(client.extractFile(context, stored.reference().filename(),
                    stored.reference().mimeType(), stored.bytes(), (String) language, (Boolean) detectTables), null);
        }

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("source", source);
        request.put("language", language);
        request.put("detectTables", detectTables);
        return new Result(client.extract(context, request), null);
    }

    /** The file id of a file reference object ({@code fileId} required) or of a plain id string. */
    private String fileId(Object value) {
        Object id = value instanceof Map<?, ?> reference ? reference.get("fileId") : value;
        if (!(id instanceof String text) || text.isBlank() || text.length() > 1024) {
            throw invalidConfiguration();
        }
        return text;
    }

    private String canonicalUuid(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            return null;
        }
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equalsIgnoreCase(text) ? id.toString() : null;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private Failure invalidConfiguration() {
        return new Failure("CONFIGURATION_ERROR", "OCR node configuration is invalid.", false);
    }
}
