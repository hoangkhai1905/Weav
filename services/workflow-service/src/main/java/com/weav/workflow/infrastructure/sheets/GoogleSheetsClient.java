package com.weav.workflow.infrastructure.sheets;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Bounded client for the fixed Google Sheets values API endpoints. */
@Component
public class GoogleSheetsClient {

    private static final String BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets/";
    private static final int MAX_PATH_PARAMETER_LENGTH = 8 * 1024;
    private static final int MAX_TARGET_URI_LENGTH = 8 * 1024;
    private static final int MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
    private static final Set<String> ACCESS_TOKEN_FIELDS = Set.of("accessToken");

    private final PinnedHttpTransport transport;

    public GoogleSheetsClient(PinnedHttpTransport transport) {
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
    }

    public Map<String, Object> read(
            String spreadsheetId, String range, ResolvedConnection connection) {
        URI target = valuesUri(spreadsheetId, range, "");
        String accessToken = accessToken(connection);
        PinnedHttpTransport.HttpResponse response = transport.executeGoogleSheetsWithBearerToken(
                target, "GET", null, null, accessToken);
        return successfulObject(response);
    }

    public Map<String, Object> append(
            String spreadsheetId,
            String range,
            List<List<Object>> values,
            ResolvedConnection connection) {
        URI target = valuesUri(spreadsheetId, range, ":append");
        Map<String, Object> body = valueRange(range, values);
        String accessToken = accessToken(connection);
        PinnedHttpTransport.HttpResponse response = transport.executeGoogleSheetsWithBearerToken(
                target, "POST", Map.of("valueInputOption", "RAW"), body, accessToken);
        return successfulObject(response);
    }

    public Map<String, Object> update(
            String spreadsheetId,
            String range,
            List<List<Object>> values,
            ResolvedConnection connection) {
        URI target = valuesUri(spreadsheetId, range, "");
        Map<String, Object> body = valueRange(range, values);
        String accessToken = accessToken(connection);
        PinnedHttpTransport.HttpResponse response = transport.executeGoogleSheetsWithBearerToken(
                target, "PUT", Map.of("valueInputOption", "RAW"), body, accessToken);
        return successfulObject(response);
    }

    private Map<String, Object> valueRange(String range, List<List<Object>> values) {
        if (values == null) {
            throw configurationFailure();
        }
        List<List<Object>> jsonRows = new ArrayList<>(values.size());
        for (List<?> row : values) {
            if (row == null) {
                throw configurationFailure();
            }
            List<Object> jsonCells = new ArrayList<>(row.size());
            for (Object cell : row) {
                if (!isJsonCell(cell)) {
                    throw configurationFailure();
                }
                jsonCells.add(cell);
            }
            jsonRows.add(java.util.Collections.unmodifiableList(jsonCells));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("range", range);
        body.put("majorDimension", "ROWS");
        body.put("values", jsonRows);
        return body;
    }

    private boolean isJsonCell(Object cell) {
        if (cell == null || cell instanceof String || cell instanceof Boolean) {
            return true;
        }
        if (cell instanceof Byte || cell instanceof Short || cell instanceof Integer || cell instanceof Long
                || cell instanceof java.math.BigInteger || cell instanceof java.math.BigDecimal) {
            return true;
        }
        if (cell instanceof Float value) {
            return Float.isFinite(value);
        }
        return cell instanceof Double value && Double.isFinite(value);
    }

    private URI valuesUri(String spreadsheetId, String range, String suffix) {
        String encodedId = encodePathSegment(spreadsheetId);
        String encodedRange = encodePathSegment(range);
        String uri = BASE_URL + encodedId + "/values/" + encodedRange + suffix;
        if (uri.length() > MAX_TARGET_URI_LENGTH) {
            throw configurationFailure();
        }
        try {
            return URI.create(uri);
        } catch (IllegalArgumentException exception) {
            throw configurationFailure();
        }
    }

    private String encodePathSegment(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_PATH_PARAMETER_LENGTH
                || value.equals(".") || value.equals("..")
                || value.codePoints().anyMatch(codePoint -> Character.isISOControl(codePoint)
                || codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            throw configurationFailure();
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        StringBuilder encoded = new StringBuilder(bytes.length);
        for (byte byteValue : bytes) {
            int current = Byte.toUnsignedInt(byteValue);
            if (isUnreserved(current)) {
                encoded.append((char) current);
            } else {
                encoded.append('%');
                encoded.append(Character.toUpperCase(Character.forDigit(current >>> 4, 16)));
                encoded.append(Character.toUpperCase(Character.forDigit(current & 0x0f, 16)));
            }
        }
        return encoded.toString();
    }

    private boolean isUnreserved(int value) {
        return value >= 'A' && value <= 'Z'
                || value >= 'a' && value <= 'z'
                || value >= '0' && value <= '9'
                || value == '-' || value == '_' || value == '.' || value == '~';
    }

    private String accessToken(ResolvedConnection connection) {
        try {
            if (connection == null
                    || !"GOOGLE_SHEETS".equals(connection.provider())
                    || !"OAUTH2".equals(connection.authType())) {
                throw connectionConfigurationFailure();
            }
            Map<String, String> auth = connection.auth();
            if (!auth.keySet().equals(ACCESS_TOKEN_FIELDS)) {
                throw connectionConfigurationFailure();
            }
            String token = auth.get("accessToken");
            if (token == null || token.isBlank() || token.length() > MAX_ACCESS_TOKEN_LENGTH
                    || token.codePoints().anyMatch(Character::isISOControl)) {
                throw connectionConfigurationFailure();
            }
            return token;
        } catch (NodeExecutor.Failure failure) {
            throw failure;
        } catch (RuntimeException exception) {
            throw connectionConfigurationFailure();
        }
    }

    private Map<String, Object> successfulObject(PinnedHttpTransport.HttpResponse response) {
        if (response == null) {
            throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                    "The Google Sheets provider returned an invalid response.", true);
        }
        int status = response.status();
        if (status >= 200 && status < 300) {
            if (!(response.data() instanceof Map<?, ?> map)) {
                throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                        "The Google Sheets provider returned an invalid response.", true);
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key)) {
                    throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                            "The Google Sheets provider returned an invalid response.", true);
                }
                result.put(key, entry.getValue());
            }
            return result;
        }
        if (status == 401) {
            throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                    "The Google Sheets provider rejected the configured credentials.", false);
        }
        if (status == 429) {
            throw new NodeExecutor.Failure("HTTP_RATE_LIMITED",
                    "The Google Sheets provider rate limited the request.", true);
        }
        if (status == 408 || status >= 500) {
            throw new NodeExecutor.Failure("HTTP_DEPENDENCY_UNAVAILABLE",
                    "The Google Sheets provider is temporarily unavailable.", true);
        }
        if (status >= 300 && status < 400) {
            throw new NodeExecutor.Failure("HTTP_REDIRECT_REJECTED",
                    "The Google Sheets provider returned a redirect that is not followed.", false);
        }
        if (status >= 400 && status < 500) {
            throw new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                    "The Google Sheets provider rejected the request.", false);
        }
        throw new NodeExecutor.Failure("HTTP_INVALID_RESPONSE",
                "The Google Sheets provider returned an invalid response.", true);
    }

    private NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR",
                "The Google Sheets node configuration is invalid.", false);
    }

    private NodeExecutor.Failure connectionConfigurationFailure() {
        return new NodeExecutor.Failure("CONNECTION_CONFIGURATION_INVALID",
                "The Google Sheets connection configuration is invalid.", false);
    }
}
