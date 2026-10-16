package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.domain.exception.BadRequestException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ExecutionAdmissionServiceTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000081");
    private static final UUID WORKFLOW_ID = UUID.fromString("40000000-0000-0000-0000-000000000081");
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000081");

    private final ExecutionAdmissionPort port = mock(ExecutionAdmissionPort.class);

    private ExecutionAdmissionService service(ObjectMapper mapper, int maxBytes, int maxDepth) {
        return new ExecutionAdmissionService(
                new WorkspaceAuthorization((workspace, user) -> new WorkspaceAccessPort.Access(
                        workspace, user, "MEMBER", Set.of("WORKFLOW_RUN"))),
                port, mapper, maxBytes, maxDepth);
    }

    private ExecutionAdmissionPort.Admission run(ExecutionAdmissionService service, Object input, String key) {
        return service.manual(WORKSPACE_ID, WORKFLOW_ID, ACTOR_ID, input, null, null, key);
    }

    @Test
    void invalidCallerInputStaysABadRequest() {
        ExecutionAdmissionService service = service(JsonMapper.builder().build(), 64, 3);

        assertThrows(BadRequestException.class, () -> run(service, "not an object", null));
        assertThrows(BadRequestException.class, () -> run(service, Map.of("x", new Object()), null));
        assertThrows(BadRequestException.class,
                () -> run(service, Map.of("a", Map.of("b", Map.of("c", Map.of("d", 1)))), null));
        assertThrows(BadRequestException.class, () -> run(service, Map.of("big", "y".repeat(200)), null));
        verify(port, never()).create(any());
    }

    @Test
    void serializationFaultOnTheValidatedInputIsAnInternalErrorNotABadRequest() {
        ObjectMapper broken = mock(ObjectMapper.class);
        when(broken.writeValueAsBytes(any())).thenThrow(new IllegalStateException("writer failure"));
        ExecutionAdmissionService service = service(broken, 1024, 8);

        Throwable thrown = assertThrows(RuntimeException.class, () -> run(service, Map.of("k", "v"), null));

        assertTrue(!(thrown instanceof BadRequestException), "serialization faults must not map to a 400");
        assertTrue(thrown instanceof IllegalStateException);
        verify(port, never()).create(any());
    }

    @Test
    void requestHashFaultIsAnInternalErrorNotABadRequest() {
        ObjectMapper broken = mock(ObjectMapper.class);
        when(broken.writeValueAsBytes(any()))
                .thenReturn(new byte[2])
                .thenThrow(new IllegalStateException("writer failure"));
        ExecutionAdmissionService service = service(broken, 1024, 8);

        Throwable thrown = assertThrows(RuntimeException.class,
                () -> run(service, Map.of("items", List.of(1, 2)), "idem-key-12345"));

        assertTrue(!(thrown instanceof BadRequestException), "hash faults must not map to a 400");
        assertTrue(thrown instanceof IllegalStateException);
        verify(port, never()).create(any());
    }
}
