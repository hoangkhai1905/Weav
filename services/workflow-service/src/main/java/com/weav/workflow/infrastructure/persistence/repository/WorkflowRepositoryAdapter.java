package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.WorkflowPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Repository
public class WorkflowRepositoryAdapter implements WorkflowRepository {

    private static final String WORKSPACE_QUERY = "select workflow from WorkflowJpaEntity workflow "
            + "where workflow.workspaceId = :workspaceId and workflow.deletedAt is null";

    @PersistenceContext
    private EntityManager entityManager;

    private final WorkflowPersistenceMapper mapper;

    public WorkflowRepositoryAdapter(WorkflowPersistenceMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
    }

    @Override
    @Transactional
    public Workflow save(Workflow workflow) {
        Objects.requireNonNull(workflow, "workflow must not be null");
        WorkflowJpaEntity persisted = entityManager.find(WorkflowJpaEntity.class, workflow.getId());
        if (persisted == null) {
            entityManager.persist(mapper.toEntity(workflow));
            return workflow;
        }
        if (!persisted.getWorkspaceId().equals(workflow.getWorkspaceId())
                || !persisted.getCreatedBy().equals(workflow.getCreatedBy())) {
            throw new IllegalArgumentException("Workflow identity cannot be reassigned");
        }
        mapper.updateEntity(persisted, workflow);
        return workflow;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Workflow> findById(UUID id) {
        Objects.requireNonNull(id, "id must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.id = :workflowId and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workflowId", id)
                .setMaxResults(1)
                .getResultList();
        return matches.stream().findFirst().map(mapper::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Workflow> findByWorkspaceAndId(UUID workspaceId, UUID workflowId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        WORKSPACE_QUERY + " and workflow.id = :workflowId", WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("workflowId", workflowId)
                .setMaxResults(1)
                .getResultList();
        return matches.stream().findFirst().map(mapper::toDomain);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Workflow> findPage(UUID workspaceId, int page, int size) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        int offset = checkedOffset(page, size);
        return entityManager.createQuery(
                        WORKSPACE_QUERY + " order by workflow.createdAt desc, workflow.id desc",
                        WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setFirstResult(offset)
                .setMaxResults(size)
                .getResultList()
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public long countByWorkspace(UUID workspaceId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        return entityManager.createQuery(
                        "select count(workflow) from WorkflowJpaEntity workflow "
                                + "where workflow.workspaceId = :workspaceId and workflow.deletedAt is null",
                        Long.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();
    }

    @Override
    @Transactional
    public Optional<Workflow> lockByWorkspaceAndId(UUID workspaceId, UUID workflowId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        WORKSPACE_QUERY + " and workflow.id = :workflowId", WorkflowJpaEntity.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (matches.isEmpty()) {
            return Optional.empty();
        }
        WorkflowJpaEntity locked = matches.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return Optional.of(mapper.toDomain(locked));
    }

    @Override
    @Transactional
    public Optional<Workflow> lockById(UUID workflowId) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        List<WorkflowJpaEntity> matches = entityManager.createQuery(
                        "select workflow from WorkflowJpaEntity workflow "
                                + "where workflow.id = :workflowId and workflow.deletedAt is null",
                        WorkflowJpaEntity.class)
                .setParameter("workflowId", workflowId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        if (matches.isEmpty()) {
            return Optional.empty();
        }
        WorkflowJpaEntity locked = matches.getFirst();
        entityManager.refresh(locked, LockModeType.PESSIMISTIC_WRITE);
        return Optional.of(mapper.toDomain(locked));
    }

    private int checkedOffset(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException("Workflow page bounds are invalid");
        }
        long offset = (long) page * size;
        if (offset > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Workflow page offset is out of range");
        }
        return (int) offset;
    }
}
