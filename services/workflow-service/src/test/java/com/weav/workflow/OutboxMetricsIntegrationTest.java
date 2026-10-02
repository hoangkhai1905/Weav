package com.weav.workflow;

import com.weav.workflow.infrastructure.metrics.OutboxMetrics;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.micrometer.metrics.test.autoconfigure.AutoConfigureMetrics;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** X-14: outbox gauges and Hikari metrics are served, unauthenticated, on /actuator/prometheus. */
@SpringBootTest
@AutoConfigureMetrics
@Import(TestcontainersConfiguration.class)
class OutboxMetricsIntegrationTest {

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private MeterRegistry registry;
    @Autowired
    private OutboxMetrics outboxMetrics;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(SecurityMockMvcConfigurers.springSecurity()).build();
    }

    private double gauge(String name, String outbox) {
        return registry.get(name).tag("outbox", outbox).gauge().value();
    }

    @Test
    void exposesOutboxAndHikariMetricsAndReflectsSeededRows() throws Exception {
        double pending = gauge("weav_outbox_pending", "outbox_events");
        double failed = gauge("weav_outbox_failed", "outbox_events");
        double notificationPending = gauge("weav_outbox_pending", "notification_outbox");
        double notificationFailed = gauge("weav_outbox_failed", "notification_outbox");
        for (String status : new String[] {"PENDING", "FAILED"}) {
            jdbc.update("insert into workflow.outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status,"
                    + " created_at, next_attempt_at) values (gen_random_uuid(), 't', gen_random_uuid(), 'e', '{}'::jsonb, ?,"
                    + " now() - interval '120 seconds', now() + interval '1 day')", status);
            jdbc.update("insert into workflow.notification_outbox (event_id, event_type, occurred_at, workspace_id,"
                    + " recipient_user_id, entity_kind, entity_id, requires_monitor_access, payload, status, created_at,"
                    + " next_attempt_at) values (gen_random_uuid(), 'workflow.created', now(), gen_random_uuid(),"
                    + " gen_random_uuid(), 'WORKFLOW', gen_random_uuid(), false, '{}'::jsonb, ?,"
                    + " now() - interval '120 seconds', now() + interval '1 day')", status);
        }
        outboxMetrics.refresh();
        assertEquals(pending + 1, gauge("weav_outbox_pending", "outbox_events"));
        assertEquals(failed + 1, gauge("weav_outbox_failed", "outbox_events"));
        assertEquals(notificationPending + 1, gauge("weav_outbox_pending", "notification_outbox"));
        assertEquals(notificationFailed + 1, gauge("weav_outbox_failed", "notification_outbox"));
        assertTrue(gauge("weav_outbox_oldest_pending_age_seconds", "outbox_events") >= 120);

        String body = mockMvc.perform(get("/actuator/prometheus")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("weav_outbox_pending{"), body);
        assertTrue(body.contains("weav_rabbit_queue_messages"), body);
        assertTrue(body.contains("hikaricp_connections_pending"));
    }
}
