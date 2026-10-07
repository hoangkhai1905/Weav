package com.weav.workflow.domain.definition;

import com.weav.workflow.domain.mapping.MappingException;
import com.weav.workflow.domain.mapping.MappingResolver;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Pure Java structural, configuration, and publish-graph validation. */
public final class DefinitionValidator {
    public static final int MAX_DEFINITION_BYTES = 1_048_576;
    public static final int MAX_NODES = 200;
    public static final int MAX_EDGES = 1_000;
    public static final int MAX_JSON_DEPTH = WorkflowDefinition.MAX_JSON_DEPTH;

    private static final Set<String> CONDITION_OPERATORS = enumValues("logic.condition", "operator");
    private static final Set<String> CONDITION_PORTS = Set.of("true", "false");
    private static final String DEFAULT_PORT = "default";
    private static final int MAX_PORT_LENGTH = 64;
    private static final int MAX_SWITCH_CASES = 20;
    private static final int MAX_DATA_SET_FIELDS = 100;
    private static final int MAX_DATA_SET_KEY_LENGTH = 128;
    private static final Set<String> SHEETS_OPERATIONS = enumValues("google.sheets", "operation");
    private static final Set<String> CONDITION_COMBINATORS = enumValues("logic.condition", "combinator");
    private static final int MAX_CONDITIONS = 10;
    private static final Set<String> CONDITION_ITEM_FIELDS = Set.of("left", "operator", "right");
    private static final java.util.regex.Pattern SHEETS_COLUMN = java.util.regex.Pattern.compile("[A-Za-z]{1,3}");
    /** New enum fields whose literal values are checked on draft save; mappings resolve at run time. */
    private static final Map<String, Set<String>> LITERAL_ENUMS = Map.of(
            "telegram.send_message.parseMode", enumValues("telegram.send_message", "parseMode"),
            "google.sheets.valueInputOption", enumValues("google.sheets", "valueInputOption"),
            "google.calendar.operation", enumValues("google.calendar", "operation"));
    private static final Set<String> HTTP_METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS");

    private final ScheduleValidation scheduleValidation;
    private final MappingResolver mappingResolver = new MappingResolver();

    /** Creates a validator that fails closed when a complete schedule must be validated. */
    public DefinitionValidator() {
        this(null);
    }

    /**
     * Creates a validator with an infrastructure-supplied schedule boundary.
     * The domain deliberately has no dependency on Spring's cron classes.
     */
    public DefinitionValidator(ScheduleValidation scheduleValidation) {
        this.scheduleValidation = scheduleValidation;
    }

    public List<ValidationIssue> validateDraft(WorkflowDefinition definition) {
        return validate(definition, false);
    }

    /** Rejects provider credentials in UI-only state without interpreting its shape. */
    public List<ValidationIssue> validateEditorState(Map<String, Object> editorState) {
        if (editorState == null || editorState.isEmpty()) {
            return List.of();
        }
        List<ValidationIssue> issues = new ArrayList<>();
        validateCredentialKeys(null, "editorState", editorState, issues);
        return List.copyOf(issues);
    }

    public List<ValidationIssue> validatePublish(WorkflowDefinition definition) {
        return validate(definition, true);
    }

    private List<ValidationIssue> validate(WorkflowDefinition definition, boolean publish) {
        List<ValidationIssue> issues = new ArrayList<>();
        if (definition == null) {
            add(issues, null, "definition", "INVALID_DEFINITION", "A workflow definition is required.");
            return List.copyOf(issues);
        }

        if (serializedSize(definition) > MAX_DEFINITION_BYTES) {
            add(issues, null, "definition", "DEFINITION_TOO_LARGE", "The definition exceeds the supported size.");
        }
        if (!"1.0".equals(definition.schemaVersion())) {
            add(issues, null, "schemaVersion", "INVALID_SCHEMA_VERSION", "The definition schema version is not supported.");
        }
        if (definition.nodes().size() > MAX_NODES) {
            add(issues, null, "nodes", "TOO_MANY_NODES", "The definition exceeds the supported node count.");
        }
        if (definition.edges().size() > MAX_EDGES) {
            add(issues, null, "edges", "TOO_MANY_EDGES", "The definition exceeds the supported edge count.");
        }

        Map<String, WorkflowDefinition.Node> nodesById = new LinkedHashMap<>();
        Set<String> nodeIds = new HashSet<>();
        int manualTriggers = 0;
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                add(issues, null, "nodes", "INVALID_NODE", "Each node must be an object.");
                continue;
            }
            validateId(node.id(), node.id(), "id", "INVALID_NODE_ID", issues);
            if (node.id() != null && !nodeIds.add(node.id())) {
                add(issues, node.id(), "id", "DUPLICATE_NODE_ID", "Node identifiers must be unique.");
            } else if (isPresent(node.id())) {
                nodesById.putIfAbsent(node.id(), node);
            }

            if (!isPresent(node.type())) {
                add(issues, node.id(), "type", "INVALID_NODE_TYPE", "A node type is required.");
            } else if (!NodeCatalog.supports(node.type())) {
                add(issues, node.id(), "type", "UNKNOWN_NODE_TYPE", "The node type is not supported.");
            } else {
                validateNodeConfiguration(node, publish, issues);
                if ("trigger.manual".equals(node.type())) {
                    manualTriggers++;
                }
            }
            validateCredentialKeys(node.id(), "config", withoutStaticFields(node), issues);
        }
        validateCredentialKeys(null, "variables", definition.variables(), issues);

        Set<String> edgeIds = new HashSet<>();
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null) {
                add(issues, null, "edges", "INVALID_EDGE", "Each edge must be an object.");
                continue;
            }
            validateId(edge.id(), null, "edges.id", "INVALID_EDGE_ID", issues);
            if (edge.id() != null && !edgeIds.add(edge.id())) {
                add(issues, null, "edges.id", "DUPLICATE_EDGE_ID", "Edge identifiers must be unique.");
            }
            validateId(edge.source(), null, "edges.source", "INVALID_EDGE_SOURCE", issues);
            validateId(edge.target(), null, "edges.target", "INVALID_EDGE_TARGET", issues);
            if (edge.sourcePort() != null
                    && (edge.sourcePort().isBlank() || edge.sourcePort().length() > MAX_PORT_LENGTH)) {
                add(issues, null, "edges.sourcePort", "INVALID_SOURCE_PORT",
                        "A source port must be non-blank and at most 64 characters.");
            }
        }

        if (publish) {
            validatePublishGraph(definition, nodesById, manualTriggers, issues);
            validateMappings(definition, nodesById, issues);
        }
        return List.copyOf(issues);
    }

    private void validateNodeConfiguration(
            WorkflowDefinition.Node node, boolean publish, List<ValidationIssue> issues) {
        Map<String, Object> config = node.config();
        NodeConfigSchema schema = NodeCatalog.schema(node.type());
        Set<String> allowedFields = schema.fieldNames();
        for (String field : config.keySet()) {
            if (!allowedFields.contains(field)) {
                add(issues, node.id(), "config", "UNKNOWN_CONFIG_FIELD", "The configuration contains an unsupported field.");
            }
        }

        for (Map.Entry<String, Object> entry : config.entrySet()) {
            if (!allowedFields.contains(entry.getKey())) {
                continue;
            }
            String field = entry.getKey();
            Object value = entry.getValue();
            if (!hasValidFieldShape(schema.properties().get(field), value)) {
                add(issues, node.id(), "config." + field, "INVALID_FIELD_TYPE", "The configuration field has an invalid shape.");
                continue;
            }
            validateCatalogEnum(node, field, value, issues);
            if ("connectionId".equals(field) && !isLiteralUuid(value)) {
                add(issues, node.id(), "config.connectionId", "INVALID_CONNECTION_ID",
                        "A connection reference must be a literal UUID.");
            }
        }

        if ("logic.condition".equals(node.type())) {
            validateConditionForm(node, publish, issues);
        }

        if ("ocr.extract".equals(node.type())
                && config.containsKey("artifactId") && config.containsKey("fileUrl")) {
            add(issues, node.id(), "config", "OCR_SOURCE_CONFLICT", "Only one OCR source may be configured.");
        }

        if (!publish) {
            validateUrlUserInfo(node, issues);
            return;
        }

        for (String field : schema.required()) {
            if (!config.containsKey(field)) {
                add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                        "A required configuration field is missing.");
            } else if (schema.properties().get(field).violatesMinimumContent(config.get(field))) {
                add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                        "A required configuration field must not be empty.");
            }
        }

        if ("google.sheets".equals(node.type())) {
            Object operation = config.get("operation");
            if (operation instanceof String op && SHEETS_OPERATIONS.contains(op)) {
                if ("lookup".equals(op)) {
                    validateSheetsLookup(node, issues);
                } else if (!"read".equals(op) && !config.containsKey("values")) {
                    add(issues, node.id(), "config.values", "REQUIRED_FIELD_MISSING",
                            "Write operations require values.");
                }
            }
        }
        if ("google.calendar".equals(node.type()) && isCalendarCreate(config.get("operation"))) {
            for (String field : List.of("summary", "start", "end")) {
                if (!config.containsKey(field)) {
                    add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                            "A required configuration field is missing.");
                } else if (schema.properties().get(field).violatesMinimumContent(config.get(field))) {
                    add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                            "A required configuration field must not be empty.");
                }
            }
        }
        if ("ocr.extract".equals(node.type())) {
            boolean hasNonblankSource = config.get("artifactId") instanceof String artifactId && !artifactId.isBlank()
                    || config.get("fileUrl") instanceof String fileUrl && !fileUrl.isBlank();
            if (!hasNonblankSource) {
                add(issues, node.id(), "config", "OCR_SOURCE_REQUIRED",
                        "Exactly one non-empty OCR source must be configured.");
            }
        }
        validatePublishFieldValues(node, issues);
        validateUrlUserInfo(node, issues);

        if ("trigger.schedule".equals(node.type())
                && config.get("cron") instanceof String cron
                && config.get("timezone") instanceof String timezone
                && !cron.isBlank() && !timezone.isBlank()) {
            if (scheduleValidation == null) {
                add(issues, node.id(), "config.cron", "SCHEDULE_VALIDATION_UNAVAILABLE",
                        "Schedule validation is unavailable.");
            } else {
                List<ValidationIssue> scheduleIssues = scheduleValidation.validate(node.id(), cron, timezone);
                if (scheduleIssues != null) {
                    issues.addAll(scheduleIssues);
                }
            }
        }
    }

    private void validatePublishFieldValues(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        Map<String, Object> config = node.config();
        if ("http.request".equals(node.type())) {
            Object method = config.get("method");
            if (method instanceof String text && !containsMappingDelimiter(text)
                    && !HTTP_METHODS.contains(text.toUpperCase(Locale.ROOT))) {
                add(issues, node.id(), "config.method", "INVALID_HTTP_METHOD", "The HTTP method is not supported.");
            }
            validateAbsoluteHttpUrl(node, issues);
        }
        if ("logic.switch".equals(node.type())) {
            validateSwitchCases(node, issues);
        }
        if ("data.set".equals(node.type())) {
            validateDataSetFields(node, issues);
        }
        if ("logic.condition".equals(node.type())) {
            Object operator = config.get("operator");
            if (operator instanceof String text && Set.of("gt", "gte", "lt", "lte").contains(text)) {
                validateOrderingOperand(node, "left", issues);
                validateOrderingOperand(node, "right", issues);
            }
        }
    }

    private static boolean isCalendarCreate(Object operation) {
        // Absent or blank keeps the pre-"list" behaviour; a mapping resolves at run time and the executor decides.
        return operation == null || operation instanceof String text && (text.isBlank() || "create".equals(text));
    }

    private static void validateSheetsLookup(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        Map<String, Object> config = node.config();
        for (String field : List.of("lookupColumn", "lookupValue")) {
            if (config.get(field) == null) {
                add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                        "Lookup requires a column and a value.");
            }
        }
        if (config.get("lookupColumn") instanceof String column && !containsMappingDelimiter(column)
                && !SHEETS_COLUMN.matcher(column).matches()) {
            add(issues, node.id(), "config.lookupColumn", "INVALID_LOOKUP_COLUMN",
                    "The lookup column must be a column letter such as B.");
        }
    }

    /**
     * Single form {left, operator, right} versus multi form {combinator, conditions}: never both. Structure
     * and bounds are checked on draft save; completeness of each condition only on publish.
     */
    private static void validateConditionForm(
            WorkflowDefinition.Node node, boolean publish, List<ValidationIssue> issues) {
        Map<String, Object> config = node.config();
        boolean multi = config.containsKey("conditions") || config.containsKey("combinator");
        boolean single = config.containsKey("left") || config.containsKey("operator") || config.containsKey("right");
        if (multi && single) {
            add(issues, node.id(), "config", "CONDITION_FORM_CONFLICT",
                    "Use either left/operator/right or combinator/conditions, not both.");
            return;
        }
        if (!multi) {
            if (publish) {
                for (String field : List.of("left", "operator", "right")) {
                    if (!config.containsKey(field)) {
                        add(issues, node.id(), "config." + field, "REQUIRED_FIELD_MISSING",
                                "A required configuration field is missing.");
                    }
                }
            }
            return;
        }
        if (config.get("combinator") instanceof String combinator && !CONDITION_COMBINATORS.contains(combinator)) {
            add(issues, node.id(), "config.combinator", "INVALID_CONDITION_COMBINATOR",
                    "The combinator must be and or or.");
        }
        if (publish && !config.containsKey("combinator")) {
            add(issues, node.id(), "config.combinator", "REQUIRED_FIELD_MISSING",
                    "A required configuration field is missing.");
        }
        if (!(config.get("conditions") instanceof List<?> conditions)) {
            if (publish) {
                add(issues, node.id(), "config.conditions", "REQUIRED_FIELD_MISSING",
                        "A required configuration field is missing.");
            }
            return;
        }
        if (conditions.size() > MAX_CONDITIONS || publish && conditions.isEmpty()) {
            add(issues, node.id(), "config.conditions", "INVALID_CONDITIONS",
                    "A condition node needs 1 to 10 conditions.");
        }
        for (int index = 0; index < conditions.size(); index++) {
            String path = "config.conditions[" + index + "]";
            if (!(conditions.get(index) instanceof Map<?, ?> item)
                    || !item.keySet().stream().allMatch(CONDITION_ITEM_FIELDS::contains)) {
                add(issues, node.id(), path, "INVALID_CONDITIONS",
                        "Each condition is an object with left, operator and right.");
                continue;
            }
            Object operator = item.get("operator");
            if (operator != null && !(operator instanceof String)) {
                add(issues, node.id(), path + ".operator", "INVALID_FIELD_TYPE",
                        "The configuration field has an invalid shape.");
            } else if (operator instanceof String text && !containsMappingDelimiter(text)
                    && !CONDITION_OPERATORS.contains(text)) {
                add(issues, node.id(), path + ".operator", "INVALID_CONDITION_OPERATOR",
                        "The condition operator is not supported.");
            }
            if (!publish) {
                continue;
            }
            for (String field : CONDITION_ITEM_FIELDS) {
                if (!item.containsKey(field)) {
                    add(issues, node.id(), path + "." + field, "REQUIRED_FIELD_MISSING",
                            "A required configuration field is missing.");
                }
            }
            if (operator instanceof String text && Set.of("gt", "gte", "lt", "lte").contains(text)) {
                for (String field : List.of("left", "right")) {
                    Object value = item.get(field);
                    boolean mapped = value instanceof String string && containsMappingDelimiter(string);
                    if (item.containsKey(field) && !mapped && !(value instanceof Number)) {
                        add(issues, node.id(), path + "." + field, "NUMERIC_OPERAND_REQUIRED",
                                "Ordering conditions require numeric operands.");
                    }
                }
            }
        }
    }

    /** Literal case strings of a switch; non-string items are ignored (the shape check reports them). */
    private static List<String> switchCases(WorkflowDefinition.Node node) {
        return node.config().get("cases") instanceof List<?> list
                ? list.stream().filter(String.class::isInstance).map(String.class::cast).toList() : List.of();
    }

    private static void validateSwitchCases(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        if (!(node.config().get("cases") instanceof List<?> cases) || cases.isEmpty()) {
            return; // missing or empty is REQUIRED_FIELD_MISSING (required + minItems)
        }
        Set<String> seen = new HashSet<>();
        String problem = cases.size() > MAX_SWITCH_CASES ? "A switch supports at most 20 cases." : null;
        for (Object item : cases) {
            if (problem != null || !(item instanceof String text)) {
                break;
            }
            if (text.isBlank() || text.length() > MAX_PORT_LENGTH) {
                problem = "Each case must be non-blank and at most 64 characters.";
            } else if (DEFAULT_PORT.equals(text)) {
                problem = "The case name default is reserved.";
            } else if (containsMappingDelimiter(text)) {
                problem = "Cases must be literal text, not mappings.";
            } else if (!seen.add(text)) {
                problem = "Cases must be unique.";
            }
        }
        if (problem != null) {
            add(issues, node.id(), "config.cases", "INVALID_SWITCH_CASES", problem);
        }
    }

    private static void validateDataSetFields(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        if (!(node.config().get("fields") instanceof Map<?, ?> fields)) {
            return; // missing is REQUIRED_FIELD_MISSING; a mapping string resolves at run time
        }
        boolean badKey = fields.keySet().stream().anyMatch(key ->
                !(key instanceof String text) || text.isBlank() || text.length() > MAX_DATA_SET_KEY_LENGTH);
        if (fields.isEmpty() || fields.size() > MAX_DATA_SET_FIELDS || badKey) {
            add(issues, node.id(), "config.fields", "INVALID_DATA_SET_FIELDS",
                    "Set data needs 1 to 100 fields, each named with 1 to 128 non-blank characters.");
        }
    }

    private static void validateCatalogEnum(
            WorkflowDefinition.Node node, String field, Object value, List<ValidationIssue> issues) {
        if (!(value instanceof String text) || containsMappingDelimiter(text)) {
            return;
        }
        if ("google.sheets".equals(node.type()) && "operation".equals(field)
                && !SHEETS_OPERATIONS.contains(text)) {
            add(issues, node.id(), "config.operation", "INVALID_SHEETS_OPERATION",
                    "The Sheets operation is not supported.");
        } else if ("logic.condition".equals(node.type()) && "operator".equals(field)
                && !CONDITION_OPERATORS.contains(text)) {
            add(issues, node.id(), "config.operator", "INVALID_CONDITION_OPERATOR",
                    "The condition operator is not supported.");
        } else if (LITERAL_ENUMS.containsKey(node.type() + "." + field) && !text.isBlank()
                && !LITERAL_ENUMS.get(node.type() + "." + field).contains(text)) {
            add(issues, node.id(), "config." + field, "INVALID_ENUM_VALUE", "The value is not supported.");
        } else if (!text.isBlank() && !validLiteralString(node.type() + "." + field, text)) {
            add(issues, node.id(), "config." + field, "INVALID_FIELD_TYPE",
                    "The configuration field has an invalid shape.");
        }
    }

    /** Upper bounds of the numeric fields that also accept text (null: no upper bound). */
    private static final Map<String, Integer> TEXT_NUMBER_MAX = Map.of(
            "google.sheets.limit", 100, "google.calendar.maxResults", 50, "telegram.send_message.replyToMessageId", 0);

    /** Literal (non-mapping) text in a numeric or boolean field must say a valid number or true/false. */
    private static boolean validLiteralString(String key, String text) {
        if ("telegram.send_message.disableNotification".equals(key)) {
            return text.equals("true") || text.equals("false");
        }
        if (!TEXT_NUMBER_MAX.containsKey(key)) {
            return true;
        }
        int max = TEXT_NUMBER_MAX.get(key);
        try {
            java.math.BigDecimal number = new java.math.BigDecimal(text.trim());
            return number.stripTrailingZeros().scale() <= 0 && number.signum() > 0
                    && (max == 0 || number.compareTo(java.math.BigDecimal.valueOf(max)) <= 0);
        } catch (NumberFormatException exception) {
            return false;
        }
    }

    private static void validateOrderingOperand(
            WorkflowDefinition.Node node, String field, List<ValidationIssue> issues) {
        Object value = node.config().get(field);
        if (value instanceof String text && containsMappingDelimiter(text)) {
            return; // Task 3 owns mapping parsing and resolves the type after the reference is known.
        }
        if (!(value instanceof Number)) {
            add(issues, node.id(), "config." + field, "NUMERIC_OPERAND_REQUIRED",
                    "Ordering conditions require numeric operands.");
        }
    }

    private void validateUrlUserInfo(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        String field = switch (node.type()) {
            case "http.request" -> "url";
            case "ocr.extract" -> "fileUrl";
            default -> null;
        };
        if (field == null) {
            return;
        }
        Object value = node.config().get(field);
        if (!(value instanceof String url) || url.isBlank()) {
            return;
        }
        if (!hasUrlUserInfo(url)) {
            return;
        }
        add(issues, node.id(), "config." + field, "URL_USERINFO_NOT_ALLOWED",
                "Credentials must not be embedded in a URL.");
    }

    private static boolean hasUrlUserInfo(String url) {
        try {
            if (new URI(url).getRawUserInfo() != null) {
                return true;
            }
        } catch (URISyntaxException ignored) {
            // An unfinished mapping can make URI parsing fail; inspect a literal authority below.
        }
        int schemeEnd = url.indexOf("://");
        if (schemeEnd < 0) {
            return false;
        }
        int authorityStart = schemeEnd + 3;
        int authorityEnd = url.length();
        for (char delimiter : new char[] {'/', '?', '#'}) {
            int delimiterIndex = url.indexOf(delimiter, authorityStart);
            if (delimiterIndex >= 0 && delimiterIndex < authorityEnd) {
                authorityEnd = delimiterIndex;
            }
        }
        return url.substring(authorityStart, authorityEnd).lastIndexOf('@') >= 0;
    }

    private void validateAbsoluteHttpUrl(WorkflowDefinition.Node node, List<ValidationIssue> issues) {
        Object value = node.config().get("url");
        if (!(value instanceof String url) || containsMappingDelimiter(url)) {
            return;
        }
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            if (!uri.isAbsolute() || scheme == null
                    || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || uri.getHost() == null) {
                add(issues, node.id(), "config.url", "INVALID_URL", "The request URL must be an absolute HTTP URL.");
            }
        } catch (URISyntaxException ignored) {
            add(issues, node.id(), "config.url", "INVALID_URL", "The request URL must be a valid HTTP URL.");
        }
    }

    private static boolean hasValidFieldShape(NodeConfigSchema.Field schema, Object value) {
        if (schema.isStatic()) {
            return OutputSchemaPolicy.isValid(value);
        }
        if (schema.template() && value instanceof String text && containsMappingDelimiter(text)) {
            // Mapping grammar and resolved types are checked at publish/runtime respectively.
            return true;
        }
        return schema.matchesShape(value);
    }

    private static Set<String> enumValues(String type, String field) {
        return NodeCatalog.schema(type).properties().get(field).enumValues();
    }

    private static boolean isLiteralUuid(Object value) {
        if (!(value instanceof String text) || text.length() != 36) {
            return false;
        }
        try {
            return java.util.UUID.fromString(text).toString().equalsIgnoreCase(text);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private void validatePublishGraph(
            WorkflowDefinition definition,
            Map<String, WorkflowDefinition.Node> nodesById,
            int manualTriggers,
            List<ValidationIssue> issues) {
        if (manualTriggers == 0) {
            add(issues, null, "nodes", "MANUAL_TRIGGER_REQUIRED", "A published definition requires one manual trigger.");
        } else if (manualTriggers > 1) {
            add(issues, null, "nodes", "MULTIPLE_MANUAL_TRIGGERS", "A published definition permits one manual trigger.");
        }

        Map<String, List<String>> outgoing = new HashMap<>();
        Map<String, Integer> indegree = new HashMap<>();
        nodesById.keySet().forEach(id -> {
            outgoing.put(id, new ArrayList<>());
            indegree.put(id, 0);
        });
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null) {
                continue;
            }
            WorkflowDefinition.Node source = nodesById.get(edge.source());
            WorkflowDefinition.Node target = nodesById.get(edge.target());
            if (source == null || target == null) {
                add(issues, null, "edges", "DANGLING_EDGE", "Every edge must reference existing nodes.");
                continue;
            }
            if (target.type() != null && target.type().startsWith("trigger.")) {
                add(issues, target.id(), "edges", "TRIGGER_HAS_INCOMING_EDGE", "Trigger nodes cannot have incoming edges.");
            }

            if ("logic.switch".equals(source.type())) {
                if (edge.sourcePort() == null || !DEFAULT_PORT.equals(edge.sourcePort())
                        && !switchCases(source).contains(edge.sourcePort())) {
                    add(issues, source.id(), "edges.sourcePort", "INVALID_SOURCE_PORT",
                            "A switch edge must use one of its cases or the default port.");
                }
            } else {
                boolean validPort = "logic.condition".equals(source.type())
                        ? edge.sourcePort() != null && CONDITION_PORTS.contains(edge.sourcePort())
                        : edge.sourcePort() == null;
                if (!validPort) {
                    add(issues, source.id(), "edges.sourcePort", "INVALID_SOURCE_PORT",
                            "Only condition nodes may use true or false output ports.");
                }
            }
            outgoing.get(source.id()).add(target.id());
            indegree.compute(target.id(), (ignored, degree) -> degree + 1);
        }

        Deque<String> ready = new ArrayDeque<>();
        indegree.forEach((id, degree) -> {
            if (degree == 0) {
                ready.addLast(id);
            }
        });
        int visited = 0;
        while (!ready.isEmpty()) {
            String current = ready.removeFirst();
            visited++;
            for (String next : outgoing.get(current)) {
                int remaining = indegree.compute(next, (ignored, degree) -> degree - 1);
                if (remaining == 0) {
                    ready.addLast(next);
                }
            }
        }
        if (visited < nodesById.size()) {
            add(issues, null, "edges", "CYCLE_DETECTED", "The workflow graph must be acyclic.");
        }

        Set<String> reachable = new LinkedHashSet<>();
        Deque<String> pending = new ArrayDeque<>();
        for (WorkflowDefinition.Node node : nodesById.values()) {
            if (node.type() != null && node.type().startsWith("trigger.")) {
                if (reachable.add(node.id())) {
                    pending.addLast(node.id());
                }
            }
        }
        while (!pending.isEmpty()) {
            for (String next : outgoing.get(pending.removeFirst())) {
                if (reachable.add(next)) {
                    pending.addLast(next);
                }
            }
        }
        for (WorkflowDefinition.Node node : nodesById.values()) {
            if (node.type() != null && !node.type().startsWith("trigger.") && !reachable.contains(node.id())) {
                add(issues, node.id(), "edges", "UNREACHABLE_NODE", "Every action must be reachable from a trigger.");
            }
        }
    }

    private void validateMappings(
            WorkflowDefinition definition,
            Map<String, WorkflowDefinition.Node> nodesById,
            List<ValidationIssue> issues) {
        Set<String> nodeIds = new LinkedHashSet<>(nodesById.keySet());
        Map<String, Set<String>> downstream = downstreamNodes(definition.edges(), nodeIds);
        for (WorkflowDefinition.Node node : nodesById.values()) {
            if (!NodeCatalog.supports(node.type())) {
                continue;
            }
            for (Map.Entry<String, Object> field : node.config().entrySet()) {
                if (!NodeCatalog.configFields(node.type()).contains(field.getKey())) {
                    continue;
                }
                if (NodeCatalog.staticFields(node.type()).contains(field.getKey())) {
                    continue;
                }
                String fieldPath = "config." + field.getKey();
                Set<String> referencedNodes;
                try {
                    referencedNodes = mappingResolver.references(field.getValue(), nodeIds);
                } catch (MappingException exception) {
                    add(issues, node.id(), fieldPath, MappingException.CODE, exception.getMessage());
                    continue;
                }
                for (String referencedNode : referencedNodes) {
                    if (!nodesById.containsKey(referencedNode)) {
                        add(issues, node.id(), fieldPath, MappingException.CODE,
                                "The referenced node does not exist.");
                    } else if (referencedNode.equals(node.id())
                            || !downstream.getOrDefault(referencedNode, Set.of()).contains(node.id())) {
                        add(issues, node.id(), fieldPath, MappingException.CODE,
                                "The referenced node must be an upstream ancestor.");
                    }
                }
            }
        }
    }

    private static Map<String, Set<String>> downstreamNodes(
            List<WorkflowDefinition.Edge> edges, Set<String> nodeIds) {
        Map<String, Set<String>> outgoing = new HashMap<>();
        nodeIds.forEach(id -> outgoing.put(id, new LinkedHashSet<>()));
        for (WorkflowDefinition.Edge edge : edges) {
            if (edge != null && nodeIds.contains(edge.source()) && nodeIds.contains(edge.target())) {
                outgoing.get(edge.source()).add(edge.target());
            }
        }

        Map<String, Set<String>> downstream = new HashMap<>();
        for (String source : nodeIds) {
            Set<String> reached = new LinkedHashSet<>();
            Deque<String> pending = new ArrayDeque<>(outgoing.get(source));
            while (!pending.isEmpty()) {
                String next = pending.removeFirst();
                if (reached.add(next)) {
                    pending.addAll(outgoing.get(next));
                }
            }
            downstream.put(source, Set.copyOf(reached));
        }
        return downstream;
    }

    private static void validateId(
            String value, String nodeId, String field, String code, List<ValidationIssue> issues) {
        if (!isPresent(value)) {
            add(issues, nodeId, field, code, "An identifier is required.");
        }
    }

    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }

    private static void validateCredentialKeys(
            String nodeId, String baseField, Object value, List<ValidationIssue> issues) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() instanceof String key && isCredentialField(key)) {
                    add(issues, nodeId, baseField, "CREDENTIAL_FIELD_NOT_ALLOWED",
                            "Credentials must be referenced through a Workspace connection.");
                }

                validateCredentialKeys(nodeId, baseField, entry.getValue(), issues);
            }
        } else if (value instanceof List<?> list) {
            list.forEach(item -> validateCredentialKeys(nodeId, baseField, item, issues));
        }
    }

    private static Map<String, Object> withoutStaticFields(WorkflowDefinition.Node node) {
        Set<String> staticFields = NodeCatalog.staticFields(node.type());
        if (staticFields.isEmpty() || node.config() == null) {
            return node.config();
        }
        Map<String, Object> copy = new LinkedHashMap<>(node.config());
        staticFields.forEach(copy::remove);
        return copy;
    }

    private static boolean isCredentialField(String fieldName) {
        String normalized = fieldName.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return normalized.contains("authorization")
                || normalized.equals("auth")
                || normalized.endsWith("auth")
                || normalized.contains("basicauth")
                || normalized.contains("cookie")
                || normalized.contains("token")
                || normalized.contains("bearer")
                || normalized.contains("password")
                || normalized.contains("passwd")
                || normalized.contains("secret")
                || normalized.contains("credential")
                || normalized.contains("apikey")
                || normalized.contains("accesskey")
                || normalized.contains("privatekey")
                || normalized.contains("signingkey");
    }

    private static boolean containsMappingDelimiter(String value) {
        return value.contains("{{") || value.contains("}}");
    }

    private static long serializedSize(WorkflowDefinition definition) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", definition.schemaVersion());
        List<Object> nodes = new ArrayList<>(definition.nodes().size());
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                nodes.add(null);
                continue;
            }
            Map<String, Object> serializedNode = new LinkedHashMap<>();
            serializedNode.put("id", node.id());
            serializedNode.put("type", node.type());
            serializedNode.put("config", node.config());
            nodes.add(serializedNode);
        }
        root.put("nodes", nodes);
        List<Object> edges = new ArrayList<>(definition.edges().size());
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null) {
                edges.add(null);
                continue;
            }
            Map<String, Object> serializedEdge = new LinkedHashMap<>();
            serializedEdge.put("id", edge.id());
            serializedEdge.put("source", edge.source());
            serializedEdge.put("target", edge.target());
            serializedEdge.put("sourcePort", edge.sourcePort());
            edges.add(serializedEdge);
        }
        root.put("edges", edges);
        root.put("variables", definition.variables());
        return jsonSize(root);
    }

    static long jsonSize(Object value) {
        if (value == null) {
            return 4;
        }
        if (value instanceof String text) {
            return jsonStringSize(text);
        }
        if (value instanceof Boolean bool) {
            return bool ? 4 : 5;
        }
        if (value instanceof Number number) {
            return number.toString().getBytes(StandardCharsets.UTF_8).length;
        }
        if (value instanceof List<?> list) {
            long size = 2;
            for (int index = 0; index < list.size(); index++) {
                if (index > 0) {
                    size++;
                }
                size += jsonSize(list.get(index));
            }
            return size;
        }
        if (value instanceof Map<?, ?> map) {
            long size = 2;
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    size++;
                }
                first = false;
                size += jsonStringSize((String) entry.getKey()) + 1 + jsonSize(entry.getValue());
            }
            return size;
        }
        return Long.MAX_VALUE;
    }

    private static long jsonStringSize(String value) {
        long size = 2;
        for (int offset = 0; offset < value.length();) {
            int codePoint = value.codePointAt(offset);
            if (codePoint == '"' || codePoint == '\\' || codePoint == '\b' || codePoint == '\f'
                    || codePoint == '\n' || codePoint == '\r' || codePoint == '\t') {
                size += 2;
            } else if (codePoint < 0x20 || codePoint >= 0xd800 && codePoint <= 0xdfff) {
                size += 6;
            } else if (codePoint <= 0x7f) {
                size++;
            } else if (codePoint <= 0x7ff) {
                size += 2;
            } else if (codePoint <= 0xffff) {
                size += 3;
            } else {
                size += 4;
            }
            offset += Character.charCount(codePoint);
        }
        return size;
    }

    private static void add(
            List<ValidationIssue> issues, String nodeId, String field, String code, String message) {
        issues.add(new ValidationIssue(nodeId, field, code, message));
    }

    @FunctionalInterface
    public interface ScheduleValidation {
        List<ValidationIssue> validate(String nodeId, String cron, String timezone);
    }
}
