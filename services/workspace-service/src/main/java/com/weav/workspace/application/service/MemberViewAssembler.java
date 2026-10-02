package com.weav.workspace.application.service;

import com.weav.workspace.application.dto.MemberView;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

@Service
public final class MemberViewAssembler {

    private final IdentityDirectoryPort identityDirectory;

    public MemberViewAssembler(IdentityDirectoryPort identityDirectory) {
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
    }

    public MemberView from(Membership membership) {
        Objects.requireNonNull(membership, "membership must not be null");
        List<IdentityUserSummary> summaries = identityDirectory.getUsersByIds(List.of(membership.getUserId()));
        if (summaries.size() != 1 || !membership.getUserId().equals(summaries.getFirst().userId())) {
            throw new DependencyUnavailableException();
        }
        return MemberView.from(membership, summaries.getFirst());
    }
}
