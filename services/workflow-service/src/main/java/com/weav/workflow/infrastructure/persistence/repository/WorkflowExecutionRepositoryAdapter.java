package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.infrastructure.definition.DefinitionJsonCodec;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.OutboxEventJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowExecutionJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersionJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.ExecutionPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** PostgreSQL-backed execution snapshots and atomic admission/outbox writes. */
@Repository
public class WorkflowExecutionRepositoryAdapter implements WorkflowExecutionRepository, ExecutionAdmissionPort {

    private static final String EXECUTION_AGGREGATE = "WORKFLOW_EXECUTION";
    private static final String EXECUTION_REQUESTED = "EXECUTION_REQUESTED";

    @PersistenceContext
    private EntityManager entityManager;

    private final ExecutionPersistenceMapper mapper;
    private final DefinitionJsonCodec definitionCodec;

    public WorkflowExecutionRepositoryAdapter(ExecutionPersistenceMapper mapper, ObjectMapper objectMapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        this.definitionCodec = new DefinitionJsonCodec(Objects.requireNonNull(objectMapper,
                "objectMapper must not be null"));
    }

    @Override
    @Transactional
    public WorkflowExecution save(WorkflowExecution execution) {
        Objects.requireNonNull(execution, "execution must not be null");
        WorkflowExecutionJpaEntity entity = mapper.toEntity(execution);
        if (entityManager.find(WorkflowExecutionJpaEntity.class, execution.getId()) == null) {
            entityManager.persist(entity);
        } else {
            entityManager.merge(entity);
        }
        return execution;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<WorkflowExecution> findById(UUID id) {
        Objects.requireNonNull(id, "id must not be null");
        WorkflowExecutionJpaEntity entity = entityManager.find(WorkflowExecutionJpaEntity.class, id);
        return Optional.ofNullable(entity).map(mapper::toDomain);
    }

    @Override
    @Transactional
    public Admission create(Command command) {
        Objects.requireNonNull(command, "command must not be null");
        if (command.triggerId() == null) {
            return createManual(command);
        }
        return createAutomatic(command);
    }

    private Admission createManual(Command command) {
        if (command.triggerType() != ExecutionTriggerType.MANUAL || command.workflowId() == null
                || command.workspaceId() == null || command.actorId() == null) {
            throw new BadRequestException("Manual execution context is invalid");
        }
        WorkflowJpaEntity workflow = lockWorkflow(command.workspaceId(), command.workflowId());
        requirePublished(workflow);
        WorkflowVersionJpaEntity version = currentVersion(workflow);
        WorkflowDefinition definition = definition(version);
        String rootNodeId = definition.nodes().stream()
                .filter(Objects::nonNull)
                .filter(node -> "trigger.manual".equals(node.type()))
                .map(WorkflowDefinition.Node::id)
                .filter(Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new InvalidStateException("The published workflow has no manual trigger"));
        return persistAdmission(workflow, version, command, ExecutionTriggerType.MANUAL,
                null, rootNodeId, null, definition);
    }

    private Admission createAutomatic(Command command) {
        WorkflowTriggerJpaEntity hint = entityManager.find(WorkflowTriggerJpaEntity.class, command.triggerId());
        if (hint == null) {
            throw new ResourceNotFoundException("Workflow trigger not found");
        }

        // All admission paths acquire the workflow row before the trigger registration row.
        WorkflowJpaEntity workflow = lockWorkflow(hint.getWorkflowId());
        WorkflowTriggerJpaEntity registration = lockTrigger(command.triggerId(), workflow.getId());
        requirePublished(workflow);
        if (registration.getStatus() != TriggerStatus.ACTIVE) {
            throw new InvalidStateException("The workflow trigger is not active");
        }
        if (!workflow.getCurrentVersionId().equals(registration.getWorkflowVersionId())) {
            throw new InvalidStateException("The workflow trigger does not belong to the current version");
        }

        TriggerType storedType = registration.getType();
        ExecutionTriggerType triggerType = executionType(storedType);
        if (command.triggerType() != null && command.triggerType() != triggerType) {
            throw new BadRequestException("Automatic trigger type is derived from its registration");
        }
        if (storedType == TriggerType.SCHEDULE && command.scheduledAt() == null
                || storedType != TriggerType.SCHEDULE && command.scheduledAt() != null) {
            throw new BadRequestException("Scheduled time must match the trigger registration type");
        }

        WorkflowVersionJpaEntity version = currentVersion(workflow);
        WorkflowDefinition definition = definition(version);
        WorkflowDefinition.Node root = definition.nodes().stream()
                .filter(Objects::nonNull)
                .filter(node -> registration.getTriggerNodeId().equals(node.id()))
                .findFirst()
                .orElseThrow(() -> new InvalidStateException("The registered trigger root is missing"));
        if (!expectedNodeType(storedType).equals(root.type())) {
            throw new InvalidStateException("The registered trigger root does not match its type");
        }

        if (storedType == TriggerType.SCHEDULE) {
            Optional<WorkflowExecutionJpaEntity> existing = scheduledExecution(
                    registration.getId(), command.scheduledAt());
            if (existing.isPresent()) {
                WorkflowExecutionJpaEntity execution = existing.get();
                return new Admission(execution.getId(), execution.getWorkflowId(),
                        execution.getWorkflowVersionId(), execution.getStatus());
            }
        }
        return persistAdmission(workflow, version, command, triggerType, registration.getId(),
                registration.getTriggerNodeId(), command.scheduledAt(), definition);
    }

    private Admission persistAdmission(WorkflowJpaEntity workflow, WorkflowVersionJpaEntity version,
                                      Command command, ExecutionTriggerType triggerType, UUID triggerId,
                                      String rootNodeId, Instant scheduledAt,
                                      WorkflowDefinition definition) {
        if (rootNodeId == null || rootNodeId.isBlank()) {
            throw new InvalidStateException("The published workflow execution root is invalid");
        }
        WorkflowExecution execution = WorkflowExecution.queue(workflow.getId(), version.getId(), triggerType,
                triggerId, command.actorId(), rootNodeId, command.input(), command.correlationId(),
                command.traceparent(), scheduledAt, unknownEdges(definition));
        Map<String, Object> payload = Map.of("executionId", execution.getId().toString());
        OutboxEvent outbox = OutboxEvent.pending(EXECUTION_AGGREGATE, execution.getId(),
                EXECUTION_REQUESTED, payload);

        entityManager.persist(mapper.toEntity(execution));
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null || node.id() == null || node.type() == null) {
                throw new InvalidStateException("The published workflow contains an invalid execution node");
            }
            entityManager.persist(new NodeExecutionJpaEntity(UUID.randomUUID(), execution.getId(), node.id(),
                    node.type(), NodeExecutionStatus.PENDING, null, null, null, 0,
                    null, null, null, null));
        }
        entityManager.persist(mapper.toEntity(outbox));
        entityManager.flush();
        return new Admission(execution.getId(), execution.getWorkflowId(), execution.getWorkflowVersionId(),
                ExecutionStatus.QUEUED);
    }

    private Map<String, String> unknownEdges(WorkflowDefinition definition) {
        Map<String, String> states = new LinkedHashMap<>();
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge != null && edge.id() != null) {
                states.put(edge.id(), "UNKNOWN");
            }
        }
        return states;
    }

    private WorkflowJpaEntity lockWorkflow(UUID workspaceId, UUID workflowId) {
        List<WorkflowJpaEntity> workflows = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.workspaceId = :workspaceId and workflow.id = :workflowId "
                                + "and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (workflows.isEmpty()) {
            throw new ResourceNotFoundException("Workflow not found");
        }
        WorkflowJpaEntity locked = workflows.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return locked;
    }

    private WorkflowJpaEntity lockWorkflow(UUID workflowId) {
        List<WorkflowJpaEntity> workflows = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.id = :workflowId and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (workflows.isEmpty()) {
            throw new ResourceNotFoundException("Workflow not found");
        }
        WorkflowJpaEntity locked = workflows.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return locked;
    }

    private WorkflowTriggerJpaEntity lockTrigger(UUID triggerId, UUID workflowId) {
        List<WorkflowTriggerJpaEntity> registrations = entityManager.createQuery(
                        "select trigger from WorkflowTriggerJpaEntity trigger "
                                + "where trigger.id = :triggerId and trigger.workflowId = :workflowId",
                        WorkflowTriggerJpaEntity.class)
                .setParameter("triggerId", triggerId)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (registrations.isEmpty()) {
            throw new ResourceNotFoundException("Workflow trigger not found");
        }
        WorkflowTriggerJpaEntity locked = registrations.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return locked;
    }

    private WorkflowVersionJpaEntity currentVersion(WorkflowJpaEntity workflow) {
        UUID currentVersionId = workflow.getCurrentVersionId();
        if (currentVersionId == null) {
            throw new InvalidStateException("A workflow requires a published version before it can run");
        }
        WorkflowVersionJpaEntity version = entityManager.find(WorkflowVersionJpaEntity.class, currentVersionId);
        if (version == null || !workflow.getId().equals(version.getWorkflowId())) {
            throw new InvalidStateException("The current workflow version is invalid");
        }
        return version;
    }

    private void requirePublished(WorkflowJpaEntity workflow) {
        if (workflow.getDeletedAt() != null || workflow.getStatus() != WorkflowStatus.PUBLISHED
                || workflow.getCurrentVersionId() == null) {
            throw new InvalidStateException("Only a published, active workflow can be run");
        }
    }

    private WorkflowDefinition definition(WorkflowVersionJpaEntity version) {
        try {
            return definitionCodec.decode(version.getDefinition());
        } catch (IllegalArgumentException exception) {
            throw new InvalidStateException("The current published workflow definition is invalid");
        }
    }

    private Optional<WorkflowExecutionJpaEntity> scheduledExecution(UUID triggerId, Instant scheduledAt) {
        return entityManager.createQuery(
                        "select execution from WorkflowExecutionJpaEntity execution "
                                + "where execution.triggerId = :triggerId and execution.scheduledAt = :scheduledAt",
                        WorkflowExecutionJpaEntity.class)
                .setParameter("triggerId", triggerId)
                .setParameter("scheduledAt", scheduledAt)
                .setMaxResults(1)
                .getResultList()
                .stream()
                .findFirst();
    }

    private ExecutionTriggerType executionType(TriggerType type) {
        return switch (type) {
            case SCHEDULE -> ExecutionTriggerType.SCHEDULE;
            case WEBHOOK -> ExecutionTriggerType.WEBHOOK;
            case TELEGRAM -> ExecutionTriggerType.TELEGRAM;
        };
    }

    private String expectedNodeType(TriggerType type) {
        return "trigger." + type.name().toLowerCase(Locale.ROOT);
    }
}
