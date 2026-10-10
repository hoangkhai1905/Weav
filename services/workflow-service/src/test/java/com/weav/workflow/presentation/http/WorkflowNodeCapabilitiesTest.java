package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.files.InMemoryFileStore;
import com.weav.workflow.infrastructure.ocr.OcrClientProperties;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Unit test of the capability response; the Spring/security wiring is covered in WorkflowDraftHttpTest. */
class WorkflowNodeCapabilitiesTest {

    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final Set<String> VIEW = Set.of("WORKSPACE_VIEW");

    @Test
    void reportsEnabledSourcesAndNeverLeaksConfiguration() {
        Map<String, Object> body = controller(ocr(true, true, true, "secret-kid", "file:///secret.pem"), VIEW)
                .nodeCapabilities(WORKSPACE, jwt(USER.toString()));

        assertEquals(Map.of("nodes", Map.of("ocr.extract",
                Map.of("available", true, "sources", List.of("url", "artifact", "file")))), body);
        String json = new ObjectMapper().writeValueAsString(body);
        assertFalse(json.contains("secret") || json.contains("ocr.internal"));
    }

    @Test
    void isUnavailableWithoutAnySourceOrWithoutASigningKey() {
        Map<String, Object> unavailable = Map.of("nodes", Map.of("ocr.extract",
                Map.of("available", false, "sources", List.of())));

        assertEquals(unavailable, controller(ocr(false, false, false, "k", "file:///k.pem"), VIEW)
                .nodeCapabilities(WORKSPACE, jwt(USER.toString())));
        assertEquals(unavailable, controller(ocr(true, true, true, "", ""), VIEW)
                .nodeCapabilities(WORKSPACE, jwt(USER.toString())));
    }

    @Test
    void fileSourceNeedsTheFileStoreAndStaysAvailableWithoutUrlOrArtifactSources() {
        OcrClientProperties fileOnly = ocr(true, false, false, "k", "file:///k.pem");

        assertEquals(Map.of("nodes", Map.of("ocr.extract", Map.of("available", true, "sources", List.of("file")))),
                controller(fileOnly, VIEW).nodeCapabilities(WORKSPACE, jwt(USER.toString())));
        assertEquals(Map.of("nodes", Map.of("ocr.extract", Map.of("available", false, "sources", List.of()))),
                controller(fileOnly, VIEW, false).nodeCapabilities(WORKSPACE, jwt(USER.toString())));
        assertEquals(Map.of("nodes", Map.of("ocr.extract", Map.of("available", true, "sources", List.of("url")))),
                controller(ocr(true, true, false, "k", "file:///k.pem"), VIEW, false)
                        .nodeCapabilities(WORKSPACE, jwt(USER.toString())));
    }

    @Test
    void nonMembersAreDeniedAndMalformedPrincipalsRejected() {
        WorkflowController denied = controller(ocr(true, true, true, "k", "file:///k.pem"), Set.of());

        assertThrows(ForbiddenException.class, () -> denied.nodeCapabilities(WORKSPACE, jwt(USER.toString())));
        assertThrows(BadRequestException.class, () -> denied.nodeCapabilities(WORKSPACE, jwt("not-a-uuid")));
    }

    private static WorkflowController controller(OcrClientProperties ocr, Set<String> capabilities) {
        return controller(ocr, capabilities, true);
    }

    private static WorkflowController controller(OcrClientProperties ocr, Set<String> capabilities, boolean fileStore) {
        InMemoryFileStore store = new InMemoryFileStore();
        store.configured = fileStore;
        WorkspaceAccessPort access = (workspaceId, userId) ->
                new WorkspaceAccessPort.Access(workspaceId, userId, "MEMBER", capabilities);
        return new WorkflowController(null, null, null, new ObjectMapper(), new WorkspaceAuthorization(access), ocr, store);
    }

    /** All verification gates open; only the master switch, source switches and key vary. */
    private static OcrClientProperties ocr(boolean enabled, boolean url, boolean artifact, String keyId, String location) {
        return new OcrClientProperties(enabled, url, artifact, true, true, true,
                URI.create("http://ocr.internal"), keyId, location,
                Duration.ofSeconds(5), Duration.ofSeconds(100), Duration.ofSeconds(60), 1_048_576);
    }

    private static Jwt jwt(String subject) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(subject)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    }
}
