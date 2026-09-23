package com.weav.workflow.infrastructure.web;

import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(OutputCaptureExtension.class)
class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(new TestController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void returnsConsistentValidationErrorResponse() throws Exception {
        mockMvc.perform(post("/test/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.message").value("Request validation failed"))
                .andExpect(jsonPath("$.error.details[0].field").value("name"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.path").value("/test/validation"));
    }

    @Test
    void mapsDomainNotFoundToErrorResponse() throws Exception {
        mockMvc.perform(get("/test/not-found").header(CorrelationIdFilter.HEADER_NAME, "handler-42"))
                .andExpect(status().isNotFound())
                .andExpect(header().string(CorrelationIdFilter.HEADER_NAME, "handler-42"))
                .andExpect(jsonPath("$.error.code").value("RESOURCE_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Workflow not found: 123"))
                .andExpect(jsonPath("$.status").value(404));
    }

    @Test
    void mapsWorkspaceFailureToSanitizedServiceUnavailableResponse() throws Exception {
        mockMvc.perform(get("/test/workspace-unavailable")
                        .header(CorrelationIdFilter.HEADER_NAME, "workspace-error-42"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string(CorrelationIdFilter.HEADER_NAME, "workspace-error-42"))
                .andExpect(jsonPath("$.error.code").value("DEPENDENCY_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.message").value("Workspace authorization is temporarily unavailable"))
                .andExpect(jsonPath("$.status").value(503));
    }

    @Test
    void unexpectedExceptionDoesNotEchoOrLogDownstreamDiagnostic(CapturedOutput output) throws Exception {
        String secretMarker = "raw-downstream-response-secret";
        String response = mockMvc.perform(get("/test/unexpected"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        org.junit.jupiter.api.Assertions.assertFalse(response.contains(secretMarker));
        org.junit.jupiter.api.Assertions.assertFalse(output.getOut().contains(secretMarker));
    }

    @RestController
    static class TestController {

        @PostMapping("/test/validation")
        void validation(@Valid @RequestBody TestRequest request) {
        }

        @GetMapping("/test/not-found")
        void notFound() {
            throw new ResourceNotFoundException("Workflow", 123);
        }

        @GetMapping("/test/workspace-unavailable")
        void workspaceUnavailable() {
            throw new WorkspaceDependencyUnavailableException();
        }

        @GetMapping("/test/unexpected")
        void unexpected() {
            throw new IllegalStateException("raw-downstream-response-secret");
        }
    }

    record TestRequest(@NotBlank(message = "name is required") String name) {
    }
}
