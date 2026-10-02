package com.weav.identity.infrastructure.messaging.notification;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.notification.IdentitySecurityEventType;
import com.weav.identity.application.notification.IdentitySecurityNotificationRecorder;
import com.weav.identity.application.port.out.TransactionRunner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory.ConfirmType;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/** Real PostgreSQL and RabbitMQ publisher checks; all rows and messages are disposable. */
@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(properties = {
        "weav.oauth.enabled=false",
        "weav.identity.notification-outbox.publisher-enabled=true",
        "weav.identity.notification-outbox.batch-size=10",
        "weav.identity.notification-outbox.poll-interval=60000",
        "weav.identity.notification-outbox.initial-delay=60000"
})
class IdentityNotificationOutboxPublisherIntegrationTest {

    private static final String EXCHANGE = "weav.events";

    @Container
    private static final RabbitMQContainer rabbit = new RabbitMQContainer(
            DockerImageName.parse("rabbitmq:3.13-management-alpine"));

    @Autowired private JdbcTemplate jdbc;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private RabbitAdmin rabbitAdmin;
    @Autowired private IdentityNotificationOutboxPublisher publisher;
    @Autowired private IdentitySecurityNotificationRecorder recorder;
    @Autowired private TransactionRunner transactionRunner;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private ObjectMapper objectMapper;

    @DynamicPropertySource
    static void rabbitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
        registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
        registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
        registry.add("spring.rabbitmq.virtual-host", () -> "/");
        registry.add("NOTIFICATION_EXCHANGE", () -> EXCHANGE);
    }

    @BeforeEach
    void cleanOutbox() {
        jdbc.update("delete from identity.notification_outbox");
    }

    @Test
    void confirmsPersistentMessageBeforeMarkingStoredEnvelopePublished() throws Exception {
        String queue = declareQueue(IdentitySecurityEventType.PASSWORD_CHANGED.eventType());
        UUID userId = UUID.randomUUID();
        UUID eventId = append(IdentitySecurityEventType.PASSWORD_CHANGED, userId);
        String storedPayload = payload(eventId);

        assertThat(publisher.publishPending()).isEqualTo(1);

        assertThat(publishedAt(eventId)).isNotNull();
        Message received = rabbitTemplate.receive(queue, 2_000);
        assertThat(received).isNotNull();
        assertThat(received.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
        assertThat(received.getMessageProperties().getReceivedDeliveryMode())
                .isEqualTo(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
        assertThat(objectMapper.readTree(received.getBody())).isEqualTo(objectMapper.readTree(storedPayload));
    }

    @Test
    void unroutableMessageStaysPendingThenReplaysTheSameIdAndPayloadAfterBindingRecovery() throws Exception {
        String queue = declareQueue(null);
        UUID eventId = append(IdentitySecurityEventType.PASSWORD_RESET, UUID.randomUUID());
        String storedPayload = payload(eventId);

        assertThat(publisher.publishPending()).isZero();
        assertRetryState(eventId, "unroutable", storedPayload);
        assertThat(rabbitTemplate.receive(queue, 100)).isNull();

        bind(queue, IdentitySecurityEventType.PASSWORD_RESET.eventType());
        makeDue(eventId);
        assertThat(publisher.publishPending()).isEqualTo(1);
        assertThat(publishedAt(eventId)).isNotNull();
        Message replay = rabbitTemplate.receive(queue, 2_000);
        assertThat(replay.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
        assertThat(objectMapper.readTree(replay.getBody())).isEqualTo(objectMapper.readTree(storedPayload));
    }

    @Test
    void brokerDowntimeLeavesDurableRowPendingAndNormalPublisherRecoversIt() throws Exception {
        String queue = declareQueue(IdentitySecurityEventType.GOOGLE_LINKED.eventType());
        UUID eventId = append(IdentitySecurityEventType.GOOGLE_LINKED, UUID.randomUUID());
        String storedPayload = payload(eventId);
        CachingConnectionFactory unavailableConnection = new CachingConnectionFactory("127.0.0.1", 1);
        unavailableConnection.setConnectionTimeout(500);
        unavailableConnection.setPublisherConfirmType(ConfirmType.CORRELATED);
        unavailableConnection.setPublisherReturns(true);
        try {
            RabbitTemplate unavailableTemplate = new RabbitTemplate(unavailableConnection);
            unavailableTemplate.setMandatory(true);
            unavailableTemplate.setReturnsCallback(returned -> {});
            IdentityNotificationOutboxPublisher offlinePublisher = new IdentityNotificationOutboxPublisher(
                    jdbc, unavailableTemplate, transactionManager, "identity", EXCHANGE,
                    10, Duration.ofSeconds(1), Duration.ofSeconds(60), 1000, 1000);

            assertThat(offlinePublisher.publishPending()).isZero();
            assertRetryState(eventId, "transport-failed", storedPayload);

            makeDue(eventId);
            assertThat(publisher.publishPending()).isEqualTo(1);
            Message recovered = rabbitTemplate.receive(queue, 2_000);
            assertThat(recovered.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
            assertThat(objectMapper.readTree(recovered.getBody())).isEqualTo(objectMapper.readTree(storedPayload));
            assertThat(publishedAt(eventId)).isNotNull();
        } finally {
            unavailableConnection.destroy();
        }
    }

    @Test
    void concurrentPublishersLockOneOutboxRowAndSendOnlyOneMessage() throws Exception {
        String queue = declareQueue(IdentitySecurityEventType.GOOGLE_UNLINKED.eventType());
        UUID eventId = append(IdentitySecurityEventType.GOOGLE_UNLINKED, UUID.randomUUID());
        IdentityNotificationOutboxPublisher secondPublisher = new IdentityNotificationOutboxPublisher(
                jdbc, rabbitTemplate, transactionManager, "identity", EXCHANGE,
                10, Duration.ofSeconds(5), Duration.ofSeconds(60), 1000, 1000);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Integer> first = executor.submit(() -> {
                start.await();
                return publisher.publishPending();
            });
            Future<Integer> second = executor.submit(() -> {
                start.await();
                return secondPublisher.publishPending();
            });
            start.countDown();

            assertThat(first.get(10, TimeUnit.SECONDS) + second.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            Message message = rabbitTemplate.receive(queue, 2_000);
            assertThat(message).isNotNull();
            assertThat(message.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
            assertThat(rabbitTemplate.receive(queue, 300)).isNull();
            assertThat(publishedAt(eventId)).isNotNull();
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void publishesAWholeClaimedBatchWithOneClaimAndOneSettleTransaction() {
        String routingKey = IdentitySecurityEventType.PASSWORD_CHANGED.eventType();
        String queue = declareQueue(routingKey);
        for (int i = 0; i < 3; i++) {
            jdbc.update("insert into identity.notification_outbox (event_id, event_type, payload) "
                    + "values (?, ?, cast('{}' as jsonb))", UUID.randomUUID(), routingKey);
        }

        assertThat(publisher.publishPending()).isEqualTo(3);

        assertThat(jdbc.queryForObject(
                "select count(*) from identity.notification_outbox where published_at is not null",
                Integer.class)).isEqualTo(3);
        for (int i = 0; i < 3; i++) {
            assertThat(rabbitTemplate.receive(queue, 2_000)).isNotNull();
        }
        assertThat(publisher.publishPending()).isZero();
    }

    private String declareQueue(String routingKey) {
        rabbitAdmin.declareExchange(new TopicExchange(EXCHANGE, true, false));
        String queue = "identity-outbox-test-" + UUID.randomUUID();
        rabbitAdmin.declareQueue(new Queue(queue, false, false, false));
        if (routingKey != null) {
            bind(queue, routingKey);
        }
        return queue;
    }

    private void bind(String queue, String routingKey) {
        rabbitAdmin.declareBinding(BindingBuilder.bind(new Queue(queue, false, false, false))
                .to(new TopicExchange(EXCHANGE, true, false)).with(routingKey));
    }

    private UUID append(IdentitySecurityEventType type, UUID userId) {
        transactionRunner.required(() -> {
            recorder.record(type, userId);
            return null;
        });
        return jdbc.queryForObject(
                "select event_id from identity.notification_outbox where event_type = ?",
                UUID.class,
                type.eventType());
    }

    private String payload(UUID eventId) {
        return jdbc.queryForObject(
                "select payload::text from identity.notification_outbox where event_id = ?",
                String.class,
                eventId);
    }

    private java.time.OffsetDateTime publishedAt(UUID eventId) {
        return jdbc.queryForObject(
                "select published_at from identity.notification_outbox where event_id = ?",
                java.time.OffsetDateTime.class,
                eventId);
    }

    private void makeDue(UUID eventId) {
        jdbc.update("update identity.notification_outbox set next_attempt_at = current_timestamp where event_id = ?",
                eventId);
    }

    private void assertRetryState(UUID eventId, String failureCode, String originalPayload) {
        var row = jdbc.queryForMap("select published_at, attempts, last_failure_code, payload::text as payload "
                + "from identity.notification_outbox where event_id = ?", eventId);
        assertThat(row.get("published_at")).isNull();
        assertThat(row.get("attempts")).isEqualTo(1);
        assertThat(row.get("last_failure_code")).isEqualTo(failureCode);
        assertThat((String) row.get("payload")).isEqualTo(originalPayload);
    }
}
