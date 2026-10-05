package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** A NUL (literal or as an entity) in one email must not make Postgres JSONB reject the run input. */
@SpringBootTest(properties = {
        "weav.workflow.gmail.poller.enabled=false",
        "weav.workflow.schedule.scanner.enabled=false"})
@Import(WorkflowPublicationTestConfiguration.class)
class GmailAdmissionPersistenceTest {

    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");

    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publication;
    @Autowired
    private ExecutionAdmissionService admissions;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void aMailWithNulAndControlCharactersPersistsThroughAdmission() {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = workflows.save(Workflow.createDraft(workspaceId, "Mail", "d", USER_ID));
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(
                Map.of("id", "manual", "type", "trigger.manual", "config", Map.of()),
                Map.of("id", "gmail", "type", "trigger.gmail", "config",
                        Map.of("connectionId", UUID.randomUUID().toString())))));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        workflow.updateDraft(workflow.getName(), workflow.getDescription(), definition, Map.of());
        workflows.save(workflow);
        publication.publish(workspaceId, workflow.getId(), USER_ID);
        UUID triggerId = jdbc.queryForObject("select id from workflow.workflow_triggers where workflow_id = ? "
                + "and type = 'GMAIL'", UUID.class, workflow.getId());

        String nul = String.valueOf((char) 0);
        String data = Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("body" + nul + "x &#0; end").getBytes(StandardCharsets.UTF_8));
        Map<String, Object> raw = Map.of("id", "abc123", "internalDate", Long.toString(Instant.now().toEpochMilli()),
                "snippet", "s" + nul, "payload", Map.of("mimeType", "text/plain", "filename", "",
                        "headers", List.of(Map.of("name", "Subject", "value", "Hi" + nul)),
                        "body", Map.of("data", data)));
        var parsed = GmailMessageParser.parse(raw).orElseThrow();

        admissions.automatic(triggerId, parsed.input(), null, null, null, "gmail:" + triggerId + ":abc123");

        assertEquals(1, jdbc.queryForObject("select count(*) from workflow.workflow_executions where trigger_id = ?",
                Integer.class, triggerId));
        assertTrue(jdbc.queryForObject("select input::text from workflow.workflow_executions where trigger_id = ?",
                String.class, triggerId).contains("bodyx &#0; end"));
    }
}
