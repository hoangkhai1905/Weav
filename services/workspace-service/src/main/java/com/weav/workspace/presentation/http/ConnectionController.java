package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.CreateConnectionCommand;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.application.dto.UpdateConnectionCommand;
import com.weav.workspace.application.usecase.CreateConnectionUseCase;
import com.weav.workspace.application.usecase.DeleteConnectionUseCase;
import com.weav.workspace.application.usecase.DeleteCredentialUseCase;
import com.weav.workspace.application.usecase.DisableConnectionUseCase;
import com.weav.workspace.application.usecase.GetConnectionUseCase;
import com.weav.workspace.application.usecase.ListConnectionsUseCase;
import com.weav.workspace.application.usecase.SaveCredentialUseCase;
import com.weav.workspace.application.usecase.StartConnectionOAuthUseCase;
import com.weav.workspace.application.usecase.TestConnectionUseCase;
import com.weav.workspace.application.usecase.UpdateConnectionUseCase;
import com.weav.workspace.infrastructure.security.JwtActor;
import com.weav.workspace.presentation.http.request.CreateConnectionRequest;
import com.weav.workspace.presentation.http.request.SaveCredentialRequest;
import com.weav.workspace.presentation.http.request.UpdateConnectionRequest;
import com.weav.workspace.presentation.http.response.OAuthAuthorizationHttpResponse;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.util.List;
import java.util.UUID;

/** Thin HTTP adapter for Workspace Connection use cases. */
@RestController
@RequestMapping("/workspaces/{workspaceId}/connections")
public final class ConnectionController {

    private final CreateConnectionUseCase createConnection;
    private final ListConnectionsUseCase listConnections;
    private final GetConnectionUseCase getConnection;
    private final UpdateConnectionUseCase updateConnection;
    private final DeleteConnectionUseCase deleteConnection;
    private final SaveCredentialUseCase saveCredential;
    private final DeleteCredentialUseCase deleteCredential;
    private final TestConnectionUseCase testConnection;
    private final DisableConnectionUseCase disableConnection;
    private final StartConnectionOAuthUseCase startOAuth;

    public ConnectionController(
            CreateConnectionUseCase createConnection,
            ListConnectionsUseCase listConnections,
            GetConnectionUseCase getConnection,
            UpdateConnectionUseCase updateConnection,
            DeleteConnectionUseCase deleteConnection,
            SaveCredentialUseCase saveCredential,
            DeleteCredentialUseCase deleteCredential,
            TestConnectionUseCase testConnection,
            DisableConnectionUseCase disableConnection,
            StartConnectionOAuthUseCase startOAuth) {
        this.createConnection = createConnection;
        this.listConnections = listConnections;
        this.getConnection = getConnection;
        this.updateConnection = updateConnection;
        this.deleteConnection = deleteConnection;
        this.saveCredential = saveCredential;
        this.deleteCredential = deleteCredential;
        this.testConnection = testConnection;
        this.disableConnection = disableConnection;
        this.startOAuth = startOAuth;
    }

    @PostMapping
    public ResponseEntity<ConnectionResponse> create(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateConnectionRequest request) {
        CreateConnectionCommand command = request.toCommand(workspaceId, JwtActor.userId(jwt));
        ConnectionResponse created = createConnection.execute(command);
        return ResponseEntity.created(ServletUriComponentsBuilder.fromCurrentRequest()
                        .path("/{connectionId}")
                        .buildAndExpand(created.id())
                        .toUri())
                .body(created);
    }

    @GetMapping
    public List<ConnectionResponse> list(
            @PathVariable UUID workspaceId,
            @AuthenticationPrincipal Jwt jwt) {
        return listConnections.execute(JwtActor.userId(jwt), workspaceId);
    }

    @GetMapping("/{connectionId}")
    public ConnectionResponse get(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        return getConnection.execute(JwtActor.userId(jwt), workspaceId, connectionId);
    }

    @PatchMapping("/{connectionId}")
    public ConnectionResponse update(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateConnectionRequest request) {
        UpdateConnectionCommand command = request.toCommand(
                JwtActor.userId(jwt), workspaceId, connectionId);
        return updateConnection.execute(command);
    }

    @DeleteMapping("/{connectionId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        deleteConnection.execute(JwtActor.userId(jwt), workspaceId, connectionId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{connectionId}/credential")
    public ConnectionResponse saveCredential(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody SaveCredentialRequest request) {
        SaveCredentialCommand command = request.toCommand(
                JwtActor.userId(jwt), workspaceId, connectionId);
        return saveCredential.execute(command);
    }

    @DeleteMapping("/{connectionId}/credential")
    public ConnectionResponse deleteCredential(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        return deleteCredential.execute(JwtActor.userId(jwt), workspaceId, connectionId);
    }

    @PostMapping("/{connectionId}/test")
    public ConnectionTestResult test(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        return testConnection.execute(JwtActor.userId(jwt), workspaceId, connectionId);
    }

    @PostMapping("/{connectionId}/disable")
    public ConnectionResponse disable(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        return disableConnection.execute(JwtActor.userId(jwt), workspaceId, connectionId);
    }

    @PostMapping("/{connectionId}/oauth/authorize")
    public ResponseEntity<OAuthAuthorizationHttpResponse> authorizeGoogle(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(OAuthAuthorizationHttpResponse.from(
                        startOAuth.execute(JwtActor.userId(jwt), workspaceId, connectionId)));
    }
}
