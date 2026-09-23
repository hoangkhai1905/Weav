package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.http.OutputSanitizer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Bounded client for the private OCR extraction contract. */
@Component
public class OcrClient {

    private static final String EXTRACTION_PATH = "/v1/extractions";
    private static final Pattern TRACEPARENT = Pattern.compile(
            "^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$");
    private static final Set<String> ERROR_CODES = Set.of(
            "INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "ARTIFACT_NOT_FOUND",
            "FILE_TOO_LARGE", "DOCUMENT_LIMIT_EXCEEDED", "UNSUPPORTED_MEDIA_TYPE", "INVALID_OPTIONS",
            "CORRUPT_FILE", "ENCRYPTED_PDF", "ANIMATED_IMAGE_UNSUPPORTED", "SOURCE_URL_NOT_ALLOWED",
            "SOURCE_UNAVAILABLE", "OUTPUT_LIMIT_EXCEEDED", "RATE_LIMITED", "INTERNAL_ERROR",
            "SOURCE_FETCH_FAILED", "TABLE_EXTRACTION_FAILED", "OCR_BUSY", "MODEL_NOT_READY",
            "SOURCE_TIMEOUT", "OCR_TIMEOUT", "REQUEST_TIMEOUT", "UPLOAD_TIMEOUT");
    private static final Set<String> REQUEST_FIELDS = Set.of("source", "language", "detectTables");

    private final OcrClientProperties properties;
    private final WorkflowServiceJwtIssuer jwtIssuer;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    @Autowired
    public OcrClient(
            OcrClientProperties properties,
            WorkflowServiceJwtIssuer jwtIssuer,
            @Qualifier("ocrRestClient") RestClient restClient,
            ObjectMapper objectMapper) {
        this(properties, jwtIssuer, restClient, objectMapper, Clock.systemUTC());
    }

    OcrClient(
            OcrClientProperties properties,
            WorkflowServiceJwtIssuer jwtIssuer,
            RestClient restClient,
            ObjectMapper objectMapper,
            Clock clock) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.jwtIssuer = Objects.requireNonNull(jwtIssuer, "jwtIssuer must not be null");
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    public Map<String, Object> extract(NodeExecutor.Context context, Map<String, Object> request) {
        if (context == null) {
            throw configurationFailure();
        }
        ExtractionRequest extractionRequest = parseRequest(request);
        requireEnabledFor(extractionRequest.sourceType());

        UUID requestId = UUID.randomUUID();
        String serviceToken = jwtIssuer.issue(context, Instant.now(clock));
        byte[] requestBody = serializeRequest(extractionRequest);
        HttpResponse response;
        try {
            response = restClient.post()
                    .uri(endpoint())
                    .headers(headers -> {
                        headers.setBearerAuth(serviceToken);
                        headers.setContentType(MediaType.APPLICATION_JSON);
                        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
                        headers.set("X-Request-ID", requestId.toString());
                        if (validTraceparent(context.traceparent())) {
                            headers.set("traceparent", context.traceparent());
                        }
                    })
                    .body(requestBody)
                    .exchange((clientRequest, clientResponse) -> new HttpResponse(
                            clientResponse.getStatusCode().value(),
                            clientResponse.getHeaders().getFirst(HttpHeaders.CONTENT_TYPE),
                            readBounded(clientResponse.getBody())));
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            // The throwable may contain the signed source URL or service JWT; retain no cause or message.
            throw unavailableFailure();
        }

        if (response.body().tooLarge()) {
            throw invalidResponseFailure();
        }
        if (response.status() != 200) {
            throw providerFailure(response.status(), response.body().bytes(), response.contentType());
        }
        if (!isJson(response.contentType())) {
            throw invalidResponseFailure();
        }

        JsonNode payload = parseObject(response.body().bytes());
        validateSuccess(payload, requestId);
        Map<String, Object> result = toMap(response.body().bytes());
        LinkedHashSet<String> activeSecrets = new LinkedHashSet<>();
        activeSecrets.add(serviceToken);
        if (extractionRequest.sensitiveSourceValue() != null) {
            activeSecrets.add(extractionRequest.sensitiveSourceValue());
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> sanitized = (Map<String, Object>) OutputSanitizer.sanitize(result, activeSecrets);
        return sanitized;
    }

    private void requireEnabledFor(String sourceType) {
        boolean enabled = properties.enabled() && properties.serviceClaimsVerified();
        if ("url".equals(sourceType)) {
            if (!enabled || !properties.urlSourceEnabled() || !properties.urlAllowlistVerified()) {
                throw notConfiguredFailure();
            }
            return;
        }
        if (!enabled || !properties.artifactSourceEnabled() || !properties.artifactResolverVerified()) {
            throw notConfiguredFailure();
        }
    }

    private ExtractionRequest parseRequest(Map<String, Object> request) {
        if (request == null || request.keySet().stream().anyMatch(key -> !(key instanceof String))
                || !REQUEST_FIELDS.containsAll(request.keySet())) {
            throw configurationFailure();
        }
        Object rawSource = request.get("source");
        if (!(rawSource instanceof Map<?, ?> source) || source.size() != 2
                || !(source.get("type") instanceof String sourceType)) {
            throw configurationFailure();
        }

        Object languageValue = request.getOrDefault("language", "vi+en");
        if (!(languageValue instanceof String language)
                || !Set.of("vi", "en", "vi+en").contains(language)) {
            throw configurationFailure();
        }
        Object detectTablesValue = request.getOrDefault("detectTables", Boolean.TRUE);
        if (!(detectTablesValue instanceof Boolean detectTables)) {
            throw configurationFailure();
        }

        Map<String, Object> sourcePayload = new LinkedHashMap<>();
        String sensitiveValue;
        if ("url".equals(sourceType)) {
            if (!source.keySet().equals(Set.of("type", "fileUrl"))) {
                throw configurationFailure();
            }
            Object value = source.get("fileUrl");
            if (!(value instanceof String fileUrl) || !validSourceUrl(fileUrl)) {
                throw configurationFailure();
            }
            sourcePayload.put("type", "url");
            sourcePayload.put("fileUrl", fileUrl);
            sensitiveValue = fileUrl;
        } else if ("artifact".equals(sourceType)) {
            if (!source.keySet().equals(Set.of("type", "artifactId"))) {
                throw configurationFailure();
            }
            Object value = source.get("artifactId");
            String artifactId = canonicalUuid(value);
            if (artifactId == null) {
                throw configurationFailure();
            }
            sourcePayload.put("type", "artifact");
            sourcePayload.put("artifactId", artifactId);
            sensitiveValue = null;
        } else {
            throw configurationFailure();
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("source", sourcePayload);
        payload.put("language", language);
        payload.put("detectTables", detectTables);
        return new ExtractionRequest(sourceType, payload, sensitiveValue);
    }

    private boolean validSourceUrl(String value) {
        if (value.isBlank() || value.length() > 4096 || hasControl(value)) {
            return false;
        }
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && uri.getHost() != null && !uri.getHost().isBlank()
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getUserInfo() == null && uri.getFragment() == null;
        } catch (IllegalArgumentException exception) {
            return false;
        }
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

    private URI endpoint() {
        return properties.baseUrl().resolve(EXTRACTION_PATH);
    }

    private byte[] serializeRequest(ExtractionRequest request) {
        try {
            return objectMapper.writeValueAsBytes(request.payload());
        } catch (RuntimeException exception) {
            throw configurationFailure();
        }
    }

    private BoundedBody readBounded(InputStream body) throws IOException {
        if (body == null) {
            return new BoundedBody(new byte[0], false);
        }
        byte[] bytes = body.readNBytes(properties.maxResponseBytes() + 1);
        if (bytes.length > properties.maxResponseBytes()) {
            return new BoundedBody(new byte[0], true);
        }
        return new BoundedBody(bytes, false);
    }

    private NodeExecutor.Failure providerFailure(int status, byte[] body, String contentType) {
        String code = "OCR_HTTP_ERROR";
        Boolean declaredRetryable = null;
        if (isJson(contentType) && body.length > 0) {
            try {
                JsonNode root = parseObject(body);
                JsonNode error = root.get("error");
                if (error != null && error.isObject()) {
                    JsonNode codeNode = error.get("code");
                    if (codeNode != null && codeNode.isString()
                            && ERROR_CODES.contains(codeNode.stringValue())) {
                        code = codeNode.stringValue();
                    }
                    JsonNode retryable = error.get("retryable");
                    if (retryable != null && retryable.isBoolean()) {
                        declaredRetryable = retryable.booleanValue();
                    }
                }
            } catch (NodeExecutor.Failure ignored) {
                // Use a generic, status-based classification for a malformed provider envelope.
            }
        }
        boolean transientStatus = status == 408 || status == 429 || status == 500
                || status == 502 || status == 503 || status == 504;
        boolean retryable = declaredRetryable == null ? transientStatus : transientStatus && declaredRetryable;
        return new NodeExecutor.Failure(code, "The OCR service could not process this document.", retryable);
    }

    private JsonNode parseObject(byte[] body) {
        try {
            JsonNode payload = objectMapper.reader()
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .readTree(body);
            if (payload == null || !payload.isObject()) {
                throw invalidResponseFailure();
            }
            return payload;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw invalidResponseFailure();
        }
    }

    private Map<String, Object> toMap(byte[] body) {
        try {
            Object parsed = objectMapper.readerFor(Object.class).readValue(body);
            if (!(parsed instanceof Map<?, ?> raw)) {
                throw invalidResponseFailure();
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : raw.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw invalidResponseFailure();
                }
                result.put(key, entry.getValue());
            }
            return result;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw invalidResponseFailure();
        }
    }

    private void validateSuccess(JsonNode root, UUID requestId) {
        if (!textEquals(root, "schemaVersion", "1.0")
                || !uuidEquals(root, "requestId", requestId)
                || !validDocument(root.get("document"))
                || !validText(root.get("text"))
                || !validConfidence(root.get("confidence"))
                || !validBlocks(root.get("blocks"), root.get("document").get("pages").intValue())
                || !validTables(root.get("tables"), root.get("document").get("pages").intValue())
                || !validMetadata(root.get("metadata"))) {
            throw invalidResponseFailure();
        }
    }

    private boolean validDocument(JsonNode document) {
        String mimeType = textField(document, "mimeType");
        if (document == null || !document.isObject()
                || !textFieldValid(document, "fileName", 255)
                || mimeType == null
                || !Set.of("image/png", "image/jpeg", "image/webp", "application/pdf").contains(mimeType)) {
            return false;
        }
        JsonNode pages = document.get("pages");
        JsonNode pageInfo = document.get("pageInfo");
        if (!positiveInteger(pages, 10) || pageInfo == null || !pageInfo.isArray()
                || pageInfo.size() != pages.intValue()) {
            return false;
        }
        for (JsonNode page : pageInfo) {
            JsonNode pageNumber = page == null ? null : page.get("page");
            JsonNode width = page == null ? null : page.get("width");
            JsonNode height = page == null ? null : page.get("height");
            JsonNode dpi = page == null ? null : page.get("dpi");
            if (page == null || !page.isObject() || !positiveInteger(pageNumber, 10)
                    || !positiveInteger(width, 10_000) || !positiveInteger(height, 10_000)
                    || !(dpi != null && (dpi.isNull() || dpi.isIntegralNumber() && dpi.intValue() > 0))) {
                return false;
            }
        }
        return true;
    }

    private boolean validText(JsonNode text) {
        JsonNode rawText = text == null ? null : text.get("rawText");
        return text != null && text.isObject() && rawText != null && rawText.isString()
                && rawText.stringValue().length() <= 1_048_576;
    }

    private boolean validBlocks(JsonNode blocks, int pageCount) {
        if (blocks == null || !blocks.isArray() || blocks.size() > 20_000) {
            return false;
        }
        for (JsonNode block : blocks) {
            if (block == null || !block.isObject()
                    || !textFieldValid(block, "id", 255)
                    || !nonNegativeInteger(block.get("order"))
                    || !textFieldValid(block, "text", 1_048_576)
                    || !validConfidence(block.get("confidence"))
                    || !boundedInteger(block.get("page"), 1, pageCount)
                    || !validBoundingBox(block.get("boundingBox"))) {
                return false;
            }
        }
        return true;
    }

    private boolean validTables(JsonNode tables, int pageCount) {
        if (tables == null || !tables.isArray() || tables.size() > 100) {
            return false;
        }
        int cellCount = 0;
        for (JsonNode table : tables) {
            JsonNode cells = table == null ? null : table.get("cells");
            if (table == null || !table.isObject()
                    || !textFieldValid(table, "id", 255)
                    || !boundedInteger(table.get("page"), 1, pageCount)
                    || !validBoundingBox(table.get("boundingBox"))
                    || !positiveInteger(table.get("rowCount"), Integer.MAX_VALUE)
                    || !positiveInteger(table.get("columnCount"), Integer.MAX_VALUE)
                    || !validConfidence(table.get("confidence"))
                    || cells == null || !cells.isArray()) {
                return false;
            }
            cellCount += cells.size();
            if (cellCount > 10_000) {
                return false;
            }
            for (JsonNode cell : cells) {
                if (cell == null || !cell.isObject()
                        || !nonNegativeInteger(cell.get("row"))
                        || !nonNegativeInteger(cell.get("column"))
                        || !positiveInteger(cell.get("rowSpan"), Integer.MAX_VALUE)
                        || !positiveInteger(cell.get("columnSpan"), Integer.MAX_VALUE)
                        || !textFieldValid(cell, "text", 1_048_576)
                        || !validConfidence(cell.get("confidence"))
                        || !stringArray(cell.get("sourceBlockIds"))) {
                    return false;
                }
                JsonNode box = cell.get("boundingBox");
                if (box != null && !box.isNull() && !validBoundingBox(box)) {
                    return false;
                }
            }
        }
        return true;
    }

    private boolean validMetadata(JsonNode metadata) {
        String tableDetection = textField(metadata, "tableDetection");
        String quality = textField(metadata, "quality");
        return metadata != null && metadata.isObject()
                && textFieldValid(metadata, "language", 16)
                && textFieldValid(metadata, "resolvedLanguage", 128)
                && nonNegativeInteger(metadata.get("processingTimeMs"))
                && textFieldValid(metadata, "engine", 128)
                && textFieldValid(metadata, "engineVersion", 128)
                && textFieldValid(metadata, "modelRevision", 255)
                && tableDetection != null && Set.of("not_requested", "completed").contains(tableDetection)
                && quality != null && Set.of("OK", "LOW_CONFIDENCE", "EMPTY").contains(quality)
                && metadata.get("preprocessing") != null && metadata.get("preprocessing").isArray()
                && metadata.get("warnings") != null && metadata.get("warnings").isArray();
    }

    private boolean validBoundingBox(JsonNode box) {
        if (box == null || !box.isObject()) {
            return false;
        }
        JsonNode x = box.get("x");
        JsonNode y = box.get("y");
        JsonNode width = box.get("width");
        JsonNode height = box.get("height");
        return nonNegativeNumber(x) && nonNegativeNumber(y)
                && positiveNumber(width) && positiveNumber(height);
    }

    private boolean validConfidence(JsonNode value) {
        return value != null && (value.isNull()
                || value.isNumber() && value.numberValue().doubleValue() >= 0.0
                && value.numberValue().doubleValue() <= 1.0);
    }

    private boolean nonNegativeNumber(JsonNode value) {
        return value != null && value.isNumber() && value.numberValue().doubleValue() >= 0.0;
    }

    private boolean positiveNumber(JsonNode value) {
        return value != null && value.isNumber() && value.numberValue().doubleValue() > 0.0;
    }

    private boolean positiveInteger(JsonNode value, int maximum) {
        return value != null && value.isIntegralNumber() && value.intValue() >= 1 && value.intValue() <= maximum;
    }

    private boolean nonNegativeInteger(JsonNode value) {
        return value != null && value.isIntegralNumber() && value.longValue() >= 0;
    }

    private boolean boundedInteger(JsonNode value, int minimum, int maximum) {
        return value != null && value.isIntegralNumber()
                && value.intValue() >= minimum && value.intValue() <= maximum;
    }

    private boolean stringArray(JsonNode value) {
        if (value == null || !value.isArray()) {
            return false;
        }
        for (JsonNode item : value) {
            if (item == null || !item.isString()) {
                return false;
            }
        }
        return true;
    }

    private boolean textEquals(JsonNode parent, String field, String expected) {
        JsonNode value = parent == null ? null : parent.get(field);
        return value != null && value.isString() && expected.equals(value.stringValue());
    }

    private boolean uuidEquals(JsonNode parent, String field, UUID expected) {
        JsonNode value = parent == null ? null : parent.get(field);
        if (value == null || !value.isString()) {
            return false;
        }
        try {
            return expected.equals(UUID.fromString(value.stringValue()));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private boolean textFieldValid(JsonNode parent, String field, int maxLength) {
        String value = textField(parent, field);
        return value != null && !value.isBlank() && value.length() <= maxLength;
    }

    private String textField(JsonNode parent, String field) {
        JsonNode value = parent == null ? null : parent.get(field);
        return value != null && value.isString() ? value.stringValue() : null;
    }

    private boolean isJson(String contentType) {
        if (contentType == null) {
            return false;
        }
        try {
            return MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(contentType));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private boolean validTraceparent(String traceparent) {
        if (traceparent == null) {
            return false;
        }
        var matcher = TRACEPARENT.matcher(traceparent);
        if (!matcher.matches()) {
            return false;
        }
        return !matcher.group(1).matches("0{32}") && !matcher.group(2).matches("0{16}");
    }

    private boolean hasControl(String value) {
        return value.codePoints().anyMatch(character -> character < 0x20 || character == 0x7f);
    }

    private NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR", "OCR node configuration is invalid.", false);
    }

    private NodeExecutor.Failure notConfiguredFailure() {
        return new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                "OCR execution is disabled until its security and source prerequisites are approved.", false);
    }

    private NodeExecutor.Failure invalidResponseFailure() {
        return new NodeExecutor.Failure("OCR_INVALID_RESPONSE", "The OCR service returned an invalid response.", false);
    }

    private NodeExecutor.Failure unavailableFailure() {
        return new NodeExecutor.Failure("OCR_UNAVAILABLE", "The OCR service is unavailable.", true);
    }

    private record ExtractionRequest(String sourceType, Map<String, Object> payload, String sensitiveSourceValue) {
    }

    private record BoundedBody(byte[] bytes, boolean tooLarge) {
    }

    private record HttpResponse(int status, String contentType, BoundedBody body) {
    }
}
