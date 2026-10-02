package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.WorkflowPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** WF-15: schedule failure bookkeeping uses the injected clock, not the wall clock. */
class WorkflowTriggerAdapterClockTest {
    private static final Instant FIXED = Instant.parse("2031-01-02T03:04:05Z");

    @SuppressWarnings("unchecked")
    @Test
    void recordScheduleFailureStampsTheInjectedClock() {
        UUID workflowId = UUID.randomUUID();
        WorkflowTriggerJpaEntity hint = mock(WorkflowTriggerJpaEntity.class);
        when(hint.getType()).thenReturn(TriggerType.SCHEDULE);
        when(hint.getWorkflowId()).thenReturn(workflowId);
        WorkflowTrigger domain = WorkflowTrigger.createNew(workflowId, UUID.randomUUID(), "schedule",
                TriggerType.SCHEDULE, Map.of());

        EntityManager entityManager = mock(EntityManager.class);
        when(entityManager.find(eq(WorkflowTriggerJpaEntity.class), any())).thenReturn(hint);
        TypedQuery<WorkflowJpaEntity> workflowQuery = mock(TypedQuery.class, Answers.RETURNS_SELF);
        when(workflowQuery.getResultList()).thenReturn(List.of(mock(WorkflowJpaEntity.class)));
        when(entityManager.createQuery(anyString(), eq(WorkflowJpaEntity.class))).thenReturn(workflowQuery);
        TypedQuery<WorkflowTriggerJpaEntity> triggerQuery = mock(TypedQuery.class, Answers.RETURNS_SELF);
        when(triggerQuery.getResultList()).thenReturn(List.of(hint));
        when(entityManager.createQuery(anyString(), eq(WorkflowTriggerJpaEntity.class))).thenReturn(triggerQuery);
        WorkflowPersistenceMapper mapper = mock(WorkflowPersistenceMapper.class);
        when(mapper.toDomain(hint)).thenReturn(domain);

        WorkflowTriggerAdapter adapter = new WorkflowTriggerAdapter(mapper, "workflow",
                Clock.fixed(FIXED, ZoneOffset.UTC));
        ReflectionTestUtils.setField(adapter, "entityManager", entityManager);

        adapter.recordScheduleFailure(UUID.randomUUID(), FIXED.plusSeconds(30));

        assertEquals(FIXED, domain.getUpdatedAt());
    }
}
