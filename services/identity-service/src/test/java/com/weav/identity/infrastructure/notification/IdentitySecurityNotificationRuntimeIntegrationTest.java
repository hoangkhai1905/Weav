package com.weav.identity.infrastructure.notification;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.dto.OAuthAccountMetadata;
import com.weav.identity.application.dto.ResetPasswordCommand;
import com.weav.identity.application.notification.NotificationOutboxWriteException;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.usecase.ChangePasswordUseCase;
import com.weav.identity.application.usecase.LinkGoogleAccountUseCase;
import com.weav.identity.application.usecase.ResetPasswordUseCase;
import com.weav.identity.application.usecase.UnlinkOAuthAccountUseCase;
import com.weav.identity.application.validation.OtpFingerprintPolicy;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.messaging.notification.IdentityNotificationOutboxPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/** Exercises actual Identity mutations through the compiled Notification consumer and inbox. */
@Testcontainers
@Import({TestcontainersConfiguration.class, IdentitySecurityNotificationRuntimeIntegrationTest.GrantFixtureConfiguration.class})
@SpringBootTest(properties = {
        "weav.oauth.enabled=false",
        "weav.identity.notification-outbox.publisher-enabled=false",
        "weav.otp.hmac-secret=task6-only-integration-hmac-key-0123456789"
})
class IdentitySecurityNotificationRuntimeIntegrationTest {

    private static final String EXCHANGE = "weav.events";
    private static final String INITIAL_PASSWORD = "Task6-initial-password-123!";
    private static final String CHANGED_PASSWORD = "Task6-changed-password-456!";
    private static final String RESET_PASSWORD = "Task6-reset-password-789!";
    private static final String JWT_TEST_SECRET = "task6-only-not-a-production-secret-0123456789";
    private static final String FAIL_FUNCTION = "identity.fail_task6_outbox_insert";
    private static final String FAIL_TRIGGER = "task6_fail_notification_outbox_insert";

    @Container
    private static final RabbitMQContainer rabbit = new RabbitMQContainer(
            DockerImageName.parse("rabbitmq:3.13-management-alpine"));

    @Autowired private PostgreSQLContainer postgres;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private TransactionRunner transactionRunner;
    @Autowired private PasswordHasher passwordHasher;
    @Autowired private KeyedFingerprint fingerprint;
    @Autowired private UserRepository userRepository;
    @Autowired private UserSessionRepository sessionRepository;
    @Autowired private OAuthAccountRepository oauthAccountRepository;
    @Autowired private ChangePasswordUseCase changePassword;
    @Autowired private ResetPasswordUseCase resetPassword;
    @Autowired private LinkGoogleAccountUseCase linkGoogleAccount;
    @Autowired private UnlinkOAuthAccountUseCase unlinkOAuthAccount;
    @Autowired private OneUseGrantStore grantStore;
    @Autowired private ObjectMapper objectMapper;

    @DynamicPropertySource
    static void rabbitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
        registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
        registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
        registry.add("spring.rabbitmq.virtual-host", () -> "/");
    }

    @BeforeEach
    void clearOutboxAndAnyPriorFailureTrigger() {
        removeOutboxFailureTrigger();
        jdbc.update("delete from identity.notification_outbox");
    }

    @AfterEach
    void removeFailureTriggerAfterTest() {
        removeOutboxFailureTrigger();
    }

    @Test
    void allFourSuccessfulSecurityMutationsReachOnlyTheAuthenticatedOwnerInboxAndReplayDeduplicates()
            throws Exception {
        TestIdentity owner = createIdentity("owner", INITIAL_PASSWORD, true);
        TestIdentity other = createIdentity("other", INITIAL_PASSWORD, false);
        RuntimeBridge bridge = startNotificationBridge(owner.userId(), other.userId());
        try {
            changePassword.execute(owner.userId(), owner.firstSessionId(),
                    new ChangePasswordCommand(INITIAL_PASSWORD, CHANGED_PASSWORD));
            assertThat(isSessionActive(owner.firstSessionId())).isFalse();

            UUID secondSession = createSession(owner.userId());
            String grant = installResetGrant(owner.userId());
            resetPassword.execute(new ResetPasswordCommand(grant, RESET_PASSWORD));
            assertThat(isSessionActive(secondSession)).isFalse();

            UUID thirdSession = createSession(owner.userId());
            LinkGoogleAccountUseCase.LinkBinding binding =
                    linkGoogleAccount.initiate(owner.userId(), thirdSession, RESET_PASSWORD);
            OAuthAccountMetadata linked = linkGoogleAccount.complete(owner.userId(), thirdSession,
                    linkHandoff(owner, thirdSession, binding));
            assertThat(isSessionActive(thirdSession)).isTrue();

            unlinkOAuthAccount.execute(owner.userId(), thirdSession, linked.id(), RESET_PASSWORD);
            assertThat(isSessionActive(thirdSession)).isTrue();

            List<StoredEvent> storedEvents = loadStoredEvents();
            assertThat(storedEvents).hasSize(4);
            assertEnvelopes(storedEvents, owner.userId());

            IdentityNotificationOutboxPublisher publisher = publisher();
            assertThat(publisher.publishPending()).isEqualTo(4);
            awaitInbox(bridge, owner.userId(), 4);

            JsonNode ownerInbox = inbox(bridge, owner.userId());
            JsonNode otherInbox = inbox(bridge, other.userId());
            assertThat(otherInbox.path("items").size()).isZero();
            assertThat(eventTypes(ownerInbox)).containsExactlyInAnyOrder(
                    "identity.password_changed", "identity.password_reset",
                    "identity.google_linked", "identity.google_unlinked");
            ownerInbox.path("items").forEach(item ->
                    assertThat(item.path("target").path("kind").stringValue()).isEqualTo("SECURITY_SETTINGS"));
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_deliveries", null)).isZero();
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where user_id = ?", owner.userId()))
                    .isEqualTo(4);

            StoredEvent original = storedEvents.getFirst();
            jdbc.update("update identity.notification_outbox set published_at = null, "
                            + "next_attempt_at = current_timestamp, last_failure_code = null where event_id = ?",
                    original.eventId());
            assertThat(publisher.publishPending()).isEqualTo(1);
            awaitQueueEmpty(bridge);
            assertThat(inbox(bridge, owner.userId()).path("items").size()).isEqualTo(4);
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where user_id = ?", owner.userId()))
                    .isEqualTo(4);
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where source_event_id = ?",
                    original.eventId())).isEqualTo(1);
            assertThat(loadStoredEvents()).containsExactlyElementsOf(storedEvents);
        } finally {
            try {
                bridge.close();
            } finally {
                dropNotificationDatabase(bridge.databaseName());
            }
        }
    }

    @Test
    void failedPasswordChangeOutboxWriteRollsBackPasswordAndAllSessionRevocation() {
        TestIdentity identity = createIdentity("password-change-rollback", INITIAL_PASSWORD, true);
        installOutboxFailureTrigger();

        assertOutboxWriteFailure(() -> changePassword.execute(identity.userId(), identity.firstSessionId(),
                new ChangePasswordCommand(INITIAL_PASSWORD, CHANGED_PASSWORD)));

        assertPassword(identity.userId(), INITIAL_PASSWORD);
        assertThat(isSessionActive(identity.firstSessionId())).isTrue();
        assertNoOutboxRows();
    }

    @Test
    void failedResetOutboxWriteRollsBackPasswordVerificationAndSessionRevocationButConsumesGrant() {
        TestIdentity identity = createIdentity("password-reset-rollback", INITIAL_PASSWORD, true);
        String grant = installResetGrant(identity.userId());
        installOutboxFailureTrigger();

        assertOutboxWriteFailure(() -> resetPassword.execute(new ResetPasswordCommand(grant, RESET_PASSWORD)));

        assertPassword(identity.userId(), INITIAL_PASSWORD);
        assertThat(userRepository.findById(identity.userId()).orElseThrow().getEmailVerifiedAt()).isNull();
        assertThat(isSessionActive(identity.firstSessionId())).isTrue();
        assertThat(grantStore.consumeGrant(grant).consumed()).isFalse();
        assertNoOutboxRows();
    }

    @Test
    void failedGoogleLinkOutboxWriteRollsBackInsertedAccountAndVerification() {
        TestIdentity identity = createIdentity("google-link-rollback", INITIAL_PASSWORD, true);
        LinkGoogleAccountUseCase.LinkBinding binding =
                linkGoogleAccount.initiate(identity.userId(), identity.firstSessionId(), INITIAL_PASSWORD);
        installOutboxFailureTrigger();

        assertOutboxWriteFailure(() -> linkGoogleAccount.complete(identity.userId(), identity.firstSessionId(),
                linkHandoff(identity, identity.firstSessionId(), binding)));

        assertThat(oauthAccountRepository.findAllByUserId(identity.userId())).isEmpty();
        assertThat(userRepository.findById(identity.userId()).orElseThrow().getEmailVerifiedAt()).isNull();
        assertThat(isSessionActive(identity.firstSessionId())).isTrue();
        assertNoOutboxRows();
    }

    @Test
    void failedGoogleUnlinkOutboxWriteRollsBackOwnerScopedDeletion() {
        TestIdentity identity = createIdentity("google-unlink-rollback", INITIAL_PASSWORD, true);
        OAuthAccount saved = oauthAccountRepository.save(new OAuthAccount(
                UUID.randomUUID(), identity.userId(), OAuthProvider.GOOGLE,
                "synthetic-provider-subject-" + UUID.randomUUID(), identity.email(),
                Instant.now(), Instant.now()));
        installOutboxFailureTrigger();

        assertOutboxWriteFailure(() -> unlinkOAuthAccount.execute(identity.userId(), identity.firstSessionId(),
                saved.getId(), INITIAL_PASSWORD));

        assertThat(oauthAccountRepository.findByIdAndUserId(saved.getId(), identity.userId())).isPresent();
        assertThat(isSessionActive(identity.firstSessionId())).isTrue();
        assertNoOutboxRows();
    }

    private TestIdentity createIdentity(String label, String password, boolean withSession) {
        Instant now = Instant.now().minusSeconds(5);
        UUID userId = UUID.randomUUID();
        String email = label + "-" + userId.toString().replace("-", "") + "@example.test";
        User user = userRepository.save(new User(userId, email, passwordHasher.hash(password),
                "Task 6 test user", null, SystemRole.USER, UserStatus.ACTIVE, now, now));
        UUID sessionId = withSession ? createSession(user.getId()) : null;
        return new TestIdentity(user.getId(), email, password, sessionId);
    }

    private UUID createSession(UUID userId) {
        Instant now = Instant.now();
        return sessionRepository.save(new UserSession(
                UUID.randomUUID(), userId, UUID.randomUUID().toString().replace("-", ""),
                null, null, now.plus(Duration.ofDays(1)), now)).getId();
    }

    private String installResetGrant(UUID userId) {
        User user = userRepository.findById(userId).orElseThrow();
        String token = UUID.randomUUID().toString().replace("-", "") + "g".repeat(11);
        OtpChallengeStore.GrantConsumptionResult grant = new OtpChallengeStore.GrantConsumptionResult(
                true,
                OtpFingerprintPolicy.account(fingerprint, user.getEmail()),
                OtpChallengeStore.Purpose.PASSWORD_RESET,
                userId.toString(),
                OtpFingerprintPolicy.credential(fingerprint, user.getPasswordHash()));
        grantStore.setGrant(token, grant);
        return token;
    }

    private OAuthTransactionStore.Handoff linkHandoff(
            TestIdentity identity,
            UUID sessionId,
            LinkGoogleAccountUseCase.LinkBinding binding) {
        return new OAuthTransactionStore.Handoff(
                "h".repeat(43),
                "t".repeat(43),
                OAuthTransactionStore.Intent.LINK,
                "web",
                "web",
                "c".repeat(43),
                new OAuthProviderClient.ProviderIdentity(
                        OAuthProvider.GOOGLE,
                        "synthetic-google-subject-" + UUID.randomUUID(),
                        identity.email(),
                        true,
                        null,
                        Instant.now()),
                identity.userId(),
                sessionId,
                binding.credentialFingerprint(),
                Duration.ofSeconds(60),
                5);
    }

    private List<StoredEvent> loadStoredEvents() {
        return jdbc.query("select event_id, event_type, payload::text from identity.notification_outbox "
                        + "order by event_type, event_id",
                (resultSet, row) -> {
                    try {
                        return new StoredEvent(resultSet.getObject(1, UUID.class), resultSet.getString(2),
                                objectMapper.readTree(resultSet.getString(3)));
                    } catch (Exception exception) {
                        throw new IllegalStateException("Unable to read test outbox event", exception);
                    }
                });
    }

    private void assertEnvelopes(List<StoredEvent> events, UUID userId) {
        Set<String> expectedFields = Set.of("schemaVersion", "eventId", "eventType", "occurredAt",
                "producer", "actorUserId", "recipientUserIds", "workspaceId", "entity", "data");
        assertThat(events.stream().map(StoredEvent::eventType)).containsExactlyInAnyOrder(
                "identity.password_changed", "identity.password_reset",
                "identity.google_linked", "identity.google_unlinked");
        assertThat(events.stream().map(StoredEvent::eventId).collect(java.util.stream.Collectors.toSet()))
                .hasSize(4);
        for (StoredEvent stored : events) {
            JsonNode event = stored.payload();
            assertThat(event.size()).isEqualTo(expectedFields.size());
            expectedFields.forEach(field -> assertThat(event.has(field)).isTrue());
            assertThat(event.path("schemaVersion").intValue()).isEqualTo(2);
            assertThat(event.path("eventId").stringValue()).isEqualTo(stored.eventId().toString());
            assertThat(event.path("eventType").stringValue()).isEqualTo(stored.eventType());
            assertThat(event.path("occurredAt").stringValue()).contains("T").endsWith("Z");
            assertThat(event.path("producer").stringValue()).isEqualTo("identity-service");
            assertThat(event.path("recipientUserIds").size()).isEqualTo(1);
            assertThat(event.path("recipientUserIds").get(0).stringValue()).isEqualTo(userId.toString());
            assertThat(event.path("workspaceId").isNull()).isTrue();
            assertThat(event.path("entity").path("kind").stringValue()).isEqualTo("USER");
            assertThat(event.path("entity").path("id").stringValue()).isEqualTo(userId.toString());
            assertThat(event.path("data").size()).isZero();
            if (stored.eventType().equals("identity.password_reset")) {
                assertThat(event.path("actorUserId").isNull()).isTrue();
            } else {
                assertThat(event.path("actorUserId").stringValue()).isEqualTo(userId.toString());
            }
        }
    }

    private IdentityNotificationOutboxPublisher publisher() {
        return new IdentityNotificationOutboxPublisher(jdbc, rabbitTemplate, transactionManager,
                "identity", EXCHANGE, 10, Duration.ofSeconds(5), Duration.ofSeconds(60), 1000, 1000);
    }

    private void awaitInbox(RuntimeBridge bridge, UUID userId, int expected) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (System.nanoTime() < deadline) {
            if (inbox(bridge, userId).path("items").size() == expected) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Notification inbox did not reach the expected test state");
    }

    private void awaitQueueEmpty(RuntimeBridge bridge) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (System.nanoTime() < deadline) {
            Long messageCount = rabbitTemplate.execute(channel -> channel.messageCount(bridge.queueName()));
            if (messageCount != null && messageCount == 0) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Notification consumer did not drain the replayed test event");
    }

    private JsonNode inbox(RuntimeBridge bridge, UUID userId) throws Exception {
        String token = userId.equals(bridge.ownerId()) ? bridge.ownerToken() : bridge.memberToken();
        var request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(bridge.url()
                        + "/api/v2/notifications?limit=100&locale=en&category=SECURITY"))
                .timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        var response = java.net.http.HttpClient.newHttpClient().send(request,
                java.net.http.HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("Notification inbox returned HTTP " + response.statusCode());
        }
        return objectMapper.readTree(response.body());
    }

    private List<String> eventTypes(JsonNode page) {
        List<String> result = new ArrayList<>();
        page.path("items").forEach(item -> result.add(item.path("eventType").stringValue()));
        return result;
    }

    private RuntimeBridge startNotificationBridge(UUID ownerId, UUID memberId) throws Exception {
        String databaseName = "notification_task6_" + UUID.randomUUID().toString().replace("-", "");
        createNotificationDatabase(databaseName);
        Process process = null;
        try {
            Path identityDirectory = Path.of("").toAbsolutePath().normalize();
            Path repositoryRoot = identityDirectory.getParent().getParent();
            Path script = repositoryRoot.resolve("services/workspace-service/test/notification-runtime-bridge.cjs");
            Path notificationDirectory = repositoryRoot.resolve("services/notification-service");
            ProcessBuilder builder = new ProcessBuilder("node", script.toString())
                    .directory(notificationDirectory.toFile())
                    .redirectErrorStream(true);
            var environment = builder.environment();
            environment.put("DB_HOST", postgres.getHost());
            environment.put("DB_PORT", postgres.getMappedPort(5432).toString());
            environment.put("DB_NAME", databaseName);
            environment.put("DB_USERNAME", postgres.getUsername());
            environment.put("DB_PASSWORD", postgres.getPassword());
            environment.put("DB_SSL_MODE", "disable");
            environment.put("DB_SCHEMA", "notification");
            environment.put("JWT_ACCESS_SECRET", JWT_TEST_SECRET);
            environment.put("JWT_ISSUER", "weav-identity");
            environment.put("JWT_AUDIENCE", "weav-api");
            environment.put("RABBITMQ_HOST", rabbit.getHost());
            environment.put("RABBITMQ_PORT", rabbit.getAmqpPort().toString());
            environment.put("RABBITMQ_USERNAME", rabbit.getAdminUsername());
            environment.put("RABBITMQ_PASSWORD", rabbit.getAdminPassword());
            environment.put("RABBITMQ_VHOST", "/");
            environment.put("NOTIFICATION_EXCHANGE", EXCHANGE);
            String notificationQueue = "identity-task6-" + UUID.randomUUID();
            environment.put("NOTIFICATION_QUEUE", notificationQueue);
            environment.put("NOTIFICATION_DLQ", "identity-task6-dlq-" + UUID.randomUUID());
            environment.put("NOTIFICATION_TELEGRAM_ENABLED", "false");
            environment.put("NOTIFICATION_EXPO_ENABLED", "false");
            environment.put("TASK4_OWNER_ID", ownerId.toString());
            environment.put("TASK4_MEMBER_ID", memberId.toString());
            environment.put("NODE_PATH", notificationDirectory.resolve("node_modules").toString());

            process = builder.start();
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String readyLine;
            do {
                readyLine = CompletableFuture.supplyAsync(() -> {
                    try {
                        return reader.readLine();
                    } catch (Exception exception) {
                        throw new IllegalStateException(exception);
                    }
                }).get(60, TimeUnit.SECONDS);
                if (readyLine == null) {
                    throw new IllegalStateException("Notification runtime bridge exited before readiness");
                }
            } while (!readyLine.startsWith("TASK4_READY:"));
            JsonNode ready = objectMapper.readTree(readyLine.substring("TASK4_READY:".length()));
            return new RuntimeBridge(process, ready.path("url").stringValue(),
                    ready.path("ownerToken").stringValue(), ready.path("memberToken").stringValue(),
                    databaseName, notificationQueue, ownerId, memberId);
        } catch (Exception exception) {
            if (process != null) {
                process.destroyForcibly();
                process.waitFor(10, TimeUnit.SECONDS);
            }
            dropNotificationDatabase(databaseName);
            throw exception;
        }
    }

    private void createNotificationDatabase(String databaseName) throws Exception {
        try (Connection connection = DriverManager.getConnection(adminDatabaseUrl(),
                postgres.getUsername(), postgres.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("create database \"" + databaseName + "\"");
        }
    }

    private void dropNotificationDatabase(String databaseName) throws Exception {
        try (Connection connection = DriverManager.getConnection(adminDatabaseUrl(),
                postgres.getUsername(), postgres.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("drop database if exists \"" + databaseName + "\" with (force)");
        }
    }

    private String adminDatabaseUrl() {
        return postgres.getJdbcUrl().replace("/" + postgres.getDatabaseName(), "/postgres");
    }

    private Integer notificationDbScalar(String databaseName, String sql, UUID parameter) throws Exception {
        String url = postgres.getJdbcUrl().replace("/" + postgres.getDatabaseName(), "/" + databaseName);
        try (Connection connection = DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
             var statement = connection.prepareStatement(sql)) {
            if (parameter != null) {
                statement.setObject(1, parameter);
            }
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getInt(1);
            }
        }
    }

    private void installOutboxFailureTrigger() {
        jdbc.execute("create or replace function " + FAIL_FUNCTION + "() returns trigger "
                + "language plpgsql as $$ begin raise exception 'test-only outbox failure'; end $$");
        jdbc.execute("create trigger " + FAIL_TRIGGER + " before insert on identity.notification_outbox "
                + "for each row execute function " + FAIL_FUNCTION + "()");
    }

    private void removeOutboxFailureTrigger() {
        jdbc.execute("drop trigger if exists " + FAIL_TRIGGER + " on identity.notification_outbox");
        jdbc.execute("drop function if exists " + FAIL_FUNCTION + "()");
    }

    private void assertOutboxWriteFailure(Runnable mutation) {
        Throwable failure = catchThrowable(mutation::run);
        assertThat(failure).isNotNull();
        assertThat(hasCause(failure, NotificationOutboxWriteException.class)).isTrue();
    }

    private boolean hasCause(Throwable failure, Class<? extends Throwable> type) {
        Throwable current = failure;
        while (current != null) {
            if (type.isInstance(current)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private void assertPassword(UUID userId, String expectedPassword) {
        assertThat(passwordHasher.matches(expectedPassword,
                userRepository.findById(userId).orElseThrow().getPasswordHash())).isTrue();
    }

    private boolean isSessionActive(UUID sessionId) {
        return sessionRepository.findById(sessionId).orElseThrow().isActive(Instant.now());
    }

    private void assertNoOutboxRows() {
        assertThat(jdbc.queryForObject("select count(*) from identity.notification_outbox", Integer.class))
                .isZero();
    }

    private record StoredEvent(UUID eventId, String eventType, JsonNode payload) {
    }

    private record TestIdentity(UUID userId, String email, String password, UUID firstSessionId) {
    }

    private static final class RuntimeBridge implements AutoCloseable {
        private final Process process;
        private final String url;
        private final String ownerToken;
        private final String memberToken;
        private final String databaseName;
        private final String queueName;
        private final UUID ownerId;
        private final UUID memberId;

        private RuntimeBridge(Process process, String url, String ownerToken, String memberToken,
                              String databaseName, String queueName, UUID ownerId, UUID memberId) {
            this.process = process;
            this.url = url;
            this.ownerToken = ownerToken;
            this.memberToken = memberToken;
            this.databaseName = databaseName;
            this.queueName = queueName;
            this.ownerId = ownerId;
            this.memberId = memberId;
        }

        private String url() { return url; }
        private String ownerToken() { return ownerToken; }
        private String memberToken() { return memberToken; }
        private String databaseName() { return databaseName; }
        private String queueName() { return queueName; }
        private UUID ownerId() { return ownerId; }
        private UUID memberId() { return memberId; }

        @Override
        public void close() throws Exception {
            if (process.isAlive()) {
                process.getOutputStream().write("STOP\n".getBytes(StandardCharsets.UTF_8));
                process.getOutputStream().close();
                if (!process.waitFor(10, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                    process.waitFor(10, TimeUnit.SECONDS);
                }
            }
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class GrantFixtureConfiguration {
        @Bean
        @Primary
        OneUseGrantStore notificationTestGrantStore() {
            return new OneUseGrantStore();
        }
    }

    static final class OneUseGrantStore implements OtpChallengeStore {
        private final AtomicReference<Grant> grant = new AtomicReference<>();

        void setGrant(String token, GrantConsumptionResult result) {
            grant.set(new Grant(token, result));
        }

        @Override
        public GrantConsumptionResult consumeGrant(String grantToken) {
            Grant stored = grant.get();
            if (stored == null || !stored.token().equals(grantToken) || !grant.compareAndSet(stored, null)) {
                return new GrantConsumptionResult(false, null, null, null, null);
            }
            return stored.result();
        }

        @Override public String newChallengeId() { throw unsupported(); }
        @Override public ChallengeReceipt issue(Challenge challenge) { throw unsupported(); }
        @Override public ChallengeMetadata lookup(String challengeId) { throw unsupported(); }
        @Override public VerificationResult verify(VerificationAttempt attempt) { throw unsupported(); }
        @Override public void invalidate(Challenge challenge) { throw unsupported(); }
        @Override public void invalidatePurpose(String accountFingerprint, Purpose purpose) { throw unsupported(); }
        @Override public AdmissionResult reserve(String scope, String key, int limit, Duration window) {
            throw unsupported();
        }

        private UnsupportedOperationException unsupported() {
            return new UnsupportedOperationException("Test grant fixture supports one-use reset grants only");
        }

        private record Grant(String token, GrantConsumptionResult result) {
        }
    }
}
