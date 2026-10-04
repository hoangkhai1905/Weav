package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.service.TelegramTriggerException;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TelegramWebhookAdapterTest {
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final String TOKEN = "123456:synthetic-bot-token";

    @Test
    void registerSendsUrlSecretTokenAndOnlyMessageUpdates() {
        FakeTransport transport = new FakeTransport(200, Map.of("ok", true, "result", true));
        TelegramWebhookAdapter adapter = adapter(transport, new FakeWorkspace(), "https://weav.example.test/");

        adapter.register(WORKSPACE_ID, CONNECTION_ID,
                "https://weav.example.test/api/v1/webhooks/telegram/key", "secret-token");

        assertEquals("https://api.telegram.org/bot" + TOKEN + "/setWebhook", transport.uris.getFirst().toString());
        assertEquals(Map.of("url", "https://weav.example.test/api/v1/webhooks/telegram/key",
                "secret_token", "secret-token", "allowed_updates", List.of("message")), transport.bodies.getFirst());
        assertEquals("https://weav.example.test", adapter.publicBaseUrl());
    }

    @Test
    void registrationFailuresBecomeAStableCodeWithoutTheTokenAndAnInvalidTokenIsReported() {
        FakeTransport rejected = new FakeTransport(401, Map.of("ok", false));
        FakeWorkspace workspace = new FakeWorkspace();
        TelegramTriggerException unauthorized = assertThrows(TelegramTriggerException.class,
                () -> adapter(rejected, workspace, "https://weav.example.test")
                        .register(WORKSPACE_ID, CONNECTION_ID, "https://weav.example.test/x", "s"));
        assertEquals("TELEGRAM_WEBHOOK_REGISTRATION_FAILED", unauthorized.code());
        assertEquals(1, workspace.reports);

        FakeTransport badUrl = new FakeTransport(400, Map.of("ok", false, "description",
                "Bad Request: bad webhook: HTTPS url must be provided for webhook"));
        TelegramTriggerException bad = assertThrows(TelegramTriggerException.class,
                () -> adapter(badUrl, new FakeWorkspace(), "https://weav.example.test")
                        .register(WORKSPACE_ID, CONNECTION_ID, "http://x", "s"));
        assertTrue(bad.getMessage().contains("HTTPS url must be provided"));
        assertFalse(bad.getMessage().contains(TOKEN));

        FakeWorkspace down = new FakeWorkspace();
        down.failure = new WorkspaceDependencyUnavailableException();
        TelegramTriggerException unavailable = assertThrows(TelegramTriggerException.class,
                () -> adapter(new FakeTransport(200, Map.of()), down, "https://weav.example.test")
                        .register(WORKSPACE_ID, CONNECTION_ID, "https://weav.example.test/x", "s"));
        assertEquals("TELEGRAM_WEBHOOK_REGISTRATION_FAILED", unavailable.code());
    }

    @Test
    void unregisterDeletesTheWebhookAndNeverThrows() {
        FakeTransport transport = new FakeTransport(200, Map.of("ok", true, "result", true));
        adapter(transport, new FakeWorkspace(), "https://weav.example.test")
                .unregister(WORKSPACE_ID, CONNECTION_ID);
        assertEquals("https://api.telegram.org/bot" + TOKEN + "/deleteWebhook", transport.uris.getFirst().toString());
        assertEquals(Map.of(), transport.bodies.getFirst());

        FakeTransport failing = new FakeTransport(500, Map.of("ok", false));
        adapter(failing, new FakeWorkspace(), "https://weav.example.test").unregister(WORKSPACE_ID, CONNECTION_ID);
        FakeWorkspace down = new FakeWorkspace();
        down.failure = new IllegalStateException(TOKEN);
        adapter(failing, down, "https://weav.example.test").unregister(WORKSPACE_ID, CONNECTION_ID);
    }

    @Test
    void aMissingOrNonHttpsBaseUrlLeavesTelegramUnconfigured() {
        FakeTransport transport = new FakeTransport(200, Map.of());
        assertNull(adapter(transport, new FakeWorkspace(), "").publicBaseUrl());
        assertNull(adapter(transport, new FakeWorkspace(), "http://weav.example.test").publicBaseUrl());
        assertEquals("https://weav.example.test:8443",
                adapter(transport, new FakeWorkspace(), "https://weav.example.test:8443").publicBaseUrl());
    }

    private static TelegramWebhookAdapter adapter(FakeTransport transport, FakeWorkspace workspace, String baseUrl) {
        return new TelegramWebhookAdapter(new TelegramBotApiClient(transport), workspace, baseUrl);
    }

    private static final class FakeTransport extends PinnedHttpTransport {
        private final int status;
        private final Object data;
        private final List<URI> uris = new ArrayList<>();
        private final List<Object> bodies = new ArrayList<>();

        private FakeTransport(int status, Object data) {
            super();
            this.status = status;
            this.data = data;
        }

        @Override
        public HttpResponse executeTelegramBotApi(URI target, Object body) {
            uris.add(target);
            bodies.add(body);
            return new HttpResponse(status, data, Map.of());
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private RuntimeException failure;
        private int reports;

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            if (failure != null) {
                throw failure;
            }
            return new ResolvedConnection("TELEGRAM", "TOKEN", Map.of("token", TOKEN));
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reports++;
        }
    }
}
