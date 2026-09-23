package com.weav.workflow.infrastructure.persistence.repository;

import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersionJpaEntity;
import com.weav.workflow.infrastructure.persistence.mapper.WorkflowPersistenceMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;
import java.util.UUID;

/** JPA adapter for immutable version snapshots. */
@Repository
public class WorkflowVersionAdapter implements WorkflowVersionPort {

    @PersistenceContext
    private EntityManager entityManager;

    private final WorkflowPersistenceMapper mapper;

    public WorkflowVersionAdapter(WorkflowPersistenceMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
    }

    @Override
    @Transactional
    public int nextNumber(UUID workflowId) {
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Integer currentMaximum = entityManager.createQuery(
                        "select max(version.versionNumber) from WorkflowVersionJpaEntity version "
                                + "where version.workflowId = :workflowId",
                        Integer.class)
                .setParameter("workflowId", workflowId)
                .getSingleResult();
        return currentMaximum == null ? 1 : Math.addExact(currentMaximum, 1);
    }

    @Override
    @Transactional
    public void insert(WorkflowVersion version) {
        Objects.requireNonNull(version, "version must not be null");
        entityManager.persist(mapper.toEntity(version));
        // ConnectionReferenceAdapter uses JdbcTemplate on this datasource and must see the version FK.
        entityManager.flush();
    }

    @Override
    @Transactional(readOnly = true)
    public WorkflowVersion require(UUID versionId) {
        Objects.requireNonNull(versionId, "versionId must not be null");
        WorkflowVersionJpaEntity entity = entityManager.find(WorkflowVersionJpaEntity.class, versionId);
        if (entity == null) {
            throw new ResourceNotFoundException("Workflow version not found");
        }
        return mapper.toDomain(entity);
    }
}
