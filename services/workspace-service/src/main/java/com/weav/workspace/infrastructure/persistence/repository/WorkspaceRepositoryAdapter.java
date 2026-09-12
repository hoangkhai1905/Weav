package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import com.weav.workspace.infrastructure.persistence.mapper.WorkspacePersistenceMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Repository
public class WorkspaceRepositoryAdapter implements WorkspaceRepository {

    private static final Pattern DEFAULT_WORKSPACE_NAME =
            Pattern.compile("^my workspace ([1-9][0-9]*)$", Pattern.CASE_INSENSITIVE);
    private static final char LIKE_ESCAPE = '!';

    private final SpringDataWorkspaceRepository repository;
    private final WorkspacePersistenceMapper mapper;

    public WorkspaceRepositoryAdapter(
            SpringDataWorkspaceRepository repository) {
        this.repository = repository;
        this.mapper = new WorkspacePersistenceMapper();
    }

    @Override
    public Workspace save(Workspace workspace) {
        return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(workspace)));
    }

    @Override
    public Optional<Workspace> findById(UUID workspaceId) {
        return repository.findById(workspaceId).map(mapper::toDomain);
    }

    @Override
    public boolean existsOwnedNameNormalized(
            UUID ownerId,
            String normalizedName,
            UUID excludeWorkspaceId) {
        return repository.existsOwnedNameNormalized(ownerId, normalizedName, excludeWorkspaceId);
    }

    @Override
    public int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId) {
        return repository.findNormalizedNamesByOwner(ownerId).stream()
                .map(DEFAULT_WORKSPACE_NAME::matcher)
                .filter(Matcher::matches)
                .mapToInt(matcher -> parseDefaultWorkspaceNumber(matcher.group(1)))
                .max()
                .orElse(0);
    }

    private int parseDefaultWorkspaceNumber(String suffix) {
        try {
            return Integer.parseInt(suffix);
        } catch (NumberFormatException exception) {
            return Integer.MAX_VALUE;
        }
    }

    @Override
    public PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(
            UUID userId,
            WorkspaceListQuery query) {
        Page<WorkspaceMembershipProjection> page = repository.findAccessibleWorkspaces(
                userId,
                query.role(),
                query.hasSearch() ? likePattern(query.search()) : null,
                pageRequest(query));
        List<WorkspaceMembershipView> items = page.getContent().stream()
                .map(row -> new WorkspaceMembershipView(
                        mapper.toDomain(row.getWorkspace()), row.getRole()))
                .toList();
        return new PageResult<>(items, page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }

    private String likePattern(String search) {
        String escaped = search
                .replace(String.valueOf(LIKE_ESCAPE), String.valueOf(LIKE_ESCAPE) + LIKE_ESCAPE)
                .replace("%", String.valueOf(LIKE_ESCAPE) + "%")
                .replace("_", String.valueOf(LIKE_ESCAPE) + "_");
        return "%" + escaped + "%";
    }

    private PageRequest pageRequest(WorkspaceListQuery query) {
        Sort.Direction direction = query.direction() == com.weav.workspace.domain.query.SortDirection.DESC
                ? Sort.Direction.DESC
                : Sort.Direction.ASC;
        return PageRequest.of(
                query.page(),
                query.size(),
                Sort.by(new Sort.Order(direction, jpaProperty(query.sort())), Sort.Order.asc("id")));
    }

    private String jpaProperty(com.weav.workspace.domain.query.WorkspaceSort sort) {
        return switch (sort) {
            case NAME -> "nameNormalized";
            case CREATED_AT -> "createdAt";
            case UPDATED_AT -> "updatedAt";
        };
    }
}
