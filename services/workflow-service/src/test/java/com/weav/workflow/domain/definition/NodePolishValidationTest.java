package com.weav.workflow.domain.definition;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Week 4 node polish: Sheets lookup, Calendar list, Telegram options and multi-condition. */
class NodePolishValidationTest {
    private static final String CONNECTION = UUID.randomUUID().toString();
    private final DefinitionValidator validator = new DefinitionValidator();

    private static Map<String, Object> cond(Object left, String operator, Object right) {
        Map<String, Object> condition = new LinkedHashMap<>();
        condition.put("left", left);
        condition.put("operator", operator);
        condition.put("right", right);
        return condition;
    }

    private static Map<String, Object> multi(String combinator, Object... conditions) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("combinator", combinator);
        config.put("conditions", List.of(conditions));
        return config;
    }

    private List<String> codes(String type, Map<String, Object> config, boolean publish) {
        WorkflowDefinition graph = new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                        new WorkflowDefinition.Node("n", type, config)),
                List.of(new WorkflowDefinition.Edge("e", "manual", "n", null)), Map.of());
        return (publish ? validator.validatePublish(graph) : validator.validateDraft(graph)).stream()
                .map(issue -> issue.code() + "@" + issue.field()).toList();
    }

    // ---- logic.condition

    @Test
    void singleConditionFormIsUnchangedInDraftAndPublish() {
        Map<String, Object> single = cond(1, "eq", 1);
        assertEquals(List.of(), codes("logic.condition", single, false));
        assertEquals(List.of(), codes("logic.condition", single, true));
        // Same publish errors as before for missing fields, bad operator and non-numeric ordering operands.
        assertEquals(List.of("REQUIRED_FIELD_MISSING@config.left", "REQUIRED_FIELD_MISSING@config.operator",
                "REQUIRED_FIELD_MISSING@config.right"), codes("logic.condition", Map.of(), true));
        assertEquals(List.of(), codes("logic.condition", Map.of(), false));
        assertTrue(codes("logic.condition", Map.of("operator", "run-code"), false)
                .contains("INVALID_CONDITION_OPERATOR@config.operator"));
        assertTrue(codes("logic.condition", cond("text", "gt", 1), true)
                .contains("NUMERIC_OPERAND_REQUIRED@config.left"));
        assertEquals(List.of(), codes("logic.condition", cond("{{ trigger.input.a }}", "{{ trigger.input.op }}", 1), true));
    }

    @Test
    void multiConditionFormValidatesWithOneToTenConditions() {
        assertEquals(List.of(), codes("logic.condition", multi("and", cond(1, "eq", 1)), false));
        assertEquals(List.of(), codes("logic.condition", multi("or", cond(1, "eq", 1), cond("a", "ne", "b")), true));
        assertEquals(List.of(), codes("logic.condition", multi("and", cond("{{ trigger.input.n }}", "gte", 3),
                cond("{{ trigger.input.s }}", "{{ trigger.input.op }}", "x")), true));
        Object[] ten = java.util.Collections.nCopies(10, cond(1, "eq", 1)).toArray();
        assertEquals(List.of(), codes("logic.condition", multi("and", ten), true));
    }

    @Test
    void multiConditionBoundsAndShapeAreEnforced() {
        Object[] eleven = java.util.Collections.nCopies(11, cond(1, "eq", 1)).toArray();
        assertTrue(codes("logic.condition", multi("and", eleven), false).contains("INVALID_CONDITIONS@config.conditions"));
        assertTrue(codes("logic.condition", multi("and"), true).contains("INVALID_CONDITIONS@config.conditions"));
        assertTrue(codes("logic.condition", multi("xor", cond(1, "eq", 1)), false)
                .contains("INVALID_CONDITION_COMBINATOR@config.combinator"));
        assertTrue(codes("logic.condition", multi("and", cond(1, "run-code", 1)), false)
                .contains("INVALID_CONDITION_OPERATOR@config.conditions[0].operator"));
        assertTrue(codes("logic.condition", multi("and", "text"), false)
                .contains("INVALID_CONDITIONS@config.conditions[0]"));
        Map<String, Object> extra = cond(1, "eq", 1);
        extra.put("note", "x");
        assertTrue(codes("logic.condition", multi("and", extra), false).contains("INVALID_CONDITIONS@config.conditions[0]"));
        assertTrue(codes("logic.condition", Map.of("combinator", "and", "conditions", "nope"), false)
                .contains("INVALID_FIELD_TYPE@config.conditions"));
    }

    @Test
    void multiConditionPublishNeedsCombinatorConditionsAndCompleteItems() {
        assertTrue(codes("logic.condition", Map.of("conditions", List.of(cond(1, "eq", 1))), true)
                .contains("REQUIRED_FIELD_MISSING@config.combinator"));
        assertTrue(codes("logic.condition", Map.of("combinator", "and"), true)
                .contains("REQUIRED_FIELD_MISSING@config.conditions"));
        Map<String, Object> noRight = cond(1, "eq", 1);
        noRight.remove("right");
        assertTrue(codes("logic.condition", multi("or", noRight), true)
                .contains("REQUIRED_FIELD_MISSING@config.conditions[0].right"));
        assertTrue(codes("logic.condition", multi("or", cond("text", "lt", 1)), true)
                .contains("NUMERIC_OPERAND_REQUIRED@config.conditions[0].left"));
        // Drafts stay editable while incomplete.
        assertEquals(List.of(), codes("logic.condition", Map.of("combinator", "and"), false));
    }

    @Test
    void mixingTheTwoFormsIsRejected() {
        for (String key : List.of("left", "operator", "right")) {
            Map<String, Object> mixed = new LinkedHashMap<>(multi("and", cond(1, "eq", 1)));
            mixed.put(key, key.equals("operator") ? "eq" : 1);
            assertTrue(codes("logic.condition", mixed, false).contains("CONDITION_FORM_CONFLICT@config"), key);
            assertTrue(codes("logic.condition", mixed, true).contains("CONDITION_FORM_CONFLICT@config"), key);
        }
        Map<String, Object> combinatorWithSingle = new LinkedHashMap<>(cond(1, "eq", 1));
        combinatorWithSingle.put("combinator", "and");
        assertTrue(codes("logic.condition", combinatorWithSingle, false).contains("CONDITION_FORM_CONFLICT@config"));
    }

    @Test
    void conditionNodeStillEmitsOnlyTrueAndFalsePortsAndMappingsInsideItemsAreChecked() {
        WorkflowDefinition graph = new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node("manual", "trigger.manual", Map.of()),
                        new WorkflowDefinition.Node("c", "logic.condition",
                                multi("and", cond("{{ ghost.output.x }}", "eq", 1))),
                        new WorkflowDefinition.Node("t", "data.set", Map.of("fields", Map.of("a", 1)))),
                List.of(new WorkflowDefinition.Edge("e1", "manual", "c", null),
                        new WorkflowDefinition.Edge("e2", "c", "t", "true")), Map.of());
        List<String> codes = validator.validatePublish(graph).stream().map(ValidationIssue::field).toList();
        assertEquals(List.of("config.conditions"), codes, "an unknown referenced node is reported on the field");
    }

    // ---- google.sheets

    private static Map<String, Object> sheets(String operation) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION);
        config.put("operation", operation);
        config.put("spreadsheetId", "sheet");
        config.put("range", "Sheet1!A1:C");
        return config;
    }

    @Test
    void sheetsLookupNeedsAColumnLetterAndValueButNoValues() {
        Map<String, Object> lookup = sheets("lookup");
        lookup.put("lookupColumn", "B");
        lookup.put("lookupValue", 7);
        lookup.put("limit", 100);
        assertEquals(List.of(), codes("google.sheets", lookup, false));
        assertEquals(List.of(), codes("google.sheets", lookup, true));

        List<String> missing = codes("google.sheets", sheets("lookup"), true);
        assertTrue(missing.contains("REQUIRED_FIELD_MISSING@config.lookupColumn"));
        assertTrue(missing.contains("REQUIRED_FIELD_MISSING@config.lookupValue"));
        assertFalse(missing.contains("REQUIRED_FIELD_MISSING@config.values"));

        Map<String, Object> badColumn = new LinkedHashMap<>(lookup);
        badColumn.put("lookupColumn", "Name");
        assertTrue(codes("google.sheets", badColumn, true).contains("INVALID_LOOKUP_COLUMN@config.lookupColumn"));
        badColumn.put("lookupColumn", "{{ trigger.input.col }}");
        assertEquals(List.of(), codes("google.sheets", badColumn, true));

        for (Object limit : List.of(0, 101, 1.5d, true)) {
            Map<String, Object> bad = new LinkedHashMap<>(lookup);
            bad.put("limit", limit);
            assertTrue(codes("google.sheets", bad, false).contains("INVALID_FIELD_TYPE@config.limit"), String.valueOf(limit));
        }
    }

    @Test
    void sheetsWriteAndReadRulesAreUnchangedAndValueInputOptionIsChecked() {
        assertEquals(List.of(), codes("google.sheets", sheets("read"), true));
        assertTrue(codes("google.sheets", sheets("append"), true).contains("REQUIRED_FIELD_MISSING@config.values"));
        Map<String, Object> append = sheets("append");
        append.put("values", List.of(List.of("a")));
        assertEquals(List.of(), codes("google.sheets", append, true));
        for (String option : List.of("RAW", "USER_ENTERED", "{{ trigger.input.o }}")) {
            append.put("valueInputOption", option);
            assertEquals(List.of(), codes("google.sheets", append, true), option);
        }
        append.put("valueInputOption", "FORMULA");
        assertTrue(codes("google.sheets", append, false).contains("INVALID_ENUM_VALUE@config.valueInputOption"));
        assertTrue(codes("google.sheets", sheets("delete"), false).contains("INVALID_SHEETS_OPERATION@config.operation"));
    }

    // ---- google.calendar

    private static Map<String, Object> calendarCreate() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION);
        config.put("summary", "Planning");
        config.put("start", "2026-10-05T09:00:00+07:00");
        config.put("end", "2026-10-05T10:00:00+07:00");
        return config;
    }

    @Test
    void calendarCreateWithoutOperationKeepsItsRequiredFields() {
        assertEquals(List.of(), codes("google.calendar", calendarCreate(), true));
        for (String field : List.of("summary", "start", "end")) {
            Map<String, Object> missing = calendarCreate();
            missing.remove(field);
            assertTrue(codes("google.calendar", missing, true).contains("REQUIRED_FIELD_MISSING@config." + field), field);
            assertEquals(List.of(), codes("google.calendar", missing, false), "drafts stay editable");
            Map<String, Object> blank = calendarCreate();
            blank.put(field, "  ");
            assertTrue(codes("google.calendar", blank, true).contains("REQUIRED_FIELD_MISSING@config." + field), field);
        }
        Map<String, Object> explicit = calendarCreate();
        explicit.put("operation", "create");
        assertEquals(List.of(), codes("google.calendar", explicit, true));
        explicit.remove("summary");
        assertTrue(codes("google.calendar", explicit, true).contains("REQUIRED_FIELD_MISSING@config.summary"));
        assertTrue(codes("google.calendar", Map.of(), true).contains("REQUIRED_FIELD_MISSING@config.connectionId"));
    }

    @Test
    void calendarListNeedsOnlyAConnectionAndChecksItsBounds() {
        Map<String, Object> list = new LinkedHashMap<>();
        list.put("connectionId", CONNECTION);
        list.put("operation", "list");
        assertEquals(List.of(), codes("google.calendar", list, true));
        list.put("maxResults", 50);
        list.put("timeMin", "2026-10-06T00:00:00+07:00");
        list.put("query", "standup");
        assertEquals(List.of(), codes("google.calendar", list, true));
        for (Object bad : List.of(0, 51, 2.5d)) {
            list.put("maxResults", bad);
            assertTrue(codes("google.calendar", list, false).contains("INVALID_FIELD_TYPE@config.maxResults"),
                    String.valueOf(bad));
        }
        list.put("operation", "delete");
        assertTrue(codes("google.calendar", list, false).contains("INVALID_ENUM_VALUE@config.operation"));
        list.put("operation", "{{ trigger.input.op }}");
        list.remove("maxResults");
        assertEquals(List.of(), codes("google.calendar", list, false));
    }

    @Test
    void blankEnumsCountAsUnsetAndLiteralTextInNumericFieldsIsChecked() {
        Map<String, Object> tg = new LinkedHashMap<>();
        tg.put("connectionId", CONNECTION);
        tg.put("chatId", "1");
        tg.put("text", "t");
        tg.put("parseMode", " ");
        assertEquals(List.of(), codes("telegram.send_message", tg, true));
        Map<String, Object> sheets = sheets("append");
        sheets.put("values", List.of(List.of("a")));
        sheets.put("valueInputOption", "");
        assertEquals(List.of(), codes("google.sheets", sheets, true));
        Map<String, Object> cal = calendarCreate();
        cal.put("operation", "");
        assertEquals(List.of(), codes("google.calendar", cal, true));

        for (String ok : List.of("5", " 7 ", "{{ trigger.input.n }}", "")) {
            tg.put("parseMode", "none");
            tg.put("replyToMessageId", ok);
            assertEquals(List.of(), codes("telegram.send_message", tg, false), ok);
        }
        for (String bad : List.of("abc", "0", "-2", "1.5")) {
            tg.put("replyToMessageId", bad);
            assertTrue(codes("telegram.send_message", tg, false).contains("INVALID_FIELD_TYPE@config.replyToMessageId"), bad);
        }
        tg.remove("replyToMessageId");
        for (String flag : List.of("true", "false", "", "{{ trigger.input.f }}")) {
            tg.put("disableNotification", flag);
            assertEquals(List.of(), codes("telegram.send_message", tg, false), flag);
        }
        tg.put("disableNotification", "yes");
        assertTrue(codes("telegram.send_message", tg, false).contains("INVALID_FIELD_TYPE@config.disableNotification"));

        Map<String, Object> lookup = sheets("lookup");
        lookup.put("lookupColumn", "A");
        lookup.put("lookupValue", "x");
        lookup.put("limit", "101");
        assertTrue(codes("google.sheets", lookup, false).contains("INVALID_FIELD_TYPE@config.limit"));
        lookup.put("limit", "100");
        assertEquals(List.of(), codes("google.sheets", lookup, false));
        Map<String, Object> list = new LinkedHashMap<>();
        list.put("connectionId", CONNECTION);
        list.put("operation", "list");
        list.put("maxResults", "51");
        assertTrue(codes("google.calendar", list, false).contains("INVALID_FIELD_TYPE@config.maxResults"));
        list.put("maxResults", "50");
        assertEquals(List.of(), codes("google.calendar", list, false));
    }

    // ---- telegram.send_message

    @Test
    void telegramOptionsValidateAndOldConfigsStayValid() {
        Map<String, Object> old = new LinkedHashMap<>();
        old.put("connectionId", CONNECTION);
        old.put("chatId", "555");
        old.put("text", "hello");
        assertEquals(List.of(), codes("telegram.send_message", old, true));

        Map<String, Object> full = new LinkedHashMap<>(old);
        full.put("parseMode", "HTML");
        full.put("disableNotification", true);
        full.put("replyToMessageId", 12);
        assertEquals(List.of(), codes("telegram.send_message", full, true));
        full.put("disableNotification", "{{ trigger.input.silent }}");
        full.put("replyToMessageId", "{{ trigger.input.messageId }}");
        full.put("parseMode", "{{ trigger.input.mode }}");
        assertEquals(List.of(), codes("telegram.send_message", full, true));

        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, Object> entry : Map.<String, Object>of(
                "parseMode", "Markdown", "replyToMessageId", 0).entrySet()) {
            Map<String, Object> config = new LinkedHashMap<>(old);
            config.put(entry.getKey(), entry.getValue());
            bad.addAll(codes("telegram.send_message", config, false));
        }
        assertTrue(bad.contains("INVALID_ENUM_VALUE@config.parseMode"), bad::toString);
        assertTrue(bad.contains("INVALID_FIELD_TYPE@config.replyToMessageId"), bad::toString);
    }
}
