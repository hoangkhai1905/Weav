package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.MemberView;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.query.MemberListQuery;
import com.weav.workspace.domain.query.MemberSort;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
public final class ListMembersUseCase {

    private final MembershipRepository membershipRepository;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;

    public ListMembersUseCase(
            MembershipRepository membershipRepository,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public PageResult<MemberView> execute(
            UUID actorUserId,
            UUID workspaceId,
            MemberListQuery query) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(query, "query must not be null");
        return transactionRunner.required(() -> {
            membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
            List<Membership> candidates = membershipRepository.findCandidates(workspaceId, query);
            List<UUID> candidateIds = candidates.stream().map(Membership::getUserId).toList();
            Map<UUID, Membership> membershipsByUser = byUserId(candidates);

            if (query.sort() == MemberSort.DISPLAY_NAME) {
                PageResult<IdentityUserSummary> identityPage = identityDirectory.searchUsersByDisplayName(
                        candidateIds, query.search(), query.page(), query.size(), query.direction());
                List<MemberView> items = identityPage.items().stream()
                        .filter(summary -> membershipsByUser.containsKey(summary.userId()))
                        .map(summary -> MemberView.from(membershipsByUser.get(summary.userId()), summary))
                        .toList();
                return new PageResult<>(items, identityPage.page(), identityPage.size(),
                        identityPage.totalElements(), identityPage.totalPages());
            }

            Set<UUID> matchedUserIds = query.hasSearch()
                    ? identityDirectory.matchUserIds(candidateIds, query.search())
                    : Set.copyOf(candidateIds);
            PageResult<Membership> membershipPage = membershipRepository
                    .pageCandidatesByWorkspaceOwnedSort(workspaceId, query, matchedUserIds);
            Map<UUID, IdentityUserSummary> summaries = summariesByUserId(
                    identityDirectory.getUsersByIds(membershipPage.items().stream()
                            .map(Membership::getUserId).toList()));
            List<MemberView> items = membershipPage.items().stream()
                    .map(membership -> {
                        IdentityUserSummary summary = summaries.get(membership.getUserId());
                        return summary == null ? null : MemberView.from(membership, summary);
                    })
                    .filter(Objects::nonNull)
                    .toList();
            return new PageResult<>(items, membershipPage.page(), membershipPage.size(),
                    membershipPage.totalElements(), membershipPage.totalPages());
        });
    }

    private Map<UUID, Membership> byUserId(List<Membership> memberships) {
        Map<UUID, Membership> result = new LinkedHashMap<>();
        for (Membership membership : memberships) {
            result.put(membership.getUserId(), membership);
        }
        return result;
    }

    private Map<UUID, IdentityUserSummary> summariesByUserId(List<IdentityUserSummary> summaries) {
        Map<UUID, IdentityUserSummary> result = new LinkedHashMap<>();
        for (IdentityUserSummary summary : summaries) {
            result.put(summary.userId(), summary);
        }
        return result;
    }
}
