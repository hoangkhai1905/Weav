package com.weav.workspace.infrastructure.persistence.notification;

import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Objects;
import java.util.UUID;

@Repository
public class WorkspaceMutationLockAdapter implements WorkspaceMutationLock {
    private final EntityManager entityManager;

    public WorkspaceMutationLockAdapter(EntityManager entityManager) {
        this.entityManager = Objects.requireNonNull(entityManager);
    }

    @Override
    public void lock(UUID workspaceId) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Workspace mutation locks require an active transaction");
        }
        entityManager.createQuery("select workspace from WorkspaceJpaEntity workspace where workspace.id = :id",
                        WorkspaceJpaEntity.class)
                .setParameter("id", workspaceId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
    }
}
