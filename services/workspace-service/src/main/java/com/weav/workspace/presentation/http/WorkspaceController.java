package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.usecase.CreateWorkspaceUseCase;
import com.weav.workspace.application.usecase.GetWorkspaceUseCase;
import com.weav.workspace.application.usecase.ListWorkspacesUseCase;
import com.weav.workspace.application.usecase.RenameWorkspaceUseCase;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.infrastructure.security.JwtActor;
import com.weav.workspace.presentation.http.request.CreateWorkspaceRequest;
import com.weav.workspace.presentation.http.request.RenameWorkspaceRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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
@RequestMapping("/workspaces")
public final class WorkspaceController {

    private final CreateWorkspaceUseCase createWorkspace;
    private final ListWorkspacesUseCase listWorkspaces;
    private final GetWorkspaceUseCase getWorkspace;
    private final RenameWorkspaceUseCase renameWorkspace;

    public WorkspaceController(
            CreateWorkspaceUseCase createWorkspace,
            ListWorkspacesUseCase listWorkspaces,
            GetWorkspaceUseCase getWorkspace,
            RenameWorkspaceUseCase renameWorkspace) {
        this.createWorkspace = createWorkspace;
        this.listWorkspaces = listWorkspaces;
        this.getWorkspace = getWorkspace;
        this.renameWorkspace = renameWorkspace;
    }

    @PostMapping
    public ResponseEntity<WorkspaceResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateWorkspaceRequest request) {
        WorkspaceResponse response = createWorkspace.execute(
                new CreateWorkspaceCommand(JwtActor.userId(jwt), request.name()));
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping
    public PageResult<WorkspaceResponse> list(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String role,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "name") String sort,
            @RequestParam(defaultValue = "asc") String direction) {
        return listWorkspaces.execute(
                JwtActor.userId(jwt),
                WorkspaceHttpQueryParser.workspaceList(search, role, page, size, sort, direction));
    }

    @GetMapping("/{workspaceId}")
    public WorkspaceResponse get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId) {
        return getWorkspace.execute(JwtActor.userId(jwt), workspaceId);
    }

    @PatchMapping("/{workspaceId}")
    public WorkspaceResponse rename(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID workspaceId,
            @Valid @RequestBody RenameWorkspaceRequest request) {
        return renameWorkspace.execute(JwtActor.userId(jwt), workspaceId, request.name());
    }
}
