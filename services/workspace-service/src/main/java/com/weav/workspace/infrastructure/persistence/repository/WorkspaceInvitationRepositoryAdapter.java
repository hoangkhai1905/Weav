package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.exception.InvitationExistsException;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.valueobject.InvitationStatus;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceInvitationJpaEntity;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class WorkspaceInvitationRepositoryAdapter implements WorkspaceInvitationRepository {

    static final String ONE_PENDING_INDEX = "workspace_invitations_one_pending";

    private final SpringDataWorkspaceInvitationRepository repository;

    public WorkspaceInvitationRepositoryAdapter(SpringDataWorkspaceInvitationRepository repository) {
        this.repository = repository;
    }

    @Override
    public WorkspaceInvitation save(WorkspaceInvitation invitation) {
        try {
            return toDomain(repository.saveAndFlush(toEntity(invitation)));
        } catch (RuntimeException exception) {
            throw translate(exception);
        }
    }

    @Override
    public Optional<WorkspaceInvitation> findById(UUID id) {
        return repository.findById(id).map(WorkspaceInvitationRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<WorkspaceInvitation> findPendingByWorkspaceAndEmail(UUID workspaceId, String canonicalEmail) {
        return repository.findByWorkspaceIdAndEmailAndStatus(workspaceId, canonicalEmail, InvitationStatus.PENDING)
                .map(WorkspaceInvitationRepositoryAdapter::toDomain);
    }

    @Override
    public long countLivePendingByWorkspace(UUID workspaceId, Instant now) {
        return repository.countByWorkspaceIdAndStatusAndExpiresAtAfter(
                workspaceId, InvitationStatus.PENDING, now);
    }

    @Override
    public long countCreatedSince(UUID workspaceId, Instant since) {
        return repository.countByWorkspaceIdAndCreatedAtGreaterThanEqual(workspaceId, since);
    }

    @Override
    public List<WorkspaceInvitation> listPendingByWorkspace(UUID workspaceId, int limit) {
        return repository.findByWorkspaceIdAndStatusOrderByCreatedAtDesc(
                        workspaceId, InvitationStatus.PENDING, PageRequest.of(0, limit)).stream()
                .map(WorkspaceInvitationRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public List<WorkspaceInvitation> listLivePendingByEmail(String canonicalEmail, Instant now, int limit) {
        return repository.findByEmailAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
                        canonicalEmail, InvitationStatus.PENDING, now, PageRequest.of(0, limit))
                .stream()
                .map(WorkspaceInvitationRepositoryAdapter::toDomain)
                .toList();
    }

    static RuntimeException translate(RuntimeException exception) {
        Throwable current = exception;
        while (current != null) {
            if (current instanceof ConstraintViolationException violation
                    && ONE_PENDING_INDEX.equals(violation.getConstraintName())) {
                return new InvitationExistsException();
            }
            current = current.getCause();
        }
        return exception;
    }

    private static WorkspaceInvitationJpaEntity toEntity(WorkspaceInvitation i) {
        return new WorkspaceInvitationJpaEntity(i.getId(), i.getWorkspaceId(), i.getEmail(), i.getInvitedBy(),
                i.getStatus(), i.getExpiresAt(), i.getLastSentAt(), i.getRespondedAt(), i.getRespondedBy(),
                i.getCreatedAt(), i.getUpdatedAt());
    }

    private static WorkspaceInvitation toDomain(WorkspaceInvitationJpaEntity e) {
        return new WorkspaceInvitation(e.getId(), e.getWorkspaceId(), e.getEmail(), e.getInvitedBy(),
                e.getStatus(), e.getExpiresAt(), e.getLastSentAt(), e.getRespondedAt(), e.getRespondedBy(),
                e.getCreatedAt(), e.getUpdatedAt());
    }
}
