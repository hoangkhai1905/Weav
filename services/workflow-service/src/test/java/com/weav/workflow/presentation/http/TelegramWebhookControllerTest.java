package com.weav.workflow.presentation.http;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.trigger.WebhookTriggerService;
import com.weav.workflow.domain.exception.WebhookNotFoundException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.infrastructure.web.GlobalExceptionHandler;
import com.weav.workflow.infrastructure.web.WebhookRequestPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TelegramWebhookControllerTest {
    private final WebhookTriggerService webhooks = mock(WebhookTriggerService.class);
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new WebhookController(webhooks))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void forwardsTheSecretHeaderAndTheUpdateAndAnswersWithOkAndTheExecutionId() throws Exception {
        UUID executionId = UUID.randomUUID();
        when(webhooks.acceptTelegram(eq("key"), eq("the-secret"), any(), any(), any())).thenReturn(Optional.of(
                new ExecutionAdmissionPort.Admission(executionId, UUID.randomUUID(), UUID.randomUUID(),
                        ExecutionStatus.QUEUED)));

        mockMvc.perform(post("/webhooks/telegram/key")
                        .header("X-Telegram-Bot-Api-Secret-Token", "the-secret")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"update_id\":1,\"message\":{\"text\":\"hi\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.executionId").value(executionId.toString()));

        verify(webhooks).acceptTelegram(eq("key"), eq("the-secret"),
                eq(Map.of("update_id", 1, "message", Map.of("text", "hi"))), any(), any());
    }

    @Test
    void ignoredUpdatesAndDuplicatesAreStill200WithoutAnExecutionId() throws Exception {
        when(webhooks.acceptTelegram(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        mockMvc.perform(post("/webhooks/telegram/key")
                        .header("X-Telegram-Bot-Api-Secret-Token", "s")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"update_id\":2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.executionId").doesNotExist());
    }

    @Test
    void missingOrWrongSecretGetsTheSameGenericNotFoundAsTheWebhookRoute() throws Exception {
        when(webhooks.acceptTelegram(any(), any(), any(), any(), any())).thenThrow(new WebhookNotFoundException());

        mockMvc.perform(post("/webhooks/telegram/key").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.error.code").value("WEBHOOK_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Webhook was not found"))
                .andExpect(jsonPath("$.path").value("/webhooks/telegram/{endpointKey}"));
    }

    @Test
    void telegramPathsAreWebhookIngressAndTheirEndpointKeyIsRedacted() {
        MockHttpServletRequest telegram = new MockHttpServletRequest("POST", "/webhooks/telegram/secret-key");
        telegram.setServletPath("/webhooks/telegram/secret-key");
        MockHttpServletRequest plain = new MockHttpServletRequest("POST", "/webhooks/secret-key");
        plain.setServletPath("/webhooks/secret-key");
        MockHttpServletRequest nested = new MockHttpServletRequest("POST", "/webhooks/telegram/a/b");
        nested.setServletPath("/webhooks/telegram/a/b");

        assertTrue(WebhookRequestPath.isWebhookIngress(telegram));
        assertTrue(WebhookRequestPath.isWebhookIngress(plain));
        assertFalse(WebhookRequestPath.isWebhookIngress(nested));
        assertEquals("/webhooks/telegram/{endpointKey}", WebhookRequestPath.sanitizedPath(telegram));
        assertEquals("/webhooks/{endpointKey}", WebhookRequestPath.sanitizedPath(plain));
    }
}
