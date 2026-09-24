package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.service.ConnectionUsageRateLimiter;
import com.weav.workflow.application.service.ConnectionUsageService;
import com.weav.workflow.infrastructure.security.InternalServiceKeyFilter;
import com.weav.workflow.infrastructure.security.SecurityConfig;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.infrastructure.web.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ConnectionUsageControllerHttpTest {

    private static final String SERVICE_KEY = "connection-usage-controller-test-key";

    @Test
    void missingAndInvalidServiceKeysAreRejectedBeforeTheUsageServiceRuns() throws Exception {
        ConnectionReferencePort references = mock(ConnectionReferencePort.class);
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        MockMvc mvc = controller(references,
                new ConnectionUsageRateLimiter(5, Duration.ofMinutes(1), () -> 0L));

        String path = usagePath(workspaceId, connectionId);
        mvc.perform(get(path).servletPath(path))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        mvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, "wrong-service-key"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));

        verifyNoInteractions(references);
    }

    @Test
    void rateLimitUsesTheStandard429ErrorEnvelopeAndDoesNotCallTheStoreAgain() throws Exception {
        ConnectionReferencePort references = mock(ConnectionReferencePort.class);
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        String path = usagePath(workspaceId, connectionId);
        when(references.inUse(workspaceId, connectionId)).thenReturn(false);
        MockMvc mvc = controller(references,
                new ConnectionUsageRateLimiter(1, Duration.ofHours(1), () -> 0L));

        mvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"inUse\":false}", true));
        mvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("RATE_LIMIT_EXCEEDED"))
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME));
    }

    @Test
    void persistenceFailureReturnsOnlyTheGeneric500Envelope() throws Exception {
        ConnectionReferencePort references = mock(ConnectionReferencePort.class);
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        String path = usagePath(workspaceId, connectionId);
        when(references.inUse(workspaceId, connectionId))
                .thenThrow(new DataAccessResourceFailureException("private database detail"));
        MockMvc mvc = controller(references,
                new ConnectionUsageRateLimiter(5, Duration.ofMinutes(1), () -> 0L));

        var response = mvc.perform(get(path).servletPath(path)
                        .header(InternalServiceKeyFilter.HEADER_NAME, SERVICE_KEY))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.status").value(500))
                .andExpect(header().exists(CorrelationIdFilter.HEADER_NAME))
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertFalse(response.contains("private database detail"));
    }

    private MockMvc controller(ConnectionReferencePort references, ConnectionUsageRateLimiter limiter) {
        ConnectionUsageService service = new ConnectionUsageService(references, limiter);
        ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();
        SecurityConfig.ApiAuthenticationEntryPoint entryPoint =
                new SecurityConfig.ApiAuthenticationEntryPoint(objectMapper);
        return org.springframework.test.web.servlet.setup.MockMvcBuilders
                .standaloneSetup(new InternalConnectionUsageController(service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .addFilters(new CorrelationIdFilter(), new InternalServiceKeyFilter(SERVICE_KEY, entryPoint))
                .build();
    }

    private String usagePath(UUID workspaceId, UUID connectionId) {
        return "/internal/workspaces/" + workspaceId + "/connections/" + connectionId + "/usage";
    }
}
