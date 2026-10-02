package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.notification.IdentitySecurityEventType;
import com.weav.identity.application.notification.IdentitySecurityNotificationRecorder;
import com.weav.identity.application.port.out.TransactionRunner;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@TestPropertySource(properties = {
        "weav.oauth.enabled=false",
        "weav.identity.notification-outbox.publisher-enabled=false"
})
class IdentityNotificationOutboxPersistenceIntegrationTest {

    @Autowired
    private IdentitySecurityNotificationRecorder recorder;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void clearOutboxRows() {
        jdbcTemplate.update("delete from identity.notification_outbox");
    }

    @Test
    void appendsTheWholeImmutableEnvelopeToTheIdentitySchemaInTheCurrentTransaction() throws Exception {
        UUID userId = UUID.fromString("11111111-1111-1111-1111-111111111111");

        transactionRunner.required(() -> {
            recorder.record(IdentitySecurityEventType.PASSWORD_CHANGED, userId);
            return null;
        });

        assertEquals(1, jdbcTemplate.queryForObject(
                "select count(*) from identity.notification_outbox where event_type = ?",
                Integer.class,
                "identity.password_changed"));
        String payload = jdbcTemplate.queryForObject(
                "select payload::text from identity.notification_outbox where event_type = ?",
                String.class,
                "identity.password_changed");
        JsonNode event = objectMapper.readTree(payload);
        assertEquals(2, event.path("schemaVersion").intValue());
        assertEquals("identity-service", event.path("producer").stringValue());
        assertEquals(userId.toString(), event.path("actorUserId").stringValue());
        assertEquals(userId.toString(), event.path("recipientUserIds").get(0).stringValue());
        assertEquals("USER", event.path("entity").path("kind").stringValue());
        assertEquals(userId.toString(), event.path("entity").path("id").stringValue());
        assertEquals(0, event.path("data").size());
        assertEquals("identity.password_changed", event.path("eventType").stringValue());
        assertEquals(true, event.path("workspaceId").isNull());
    }

    @Test
    void refusesToAppendOutsideTheBusinessMutationTransaction() {
        assertThrows(InvalidDataAccessApiUsageException.class,
                () -> recorder.record(IdentitySecurityEventType.PASSWORD_RESET, UUID.randomUUID()));
        assertEquals(0, jdbcTemplate.queryForObject(
                "select count(*) from identity.notification_outbox",
                Integer.class));
    }

    @Test
    void aRolledBackCallerTransactionLeavesNoOutboxRow() {
        UUID userId = UUID.randomUUID();
        assertThrows(IllegalStateException.class, () -> transactionRunner.required(() -> {
            recorder.record(IdentitySecurityEventType.GOOGLE_LINKED, userId);
            throw new IllegalStateException("test rollback");
        }));

        assertEquals(0, jdbcTemplate.queryForObject(
                "select count(*) from identity.notification_outbox where payload -> 'entity' ->> 'id' = ?",
                Integer.class,
                userId.toString()));
    }
}
