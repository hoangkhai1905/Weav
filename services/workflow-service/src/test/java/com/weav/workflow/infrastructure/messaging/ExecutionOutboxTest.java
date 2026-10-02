package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** PostgreSQL/RabbitMQ boundary tests for durable execution delivery and publisher recovery. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.execution-outbox.confirm-timeout=PT5S",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ExecutionOutboxTest {

    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000091");
    private static final Set<String> CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH", "WORKFLOW_RUN");

    @Autowired
    private ExecutionAdmissionService admissionService;
    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowVersionPort versions;
    @Autowired
    private WorkflowTriggerPort triggers;
    @Autowired
    private WorkflowExecutionRepository executions;
    @Autowired
    private OutboxEventRepository outboxEvents;
    @Autowired
    private ExecutionOutboxPublisher publisher;
    @Autowired
    private RabbitTemplate rabbitTemplate;
    @Autowired
    private RabbitAdmin rabbitAdmin;
    @Autowired
    private ScheduledTaskHolder scheduledTaskHolder;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;
    @Autowired
    @Qualifier("workflowPublicationRabbit")
    private RabbitMQContainer rabbitContainer;

    @BeforeEach
    void prepareRabbitAndWorkspaceAccess() {
        workspaceAccess.setCapabilities(CAPABILITIES);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
    }

    @AfterEach
    void cleanupRabbitAndWorkspaceAccess() {
        workspaceAccess.reset();
        try {
            rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        } catch (RuntimeException ignored) {
            // A broker-down scenario restores the broker before leaving the test.
        }
    }

    @Test
    void outboxPublisherIsRegisteredForScheduledPolling() {
        assertFalse(scheduledTaskHolder.getScheduledTasks().isEmpty());
    }

    @Test
    void confirmedRoutedMessageContainsOnlyTheExecutionIdAndMarksTheOutboxPublished() throws Exception {
        var admission = manualAdmission("confirmed-outbox");

        assertEquals(1, publisher.publishPending());
        Message message = rabbitTemplate.receive(RabbitExecutionConfiguration.EXECUTION_QUEUE, 5000);

        assertNotNull(message);
        JsonNode body = objectMapper.readTree(message.getBody());
        assertEquals(1, body.size());
        assertEquals(admission.executionId().toString(), body.get("executionId").stringValue());
        assertEquals(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT,
                message.getMessageProperties().getReceivedDeliveryMode());
        assertEquals("application/json", message.getMessageProperties().getContentType());
        assertEquals(admission.executionId().toString(), message.getMessageProperties().getMessageId());
        assertEquals("confirmed-outbox", message.getMessageProperties().getHeaders()
                .get(RabbitExecutionConfiguration.CORRELATION_ID_HEADER));
        assertEquals("confirmed-outbox", message.getMessageProperties().getCorrelationId());
        assertEquals(OutboxStatus.PUBLISHED.name(), jdbc.queryForObject(
                "select status from workflow.outbox_events where aggregate_id = ?", String.class,
                admission.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ?", Integer.class,
                admission.executionId()));
    }

    @Test
    void admissionCommitsWhileRabbitIsDownAndThePublisherDeliversAfterRecovery() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, "broker-recovery", null));
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, workflow.getName(), null,
                new WorkflowDefinition("1.0", List.of(
                        new WorkflowDefinition.Node("manual-recovery", "trigger.manual", Map.of())),
                        List.of(), Map.of()), Map.of());
        publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);

        assertEquals(0, rabbitContainer.execInContainer("rabbitmqctl", "stop_app").getExitCode());
        var admission = admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID,
                Map.of("source", "broker-down"), "broker-independent-admission", null);
        assertEquals(OutboxStatus.PENDING.name(), jdbc.queryForObject(
                "select status from workflow.outbox_events where aggregate_id = ?", String.class,
                admission.executionId()));
        assertEquals(ExecutionStatus.QUEUED.name(), jdbc.queryForObject(
                "select status from workflow.workflow_executions where id = ?", String.class,
                admission.executionId()));

        assertEquals(0, rabbitContainer.execInContainer("rabbitmqctl", "start_app").getExitCode());
        assertEquals(1, publisher.publishPending());
        assertEquals(admission.executionId().toString(), receiveExecutionId());
    }

    @Test
    void crashAfterRabbitConfirmCanDuplicateTheMessageButKeepsOneExecutionIdentity() throws Exception {
        var admission = manualAdmission("crash-window");
        UUID leaseToken = UUID.randomUUID();
        Instant claimedAt = Instant.now();
        var claimed = outboxEvents.claimPending(leaseToken, claimedAt, claimedAt.plusSeconds(30), 1).getFirst();
        CorrelationData firstSend = new CorrelationData(claimed.getId().toString());
        byte[] executionMessage = objectMapper.writeValueAsBytes(
                Map.of("executionId", admission.executionId().toString()));
        rabbitTemplate.convertAndSend(RabbitExecutionConfiguration.EXECUTION_EXCHANGE,
                RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY, executionMessage, message -> {
                    message.getMessageProperties().setDeliveryMode(
                            org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
                    message.getMessageProperties().setContentType("application/json");
                    return message;
                }, firstSend);
        CorrelationData.Confirm confirm = firstSend.getFuture().get(5, TimeUnit.SECONDS);
        assertTrue(confirm.ack());
        assertNull(firstSend.getReturned());
        assertEquals(admission.executionId().toString(), receiveExecutionId());

        // Model process death after routed confirm and before mark-published.
        jdbc.update("update workflow.outbox_events set publisher_lease_until = ? where id = ?",
                Timestamp.from(Instant.now().minusSeconds(1)), claimed.getId());
        assertEquals(1, publisher.publishPending());

        assertEquals(admission.executionId().toString(), receiveExecutionId());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ?", Integer.class,
                admission.executionId()));
        assertEquals(OutboxStatus.PUBLISHED.name(), jdbc.queryForObject(
                "select status from workflow.outbox_events where id = ?", String.class, claimed.getId()));
    }

    @Test
    void anUnroutableReturnKeepsTheOutboxPendingUntilRoutingIsRestored() throws Exception {
        var admission = manualAdmission("unroutable-message");
        Binding binding = BindingBuilder.bind(new Queue(RabbitExecutionConfiguration.EXECUTION_QUEUE))
                .to(new DirectExchange(RabbitExecutionConfiguration.EXECUTION_EXCHANGE))
                .with(RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY);
        rabbitAdmin.removeBinding(binding);
        try {
            assertEquals(0, publisher.publishPending());
            assertEquals(OutboxStatus.PENDING.name(), jdbc.queryForObject(
                    "select status from workflow.outbox_events where aggregate_id = ?", String.class,
                    admission.executionId()));
            assertTrue(jdbc.queryForObject(
                    "select next_attempt_at > created_at from workflow.outbox_events where aggregate_id = ?",
                    Boolean.class, admission.executionId()));

            rabbitAdmin.declareBinding(binding);
            jdbc.update("update workflow.outbox_events set next_attempt_at = ? where aggregate_id = ?",
                    Timestamp.from(Instant.now().minusSeconds(1)), admission.executionId());
            assertEquals(1, publisher.publishPending());
            assertEquals(admission.executionId().toString(), receiveExecutionId());
        } finally {
            rabbitAdmin.declareBinding(binding);
        }
    }

    @Test
    void publisherNackAndConfirmTimeoutScheduleRetryWithoutChangingExecutionAttempts() throws Exception {
        var admission = manualAdmission("publisher-retry");
        OutboxEventRepository repository = mock(OutboxEventRepository.class);
        WorkflowExecutionRepository executionRepository = mock(WorkflowExecutionRepository.class);
        RabbitTemplate template = mock(RabbitTemplate.class);
        Instant now = Instant.parse("2026-09-21T10:00:00Z");
        UUID leaseToken = UUID.randomUUID();
        var pending = outboxEvents.findPending(1000).stream()
                .filter(event -> event.getAggregateId().equals(admission.executionId())).findFirst().orElseThrow();
        when(repository.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenAnswer(invocation -> List.of(pending.claim(invocation.getArgument(0), invocation.getArgument(2))));
        when(executionRepository.findById(admission.executionId()))
                .thenReturn(executions.findById(admission.executionId()));
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(4);
            correlation.getFuture().complete(new CorrelationData.Confirm(false, "nack"));
            return null;
        }).when(template).convertAndSend(anyString(), anyString(), any(), any(), any(CorrelationData.class));

        ExecutionOutboxPublisher nackPublisher = new ExecutionOutboxPublisher(
                repository, executionRepository, template, objectMapper, Clock.fixed(now, java.time.ZoneOffset.UTC),
                5, Duration.ofSeconds(30), Duration.ofMillis(50), Duration.ofSeconds(60));
        assertEquals(0, nackPublisher.publishPending());
        verify(repository).scheduleRetry(eq(pending.getId()), any(UUID.class), eq(now), any(Instant.class));

        when(repository.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenAnswer(invocation -> List.of(pending.claim(invocation.getArgument(0), invocation.getArgument(2))));
        org.mockito.Mockito.reset(template);
        org.mockito.Mockito.reset(repository);
        when(repository.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenAnswer(invocation -> List.of(pending.claim(invocation.getArgument(0), invocation.getArgument(2))));
        when(executionRepository.findById(admission.executionId()))
                .thenReturn(executions.findById(admission.executionId()));
        ExecutionOutboxPublisher timeoutPublisher = new ExecutionOutboxPublisher(
                repository, executionRepository, template, objectMapper, Clock.fixed(now, java.time.ZoneOffset.UTC),
                5, Duration.ofSeconds(30), Duration.ofMillis(10), Duration.ofSeconds(60));
        assertEquals(0, timeoutPublisher.publishPending());
        verify(repository).scheduleRetry(eq(pending.getId()), any(UUID.class), eq(now), any(Instant.class));
        assertEquals(0, jdbc.queryForObject(
                "select attempt_count from workflow.node_executions where execution_id = ?", Integer.class,
                admission.executionId()));
    }

    private String receiveExecutionId() throws Exception {
        Message message = rabbitTemplate.receive(RabbitExecutionConfiguration.EXECUTION_QUEUE, 5000);
        assertNotNull(message);
        JsonNode body = objectMapper.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
        return body.get("executionId").stringValue();
    }

    private ExecutionAdmissionPort.Admission manualAdmission(String marker) {
        UUID workspaceId = UUID.randomUUID();
        Workflow workflow = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, marker, null));
        draftService.save(workspaceId, workflow.getId(), ACTOR_ID, marker, null,
                new WorkflowDefinition("1.0", List.of(
                        new WorkflowDefinition.Node("manual-" + marker, "trigger.manual", Map.of())),
                        List.of(), Map.of("marker", marker)), Map.of());
        publicationService.publish(workspaceId, workflow.getId(), ACTOR_ID);
        return admissionService.manual(workspaceId, workflow.getId(), ACTOR_ID, Map.of(), marker, null);
    }
}
