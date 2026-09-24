package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.in.ExecutionRunner;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.infrastructure.scheduling.ExecutionRecoveryScanner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Real PostgreSQL/RabbitMQ recovery and worker-handoff tests. */
@SpringBootTest(properties = {
        "weav.workflow.execution.worker.enabled=true",
        "weav.workflow.execution.worker.owner=task10-recovery-test",
        "weav.workflow.execution.worker.lease-duration=PT60S",
        "weav.workflow.execution.worker.transient-redelivery-delay=5000",
        "weav.workflow.execution.worker.max-transient-redeliveries=3",
        "weav.workflow.execution.recovery.initial-delay=3600000",
        "weav.workflow.execution.recovery.poll-interval=3600000",
        "weav.workflow.execution.recovery.batch-size=20",
        "weav.workflow.execution.recovery.queued-delivery-age=PT1M",
        "weav.workflow.execution.recovery.outbox-cooldown=PT1M",
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import({WorkflowPublicationTestConfiguration.class, ExecutionRecoveryTest.RunnerConfiguration.class})
class ExecutionRecoveryTest {
    private static final String DEFINITION = """
            {"schemaVersion":"1.0","nodes":[
              {"id":"root","type":"trigger.manual","config":{}},
              {"id":"action","type":"action.telegram","config":{}}],
             "edges":[{"id":"root-action","source":"root","target":"action"}],"variables":{}}
            """;

    @Autowired
    private ExecutionRecoveryScanner recovery;
    @Autowired
    private ExecutionOutboxPublisher publisher;
    @Autowired
    private RabbitTemplate rabbitTemplate;
    @Autowired
    private ExecutionJobListener listener;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private WorkerProbe probe;
    @Autowired
    private RabbitAdmin rabbitAdmin;
    @BeforeEach
    void clearDeliveryQueues() {
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
        probe.clear();
    }

    @AfterEach
    void clearDeliveryQueuesAfterTest() {
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
        probe.clear();
    }

    @Test
    void workerListenerCanConsumeWhileThePublisherReceivesARoutedConfirm() throws Exception {
        UUID missingExecutionId = UUID.randomUUID();
        CorrelationData correlation = new CorrelationData(UUID.randomUUID().toString());
        rabbitTemplate.convertAndSend(RabbitExecutionConfiguration.EXECUTION_EXCHANGE,
                RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY,
                objectMapper.writeValueAsBytes(Map.of("executionId", missingExecutionId.toString())), correlation);

        CorrelationData.Confirm confirm = correlation.getFuture().get(5, TimeUnit.SECONDS);

        assertTrue(confirm.ack());
        assertNull(correlation.getReturned());
    }

    @Test
    void scannerRecoversOldQueuedWorkAndAcknowledgedWorkAfterItsLeaseExpires() throws Exception {
        Fixture fixture = fixture();

        assertEquals(1, recovery.scanNow());
        assertEquals(0, recovery.scanNow(), "an outbox event inside the cooldown prevents replica duplication");
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.outbox_events where aggregate_id = ? and status = 'PENDING'",
                Integer.class, fixture.executionId()));
        int firstPublishCount = publisher.publishPending();
        Delivery first = probe.awaitDelivery();
        assertEquals(1, firstPublishCount,
                "the outbox message reached the listener but was not recorded as positively confirmed");
        assertEquals(fixture.executionId(), first.lease().executionId());
        assertEquals(1L, first.lease().token());
        assertEquals(fixture.workflowId(), first.snapshot().workflowId());
        assertEquals(Map.of("recovered", true), first.snapshot().input());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ? and status = 'RUNNING' "
                        + "and lease_owner = 'task10-recovery-test' and lease_token = 1 "
                        + "and lease_until > CURRENT_TIMESTAMP",
                Integer.class, fixture.executionId()));

        UUID attemptId = UUID.randomUUID();
        jdbc.update("update workflow.workflow_executions set lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' "
                + "where id = ?", fixture.executionId());
        jdbc.update("update workflow.node_executions set status = 'RUNNING', attempt_count = 1, "
                + "started_at = CURRENT_TIMESTAMP where execution_id = ? and node_id = 'action'",
                fixture.executionId());
        jdbc.update("insert into workflow.node_execution_attempts "
                        + "(id, node_execution_id, attempt_number, status, input, started_at, created_at) "
                        + "select ?, id, 1, 'RUNNING', cast('{}' as jsonb), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
                        + "from workflow.node_executions where execution_id = ? and node_id = 'action'",
                attemptId, fixture.executionId());
        jdbc.update("update workflow.outbox_events set created_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes' "
                + "where aggregate_id = ?", fixture.executionId());

        assertEquals(1, recovery.scanNow());
        assertEquals(1, publisher.publishPending());
        Delivery takeover = probe.awaitDelivery();
        assertEquals(2L, takeover.lease().token());
        assertEquals(com.weav.workflow.domain.valueobject.NodeExecutionStatus.WAITING,
                takeover.snapshot().nodes().get("action").getStatus());
        assertEquals(1, takeover.snapshot().nodes().get("action").getAttemptCount());
        assertNotNull(takeover.snapshot().nextAttempts().get("action"));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_execution_attempts where id = ? and status = 'FAILED' "
                        + "and finished_at is not null and error ->> 'code' = 'WORKER_INTERRUPTED'",
                Integer.class, attemptId));
        assertTrue(jdbc.queryForObject(
                "select next_attempt_at > CURRENT_TIMESTAMP from workflow.node_executions "
                        + "where execution_id = ? and node_id = 'action'", Boolean.class, fixture.executionId()));

    }

    @Test
    void malformedUuidOnlyEnvelopeIsRejectedToTheConfiguredDeadLetterQueue() throws Exception {
        var channel = mock(com.rabbitmq.client.Channel.class);
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(77L);
        Message malformed = new Message(objectMapper.writeValueAsBytes(Map.of(
                "executionId", UUID.randomUUID().toString(), "input", Map.of("secret", "not-allowed"))), properties);

        listener.onMessage(malformed, channel);

        verify(channel).basicReject(77L, false);
    }

    @Test
    void malformedBrokerDeliveryIsActuallyDeadLetteredByRabbit() throws Exception {
        byte[] invalidBody = objectMapper.writeValueAsBytes(Map.of(
                "executionId", UUID.randomUUID().toString(), "input", Map.of("private", "value")));
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryMode(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
        CorrelationData correlation = new CorrelationData(UUID.randomUUID().toString());
        Message invalid = new Message(invalidBody, properties);

        rabbitTemplate.send(RabbitExecutionConfiguration.EXECUTION_EXCHANGE,
                RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY, invalid, correlation);
        CorrelationData.Confirm confirm = correlation.getFuture().get(5, TimeUnit.SECONDS);
        Message deadLetter = rabbitTemplate.receive(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, 5000);

        assertTrue(confirm.ack());
        assertNull(correlation.getReturned());
        assertNotNull(deadLetter);
        assertEquals(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT,
                deadLetter.getMessageProperties().getReceivedDeliveryMode());
        JsonNode deadLetterBody = objectMapper.readTree(deadLetter.getBody());
        assertEquals(2, deadLetterBody.size());
        assertEquals("value", deadLetterBody.get("input").get("private").stringValue());
    }

    @Test
    void terminalDuplicateIsAcknowledgedWithoutCallingTheRunner() throws Exception {
        Fixture fixture = fixture();
        jdbc.update("update workflow.workflow_executions set status = 'SUCCESS', "
                        + "finished_at = CURRENT_TIMESTAMP where id = ?",
                fixture.executionId());
        var channel = mock(com.rabbitmq.client.Channel.class);
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(78L);
        Message duplicate = new Message(objectMapper.writeValueAsBytes(
                Map.of("executionId", fixture.executionId().toString())), properties);

        listener.onMessage(duplicate, channel);

        verify(channel).basicAck(78L, false);
        assertTrue(probe.deliveries.isEmpty());
        assertEquals("SUCCESS", jdbc.queryForObject(
                "select status from workflow.workflow_executions where id = ?", String.class,
                fixture.executionId()));
    }

    @Test
    void transientDatabaseFailureIsRepublishedToTheDurableDelayedQueueBeforeAck() throws Exception {
        ExecutionStatePort unavailableState = mock(ExecutionStatePort.class);
        ExecutionRunner unusedRunner = mock(ExecutionRunner.class);
        when(unavailableState.claim(any(UUID.class), anyString(), any(Duration.class)))
                .thenThrow(new TransientDataAccessResourceException("database unavailable"));
        ExecutionJobListener retryingListener = new ExecutionJobListener(unavailableState, unusedRunner,
                rabbitTemplate, objectMapper, "task10-transient-test", Duration.ofSeconds(60),
                Duration.ofSeconds(5), 3);
        UUID executionId = UUID.randomUUID();
        var channel = mock(com.rabbitmq.client.Channel.class);
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(79L);
        Message original = new Message(objectMapper.writeValueAsBytes(
                Map.of("executionId", executionId.toString())), properties);

        retryingListener.onMessage(original, channel);

        verify(channel).basicAck(79L, false);
        verifyNoInteractions(unusedRunner);
        Message delayed = rabbitTemplate.receive(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, 5000);
        assertNotNull(delayed);
        assertEquals(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT,
                delayed.getMessageProperties().getReceivedDeliveryMode());
        JsonNode body = objectMapper.readTree(delayed.getBody());
        assertEquals(1, body.size());
        assertEquals(executionId.toString(), body.get("executionId").stringValue());
        assertEquals(1, delayed.getMessageProperties().getHeaders()
                .get(ExecutionWorkerRabbitConfiguration.REDELIVERY_COUNT_HEADER));
    }

    @Test
    void shutdownStopsNewClaimsAndRequeuesUnstartedDeliveries() throws Exception {
        ExecutionStatePort unusedState = mock(ExecutionStatePort.class);
        ExecutionRunner unusedRunner = mock(ExecutionRunner.class);
        ExecutionJobListener stopped = new ExecutionJobListener(unusedState, unusedRunner, rabbitTemplate,
                objectMapper, "task10-shutdown-test", Duration.ofSeconds(60), Duration.ofSeconds(5), 3);
        stopped.stopAdmission();
        var channel = mock(com.rabbitmq.client.Channel.class);
        MessageProperties properties = new MessageProperties();
        properties.setDeliveryTag(80L);
        Message message = new Message(objectMapper.writeValueAsBytes(Map.of(
                "executionId", UUID.randomUUID().toString())), properties);

        stopped.onMessage(message, channel);

        verify(channel).basicNack(80L, false, true);
        verifyNoInteractions(unusedState, unusedRunner);
    }

    private Fixture fixture() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID triggerNodeId = UUID.randomUUID();
        UUID actionNodeId = UUID.randomUUID();
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by) "
                        + "values (?, ?, 'Recovery fixture', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                workflowId, workspaceId, DEFINITION, actorId);
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                versionId, workflowId, DEFINITION, actorId);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", versionId, workflowId);
        jdbc.update("insert into workflow.workflow_executions "
                        + "(id, workflow_id, workflow_version_id, status, trigger_type, triggered_by, root_node_id, "
                        + "input, edge_states, created_at) values (?, ?, ?, 'QUEUED', 'MANUAL', ?, 'root', "
                        + "cast('{\"recovered\":true}' as jsonb), cast('{\"root-action\":\"UNKNOWN\"}' as jsonb), "
                        + "CURRENT_TIMESTAMP - INTERVAL '10 minutes')",
                executionId, workflowId, versionId, actorId);
        jdbc.update("insert into workflow.node_executions "
                        + "(id, execution_id, node_id, node_type, status, attempt_count, created_at) "
                        + "values (?, ?, 'root', 'trigger.manual', 'PENDING', 0, CURRENT_TIMESTAMP), "
                        + "(?, ?, 'action', 'action.telegram', 'PENDING', 0, CURRENT_TIMESTAMP)",
                triggerNodeId, executionId, actionNodeId, executionId);
        return new Fixture(workspaceId, workflowId, versionId, executionId);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RunnerConfiguration {
        @Bean
        WorkerProbe workerProbe() {
            return new WorkerProbe();
        }

        @Bean
        @Primary
        ExecutionRunner testExecutionRunner(ExecutionStatePort state, WorkerProbe probe) {
            return lease -> probe.record(lease, state.load(lease));
        }
    }

    static final class WorkerProbe {
        private final LinkedBlockingQueue<Delivery> deliveries = new LinkedBlockingQueue<>();

        void record(ExecutionStatePort.Lease lease, ExecutionStatePort.Snapshot snapshot) {
            deliveries.add(new Delivery(lease, snapshot));
        }

        Delivery awaitDelivery() throws InterruptedException {
            Delivery delivery = deliveries.poll(10, TimeUnit.SECONDS);
            assertNotNull(delivery, "the Rabbit listener did not call the real execution handoff boundary");
            return delivery;
        }

        void clear() {
            deliveries.clear();
        }
    }

    private record Delivery(ExecutionStatePort.Lease lease, ExecutionStatePort.Snapshot snapshot) {
    }

    private record Fixture(UUID workspaceId, UUID workflowId, UUID versionId, UUID executionId) {
    }
}
