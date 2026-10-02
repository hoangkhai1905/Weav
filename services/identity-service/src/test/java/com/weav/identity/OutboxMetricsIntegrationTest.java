package com.weav.identity;

import com.weav.identity.infrastructure.metrics.OutboxMetrics;
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
@SpringBootTest(properties = {
        "weav.oauth.enabled=false",
        "management.endpoints.web.exposure.include=health,info,prometheus"})
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
        double before = gauge("weav_outbox_pending", "notification_outbox");
        jdbc.update("insert into identity.notification_outbox (event_id, event_type, payload, created_at, next_attempt_at)"
                + " values (gen_random_uuid(), 'x', '{}'::jsonb, now() - interval '120 seconds', now() + interval '1 day')");
        outboxMetrics.refresh();
        assertEquals(before + 1, gauge("weav_outbox_pending", "notification_outbox"));
        assertTrue(gauge("weav_outbox_oldest_pending_age_seconds", "notification_outbox") >= 120);

        String body = mockMvc.perform(get("/actuator/prometheus")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("weav_outbox_pending{"), body);
        assertTrue(body.contains("weav_outbox_oldest_pending_age_seconds{"));
        assertTrue(body.contains("hikaricp_connections_pending"));
    }
}
