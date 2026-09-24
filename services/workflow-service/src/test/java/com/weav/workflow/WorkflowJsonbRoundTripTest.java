package com.weav.workflow;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkflowJsonbRoundTripTest {
    @Autowired
    private EntityManager entityManager;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @Transactional
    void postgresJsonbRoundTripPreservesNestedNullInFrozenDomainSnapshot() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID createdBy = UUID.randomUUID();
        var nested = new LinkedHashMap<String, Object>();
        nested.put("value", null);
        var values = new ArrayList<Object>();
        values.add("before");
        values.add(null);
        var definition = new LinkedHashMap<String, Object>();
        definition.put("nested", nested);
        definition.put("values", values);

        Workflow workflow = new Workflow(UUID.randomUUID(), workspaceId, "JSONB round trip", null,
                WorkflowStatus.DRAFT, "1.0", definition, Map.of(), null, createdBy,
                Instant.parse("2026-09-21T00:00:00Z"), Instant.parse("2026-09-21T00:00:00Z"),
                null, null, null);
        nested.put("value", "changed");
        values.set(0, "changed");
        values.add("extra");

        // Persist the domain snapshot through the existing JSONB entity.
        JsonNode definitionJson = objectMapper.valueToTree(workflow.getDraftDefinition());
        WorkflowJpaEntity entity = new WorkflowJpaEntity(
                workspaceId, workflow.getName(), workflow.getSchemaVersion(), definitionJson, createdBy);
        entityManager.persist(entity);
        UUID workflowId = entity.getId();
        entityManager.flush();
        entityManager.clear();

        WorkflowJpaEntity persisted = entityManager.find(WorkflowJpaEntity.class, workflowId);
        assertNotNull(persisted);
        JsonNode persistedDefinition = persisted.getDraftDefinition();
        assertTrue(persistedDefinition.path("nested").has("value"));
        assertTrue(persistedDefinition.path("nested").path("value").isNull());
        assertEquals(objectMapper.valueToTree("before"), persistedDefinition.path("values").get(0));
        assertTrue(persistedDefinition.path("values").get(1).isNull());
        assertEquals(2, persistedDefinition.path("values").size());
    }
}
