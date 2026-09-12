package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import com.weav.workspace.infrastructure.persistence.mapper.WorkspacePersistenceMapper;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class MembershipRepositoryAdapter implements MembershipRepository {

    private final SpringDataMembershipRepository repository;
    private final WorkspacePersistenceMapper mapper;

    public MembershipRepositoryAdapter(SpringDataMembershipRepository repository) {
        this.repository = repository;
        this.mapper = new WorkspacePersistenceMapper();
    }

    @Override
    public Membership save(Membership membership) {
        return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(membership)));
    }

    @Override
    public Optional<Membership> findById(UUID id) {
        return repository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<Membership> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId) {
        return repository.findByWorkspaceIdAndUserId(workspaceId, userId).map(mapper::toDomain);
    }

    @Override
    public boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId) {
        return repository.existsByWorkspaceIdAndUserId(workspaceId, userId);
    }

    @Override
    public List<Membership> findCandidates(UUID workspaceId, MemberListQuery filter) {
        return repository.findAll(candidateFilter(workspaceId, filter), Sort.by(Sort.Order.asc("userId")))
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public PageResult<Membership> pageCandidatesByWorkspaceOwnedSort(
            UUID workspaceId,
            MemberListQuery query,
            Collection<UUID> matchedUserIds) {
        if (query.sort() == MemberSort.DISPLAY_NAME) {
            throw new IllegalArgumentException(
                    "DISPLAY_NAME sorting is Identity-owned and cannot be applied to workspace-owned paging");
        }
        if (matchedUserIds != null && matchedUserIds.isEmpty()) {
            return new PageResult<>(List.of(), query.page(), query.size(), 0, 0);
        }

        Specification<MembershipJpaEntity> specification = candidateFilter(workspaceId, query);
        if (matchedUserIds != null) {
            specification = specification.and((root, criteriaQuery, criteriaBuilder) ->
                    root.get("userId").in(matchedUserIds));
        }
        Page<MembershipJpaEntity> page = repository.findAll(specification, pageRequest(query));
        return new PageResult<>(
                page.getContent().stream().map(mapper::toDomain).toList(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages());
    }

    @Override
    public void delete(Membership membership) {
        repository.deleteById(membership.getId());
    }

    private Specification<MembershipJpaEntity> candidateFilter(UUID workspaceId, MemberListQuery filter) {
        return (root, criteriaQuery, criteriaBuilder) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.equal(root.get("workspaceId"), workspaceId));
            if (filter.role() != null) {
                predicates.add(criteriaBuilder.equal(root.get("role"), filter.role()));
            }
            if (filter.canPublishWorkflow() != null) {
                predicates.add(criteriaBuilder.equal(
                        root.get("canPublishWorkflow"), filter.canPublishWorkflow()));
            }
            if (filter.canManageWorkflowState() != null) {
                predicates.add(criteriaBuilder.equal(
                        root.get("canManageWorkflowState"), filter.canManageWorkflowState()));
            }
            return criteriaBuilder.and(predicates.toArray(Predicate[]::new));
        };
    }

    private PageRequest pageRequest(MemberListQuery query) {
        Sort.Direction direction = query.direction() == SortDirection.DESC
                ? Sort.Direction.DESC
                : Sort.Direction.ASC;
        String property = switch (query.sort()) {
            case JOINED_AT -> "joinedAt";
            case ROLE -> "role";
            case DISPLAY_NAME -> throw new IllegalArgumentException(
                    "DISPLAY_NAME sorting is Identity-owned and cannot be applied to workspace-owned paging");
        };
        return PageRequest.of(
                query.page(),
                query.size(),
                Sort.by(new Sort.Order(direction, property), Sort.Order.asc("userId")));
    }
}
