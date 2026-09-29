package com.weav.workspace.application.notification;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkspaceNotificationEventTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final UUID RECIPIENT_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void confirmedInternalConnectionFailureKeepsAnExplicitNullActorInSerializedEnvelope() throws Exception {
        WorkspaceNotificationEvent[] captured = new WorkspaceNotificationEvent[1];

        assertThatCode(() -> captured[0] = event("connection.invalid", null))
                .doesNotThrowAnyException();

        String json = objectMapper.writeValueAsString(captured[0]);
        assertThat(json).contains("\"actorUserId\":null");
        assertThat(json).contains("\"eventType\":\"connection.invalid\"");
        assertThat(json).contains("\"entity\":{\"kind\":\"CONNECTION\"");
        assertThat(json).contains("\"data\":{\"connectionName\":\"Connection name\"}");
    }

    @Test
    void existingWorkspaceEventsStillRequireAnActor() {
        assertThatThrownBy(() -> event("workspace.created", null))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> event("connection.connected", null))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> event("connection.disabled", null))
                .isInstanceOf(NullPointerException.class);
    }

    private WorkspaceNotificationEvent event(String eventType, UUID actorUserId) {
        boolean connectionEvent = eventType.startsWith("connection.");
        return new WorkspaceNotificationEvent(
                2,
                UUID.fromString("40000000-0000-0000-0000-000000000001"),
                eventType,
                "2026-01-02T03:04:05Z",
                "workspace-service",
                actorUserId,
                List.of(RECIPIENT_ID),
                WORKSPACE_ID,
                new WorkspaceNotificationEvent.Entity(
                        connectionEvent ? "CONNECTION" : "WORKSPACE",
                        connectionEvent ? CONNECTION_ID : WORKSPACE_ID),
                connectionEvent
                        ? new WorkspaceNotificationEvent.ConnectionNameData("Connection name")
                        : new WorkspaceNotificationEvent.WorkspaceNameData("Workspace name"));
    }
}
