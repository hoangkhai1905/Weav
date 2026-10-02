package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
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
    private static final Set<String> CONFIG_FIELDS = Set.of("artifactId", "fileUrl", "language", "detectTables");

    private final OcrClient client;

    public OcrNodeExecutor(OcrClient client) {
        this.client = Objects.requireNonNull(client, "client must not be null");
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
        if (hasArtifact == hasUrl) {
            throw invalidConfiguration();
        }

        Map<String, Object> source = new LinkedHashMap<>();
        if (hasArtifact) {
            String artifactId = canonicalUuid(resolvedConfig.get("artifactId"));
            if (artifactId == null) {
                throw invalidConfiguration();
            }
            source.put("type", "artifact");
            source.put("artifactId", artifactId);
        } else {
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

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("source", source);
        request.put("language", language);
        request.put("detectTables", detectTables);
        return new Result(client.extract(context, request), null);
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
