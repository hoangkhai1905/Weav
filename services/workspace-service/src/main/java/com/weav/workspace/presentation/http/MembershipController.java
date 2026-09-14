package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.AddMemberCommand;
import com.weav.workspace.application.dto.MemberView;
import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.service.MemberViewAssembler;
import com.weav.workspace.application.usecase.AddMemberUseCase;
import com.weav.workspace.application.usecase.LeaveWorkspaceUseCase;
import com.weav.workspace.application.usecase.ListMembersUseCase;
import com.weav.workspace.application.usecase.RemoveMemberUseCase;
import com.weav.workspace.application.usecase.UpdateMemberPermissionsUseCase;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.infrastructure.security.JwtActor;
import com.weav.workspace.presentation.http.request.AddMemberRequest;
import com.weav.workspace.presentation.http.request.UpdateMemberPermissionsRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/workspaces/{workspaceId}/members")
public final class MembershipController {

    private final ListMembersUseCase listMembers;
    private final AddMemberUseCase addMember;
    private final UpdateMemberPermissionsUseCase updateMemberPermissions;
    private final RemoveMemberUseCase removeMember;
    private final LeaveWorkspaceUseCase leaveWorkspace;
    private final MemberViewAssembler memberViewAssembler;

    public MembershipController(
            ListMembersUseCase listMembers,
            AddMemberUseCase addMember,
            UpdateMemberPermissionsUseCase updateMemberPermissions,
            RemoveMemberUseCase removeMember,
            LeaveWorkspaceUseCase leaveWorkspace,
            MemberViewAssembler memberViewAssembler) {
        this.listMembers = listMembers;
        this.addMember = addMember;
        this.updateMemberPermissions = updateMemberPermissions;
        this.removeMember = removeMember;
        this.leaveWorkspace = leaveWorkspace;
        this.memberViewAssembler = memberViewAssembler;
    }

    @GetMapping
    public PageResult<MemberView> list(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) Boolean canPublishWorkflow,
            @RequestParam(required = false) Boolean canManageWorkflowState,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "displayName") String sort,
            @RequestParam(defaultValue = "asc") String direction) {
        return listMembers.execute(
                JwtActor.userId(jwt),
                workspaceId,
                WorkspaceHttpQueryParser.memberList(
                        search,
                        role,
                        canPublishWorkflow,
                        canManageWorkflowState,
                        page,
                        size,
                        sort,
                        direction));
    }

    @PostMapping
    public ResponseEntity<MemberView> add(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @Valid @RequestBody AddMemberRequest request) {
        MemberView response = addMember.execute(
                new AddMemberCommand(workspaceId, JwtActor.userId(jwt), request.email()));
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @PatchMapping("/{targetUserId}/permissions")
    public MemberView updatePermissions(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @PathVariable UUID targetUserId,
            @Valid @RequestBody UpdateMemberPermissionsRequest request) {
        var membership = updateMemberPermissions.execute(
                new UpdateMemberPermissionsCommand(
                        workspaceId,
                        JwtActor.userId(jwt),
                        targetUserId,
                        request.canPublishWorkflow(),
                        request.canManageWorkflowState()));
        return memberViewAssembler.from(membership);
    }

    @DeleteMapping("/{targetUserId}")
    public ResponseEntity<Void> remove(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @PathVariable UUID targetUserId) {
        removeMember.execute(workspaceId, JwtActor.userId(jwt), targetUserId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/me")
    public ResponseEntity<Void> leave(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId) {
        leaveWorkspace.execute(workspaceId, JwtActor.userId(jwt));
        return ResponseEntity.noContent().build();
    }
}
