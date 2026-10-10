package com.weav.workspace.infrastructure.web;

import com.weav.workspace.domain.exception.InvitationGoneException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.exception.InvitationResendTooSoonException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.UserNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andExpect(jsonPath("$.error").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist())
                .andExpect(jsonPath("$.path").doesNotExist());
    }

    @Test
    void mapsDomainNotFoundToErrorResponse() throws Exception {
        mockMvc.perform(get("/test/not-found"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Workspace not found: 123"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    @Test
    void mapsMissingIdentityUserToNotFoundForMemberAddition() throws Exception {
        mockMvc.perform(get("/test/identity-not-found"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
    }

    @Test
    void mapsInvitationGoneTooManyRequestsAndNotFound() throws Exception {
        mockMvc.perform(get("/test/gone"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("INVITATION_GONE"));
        mockMvc.perform(get("/test/too-many"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("INVITATION_RESEND_TOO_SOON"));
        mockMvc.perform(get("/test/invitation-not-found"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INVITATION_NOT_FOUND"));
    }

    @RestController
    static class TestController {

        @GetMapping("/test/gone")
        void gone() {
            throw new InvitationGoneException();
        }

        @GetMapping("/test/too-many")
        void tooMany() {
            throw new InvitationResendTooSoonException();
        }

        @GetMapping("/test/invitation-not-found")
        void invitationNotFound() {
            throw new InvitationNotFoundException();
        }

        @PostMapping("/test/validation")
        void validation(@Valid @RequestBody TestRequest request) {
        }

        @GetMapping("/test/not-found")
        void notFound() {
            throw new ResourceNotFoundException("Workspace", 123);
        }

        @GetMapping("/test/identity-not-found")
        void identityNotFound() {
            throw new UserNotFoundException();
        }
    }

    record TestRequest(@NotBlank(message = "name is required") String name) {
    }
}
