package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.AiGenerationPort;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.exception.AiUnavailableException;
import com.weav.workflow.domain.generation.IntentCompiler;
import org.junit.jupiter.api.Test;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkflowGenerationServiceTest {
    @Test
    void disabledFlagIsAiUnavailable() {
        UUID workspace = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        WorkspaceAuthorization authorization = new WorkspaceAuthorization((w, u) ->
                new WorkspaceAccessPort.Access(w, u, "workspace", java.util.Set.of("WORKFLOW_CREATE")));
        WorkflowGenerationService service = new WorkflowGenerationService(authorization,
                new NoConnections(), (id, payload) -> Map.of(), new GenerationRateLimiter(),
                new IntentCompiler(new DefinitionValidator()), () -> false);
        assertThrows(AiUnavailableException.class, () -> service.generate(workspace, actor, "ping", null, Map.of()));
    }

    private static final class NoConnections implements WorkspaceConnectionPort {
        public void authorizeAttachment(UUID w, UUID c, UUID u) {}
        public ResolvedConnection resolve(UUID w, UUID c) { return null; }
        public void reportAuthenticationRejected(UUID w, UUID c) {}
    }
}
