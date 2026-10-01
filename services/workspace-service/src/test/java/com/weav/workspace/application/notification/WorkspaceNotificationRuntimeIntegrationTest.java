package com.weav.workspace.application.notification;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.AddMemberCommand;
import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.ConnectionAuthFailureCode;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.notification.WorkspaceNotificationEvent;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.port.out.NotificationOutboxPort;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.usecase.AddMemberUseCase;
import com.weav.workspace.application.usecase.CreateWorkspaceUseCase;
import com.weav.workspace.application.usecase.LeaveWorkspaceUseCase;
import com.weav.workspace.application.usecase.RemoveMemberUseCase;
import com.weav.workspace.application.usecase.RenameWorkspaceUseCase;
import com.weav.workspace.application.usecase.UpdateMemberPermissionsUseCase;
import com.weav.workspace.application.usecase.TestConnectionUseCase;
import com.weav.workspace.application.usecase.DisableConnectionUseCase;
import com.weav.workspace.application.usecase.StartConnectionOAuthUseCase;
import com.weav.workspace.application.usecase.CompleteConnectionOAuthTestAccess;
import com.weav.workspace.application.usecase.CompleteConnectionOAuthUseCase;
import com.weav.workspace.application.usecase.ReportConnectionAuthFailureUseCase;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.infrastructure.messaging.notification.NotificationOutboxPublisher;
import com.weav.workspace.infrastructure.persistence.repository.SpringDataMembershipRepository;
import com.weav.workspace.infrastructure.persistence.repository.SpringDataWorkspaceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory;
import org.springframework.amqp.rabbit.connection.CachingConnectionFactory.ConfirmType;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.env.Environment;
import org.springframework.boot.amqp.autoconfigure.RabbitProperties;
import org.flywaydb.core.Flyway;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real PostgreSQL + RabbitMQ + compiled Notification consumer; all state is disposable test data. */
@Testcontainers
@Import({TestcontainersConfiguration.class,
        WorkspaceNotificationRuntimeIntegrationTest.OAuthPortFixtureConfiguration.class})
@SpringBootTest(properties = "weav.workspace.notification-outbox.publisher-enabled=false")
class WorkspaceNotificationRuntimeIntegrationTest {
    private static final String EXCHANGE = "weav.events";
    private static final String GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
    private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

    @Container
    private static final RabbitMQContainer rabbit = new RabbitMQContainer(
            DockerImageName.parse("rabbitmq:3.13-management-alpine"));

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @Autowired private PostgreSQLContainer postgres;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private TransactionRunner transactionRunner;
    @Autowired private AfterCommitExecutor afterCommitExecutor;
    @Autowired private WorkspaceMutationLock mutationLock;
    @Autowired private WorkspaceNotificationRecorder recorder;
    @Autowired private ConnectionNotificationRecorder connectionRecorder;
    @Autowired private ConnectionRepository connectionRepository;
    @Autowired private CredentialRepository credentialRepository;
    @Autowired private ConnectionAuthorizationPolicy connectionAuthorizationPolicy;
    @Autowired private CredentialPayloadCodec credentialPayloadCodec;
    @Autowired private CredentialCryptoPort credentialCrypto;
    @Autowired private WorkflowConnectionUsagePort workflowConnectionUsagePort;
    @Autowired private DisableConnectionUseCase disableConnection;
    @Autowired private ReportConnectionAuthFailureUseCase reportAuthFailure;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private MembershipRepository membershipRepository;
    @Autowired private WorkspaceAuthorizationCache authorizationCache;
    @Autowired private CreateWorkspaceUseCase createWorkspace;
    @Autowired private RenameWorkspaceUseCase renameWorkspace;
    @Autowired private UpdateMemberPermissionsUseCase updatePermissions;
    @Autowired private RemoveMemberUseCase removeMember;
    @Autowired private LeaveWorkspaceUseCase leaveWorkspace;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private RabbitProperties rabbitProperties;
    @Autowired private Environment environment;
    @Autowired private Flyway flyway;
    @Autowired private NotificationOutboxPort outboxPort;
    @Autowired private StartConnectionOAuthUseCase startOAuth;
    @Autowired private CompleteConnectionOAuthUseCase completeOAuth;

    @AfterEach
    void keepTestOwnedOutboxRowsFromAffectingAnotherPublisherScenario() {
        jdbc.update("update workspace.notification_outbox set published_at = current_timestamp "
                + "where published_at is null");
    }

    @DynamicPropertySource
    static void rabbitProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.rabbitmq.host", rabbit::getHost);
        registry.add("spring.rabbitmq.port", rabbit::getAmqpPort);
        registry.add("spring.rabbitmq.username", rabbit::getAdminUsername);
        registry.add("spring.rabbitmq.password", rabbit::getAdminPassword);
        registry.add("spring.rabbitmq.virtual-host", () -> "/");
        registry.add("NOTIFICATION_EXCHANGE", () -> EXCHANGE);
        registry.add("spring.data.redis.url", () ->
                "redis://" + valkey.getHost() + ":" + valkey.getMappedPort(6379));
    }

    @Test
    void realWorkspaceEventsReachNotificationInboxWithExactRecipientsAndReplayDeduplication() throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        String longName = "N".repeat(255);
        var created = createWorkspace.execute(new CreateWorkspaceCommand(ownerId, longName));
        WorkspaceNotificationRuntimeBridge bridge = startNotificationBridge(ownerId, memberId);
        try {
            IdentityDirectoryPort identity = mock(IdentityDirectoryPort.class);
            when(identity.findByEmail("member@example.test"))
                    .thenReturn(Optional.of(new IdentityUserSummary(memberId, "member@example.test", null, true)));
            AddMemberUseCase addMember = new AddMemberUseCase(
                    membershipRepository,
                    identity,
                    transactionRunner,
                    afterCommitExecutor,
                    mock(WorkspaceAuthorizationCache.class),
                    workspaceRepository,
                    mutationLock,
                    recorder);

            addMember.execute(new AddMemberCommand(created.id(), ownerId, "member@example.test"));
            String renamedName = "R".repeat(255);
            renameWorkspace.execute(ownerId, created.id(), renamedName);
            renameWorkspace.execute(ownerId, created.id(), "  " + renamedName + "  ");
            updatePermissions.execute(new UpdateMemberPermissionsCommand(created.id(), ownerId, memberId, true, false));
            updatePermissions.execute(new UpdateMemberPermissionsCommand(created.id(), ownerId, memberId, true, false));
            removeMember.execute(created.id(), ownerId, memberId);
            addMember.execute(new AddMemberCommand(created.id(), ownerId, "member@example.test"));
            leaveWorkspace.execute(created.id(), memberId);

            List<OutboxEvent> events = loadWorkspaceEvents(created.id());
            assertThat(events).hasSize(7);
            assertThat(events).extracting(OutboxEvent::eventType).containsExactlyInAnyOrder(
                    "workspace.created", "workspace.member_added", "workspace.renamed",
                    "workspace.member_permissions_updated", "workspace.member_removed",
                    "workspace.member_added", "workspace.member_left");
            JsonNode createEvent = eventOf(events, "workspace.created").payload();
            assertThat(createEvent.path("recipientUserIds").get(0).asText()).isEqualTo(ownerId.toString());
            assertThat(createEvent.path("data").path("workspaceName").asText())
                    .isEqualTo("N".repeat(199) + "…");
            JsonNode renameEvent = eventOf(events, "workspace.renamed").payload();
            assertThat(renameEvent.path("recipientUserIds").get(0).asText()).isEqualTo(memberId.toString());
            assertThat(renameEvent.path("data").path("workspaceName").asText())
                    .isEqualTo("R".repeat(199) + "…");
            JsonNode leaveEvent = eventOf(events, "workspace.member_left").payload();
            assertThat(leaveEvent.path("actorUserId").asText()).isEqualTo(memberId.toString());
            assertThat(leaveEvent.path("data").path("subjectUserId").asText()).isEqualTo(memberId.toString());
            assertThat(leaveEvent.path("recipientUserIds").get(0).asText()).isEqualTo(ownerId.toString());
            assertThat(eventOf(events, "workspace.member_removed").payload().path("recipientUserIds").get(0).asText())
                    .isEqualTo(memberId.toString());

            NotificationOutboxPublisher publisher = publisher(EXCHANGE);
            publisher.publishPending();
            awaitInbox(bridge, ownerId, 2);
            awaitInbox(bridge, memberId, 5);

            JsonNode ownerInbox = inbox(bridge, ownerId);
            JsonNode memberInbox = inbox(bridge, memberId);
            assertThat(eventTypes(ownerInbox)).containsExactlyInAnyOrder(
                    "workspace.created", "workspace.member_left");
            assertThat(eventTypes(memberInbox)).containsExactlyInAnyOrder(
                    "workspace.member_added", "workspace.member_added", "workspace.renamed",
                    "workspace.member_permissions_updated", "workspace.member_removed");
            JsonNode removedItem = memberInbox.path("items").findValues("eventType").isEmpty()
                    ? null : findItem(memberInbox, "workspace.member_removed");
            assertThat(removedItem).isNotNull();
            assertThat(removedItem.path("target").path("kind").asText()).isEqualTo("NONE");

            List<UUID> eventIds = events.stream().map(OutboxEvent::eventId).toList();
            assertThat(eventIds).allSatisfy(eventId -> assertThat(jdbc.queryForObject(
                    "select published_at is not null from workspace.notification_outbox where event_id = ?",
                    Boolean.class, eventId)).isTrue());

            Integer beforeReplay = notificationDbScalar(
                    bridge.databaseName(), "select count(*) from notification.notification_inbox "
                            + "where source_event_id = ?::uuid", eventOf(events, "workspace.created").eventId());
            jdbc.update("update workspace.notification_outbox set published_at = null, "
                            + "next_attempt_at = current_timestamp where event_id = ?",
                    eventOf(events, "workspace.created").eventId());
            assertThat(publisher.publishPending()).isEqualTo(1);
            await(() -> notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where source_event_id = ?::uuid",
                    eventOf(events, "workspace.created").eventId()) >= 1);
            Integer afterReplay = notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where source_event_id = ?::uuid",
                    eventOf(events, "workspace.created").eventId());
            assertThat(afterReplay).isEqualTo(beforeReplay);
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_deliveries", null)).isZero();
        } finally {
            bridge.close();
            dropNotificationDatabase(bridge.databaseName());
        }
    }

    @Test
    void connectionLifecycleEventsReachOnlyCurrentRecipientsWithConnectionTargets() throws Exception {
        UUID ownerId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(ownerId, "Connection notification workspace"));
        WorkspaceNotificationRuntimeBridge bridge = startNotificationBridge(ownerId, creatorId);
        try {
            transactionRunner.required(() -> {
                membershipRepository.save(Membership.member(workspace.id(), creatorId));
                return Boolean.TRUE;
            });
            com.weav.workspace.domain.model.Connection connection = transactionRunner.required(() -> connectionRepository.save(
                    com.weav.workspace.domain.model.Connection.createNew(
                            workspace.id(),
                            creatorId,
                            "Lifecycle connection",
                            ConnectionProvider.HTTP,
                            ConnectionAuthType.NONE,
                            java.util.Map.of())));
            ConnectionProviderPort localProvider = new ConnectionProviderPort() {
                @Override
                public ConnectionProvider provider() {
                    return ConnectionProvider.HTTP;
                }

                @Override
                public void validateConfig(ConnectionAuthType authType, java.util.Map<String, Object> config) {
                }

                @Override
                public ConnectionTestResult test(
                        com.weav.workspace.domain.model.Connection testedConnection,
                        java.util.Map<String, Object> decryptedCredential) {
                    return ConnectionTestResult.verified();
                }
            };
            TestConnectionUseCase testConnection = new TestConnectionUseCase(
                    connectionRepository,
                    membershipRepository,
                    credentialRepository,
                    connectionAuthorizationPolicy,
                    new ConnectionProviderRegistry(localProvider),
                    credentialPayloadCodec,
                    credentialCrypto,
                    workflowConnectionUsagePort,
                    transactionRunner,
                    mutationLock,
                    connectionRecorder);

            testConnection.execute(ownerId, workspace.id(), connection.getId());
            reportAuthFailure.execute(workspace.id(), connection.getId(),
                    ConnectionAuthFailureCode.AUTHENTICATION_REJECTED);
            disableConnection.execute(ownerId, workspace.id(), connection.getId());

            List<OutboxEvent> events = loadWorkspaceEvents(workspace.id());
            assertThat(events).hasSize(4);
            assertThat(events).extracting(OutboxEvent::eventType).containsExactlyInAnyOrder(
                    "workspace.created", "connection.connected", "connection.invalid", "connection.disabled");
            OutboxEvent connected = eventOf(events, "connection.connected");
            OutboxEvent invalid = eventOf(events, "connection.invalid");
            OutboxEvent disabled = eventOf(events, "connection.disabled");
            for (OutboxEvent event : List.of(connected, invalid, disabled)) {
                assertThat(event.payload().path("schemaVersion").intValue()).isEqualTo(2);
                assertThat(event.payload().path("entity").path("kind").asText()).isEqualTo("CONNECTION");
                assertThat(event.payload().path("entity").path("id").asText()).isEqualTo(connection.getId().toString());
                assertThat(event.payload().path("workspaceId").asText()).isEqualTo(workspace.id().toString());
                assertThat(event.payload().path("data").size()).isEqualTo(1);
                assertThat(event.payload().path("data").path("connectionName").asText())
                        .isEqualTo("Lifecycle connection");
                assertThat(event.payload().toString()).doesNotContain("provider", "credential", "token");
            }
            assertThat(connected.payload().path("actorUserId").asText()).isEqualTo(ownerId.toString());
            assertThat(connected.payload().path("recipientUserIds").size()).isEqualTo(1);
            assertThat(connected.payload().path("recipientUserIds").get(0).asText()).isEqualTo(ownerId.toString());
            assertThat(invalid.payload().path("actorUserId").isNull()).isTrue();
            assertThat(List.of(
                    invalid.payload().path("recipientUserIds").get(0).asText(),
                    invalid.payload().path("recipientUserIds").get(1).asText()))
                    .containsExactlyElementsOf(List.of(ownerId.toString(), creatorId.toString()).stream()
                            .sorted().toList());
            assertThat(disabled.payload().path("actorUserId").asText()).isEqualTo(ownerId.toString());
            assertThat(disabled.payload().path("recipientUserIds").size()).isEqualTo(1);
            assertThat(disabled.payload().path("recipientUserIds").get(0).asText()).isEqualTo(creatorId.toString());

            NotificationOutboxPublisher publisher = publisher(EXCHANGE);
            assertThat(publisher.publishPending()).isGreaterThanOrEqualTo(4);
            awaitInbox(bridge, ownerId, 3);
            awaitInbox(bridge, creatorId, 2);
            JsonNode ownerInbox = inbox(bridge, ownerId);
            JsonNode creatorInbox = inbox(bridge, creatorId);
            assertThat(eventTypes(ownerInbox)).containsExactlyInAnyOrder(
                    "workspace.created", "connection.connected", "connection.invalid");
            assertThat(eventTypes(creatorInbox)).containsExactlyInAnyOrder(
                    "connection.invalid", "connection.disabled");
            JsonNode connectedItem = findItem(ownerInbox, "connection.connected");
            assertThat(connectedItem.path("target").path("kind").asText()).isEqualTo("CONNECTION");
            assertThat(connectedItem.path("target").path("workspaceId").asText()).isEqualTo(workspace.id().toString());
            assertThat(connectedItem.path("target").path("connectionId").asText()).isEqualTo(connection.getId().toString());
            assertThat(notificationDbScalar(
                    bridge.databaseName(), "select count(*) from notification.notification_deliveries", null)).isZero();

            Integer inboxBeforeReplay = notificationDbScalar(
                    bridge.databaseName(), "select count(*) from notification.notification_inbox "
                            + "where source_event_id = ?::uuid", invalid.eventId());
            jdbc.update("update workspace.notification_outbox set published_at = null, "
                            + "next_attempt_at = current_timestamp where event_id = ?", invalid.eventId());
            assertThat(publisher.publishPending()).isEqualTo(1);
            await(() -> notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where source_event_id = ?::uuid",
                    invalid.eventId()) >= 1);
            assertThat(notificationDbScalar(bridge.databaseName(),
                    "select count(*) from notification.notification_inbox where source_event_id = ?::uuid",
                    invalid.eventId())).isEqualTo(inboxBeforeReplay);
        } finally {
            bridge.close();
            dropNotificationDatabase(bridge.databaseName());
        }
    }

    @Test
    void realOAuthStartAndCallbackUsePostgresRedisRabbitAndCompiledNotificationConsumer() throws Exception {
        UUID ownerId = UUID.randomUUID();
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(ownerId, "OAuth notification runtime"));
        WorkspaceNotificationRuntimeBridge bridge = startNotificationBridge(ownerId, ownerId);
        try {
            assertThat(publisher(EXCHANGE).publishPending()).isGreaterThanOrEqualTo(1);
            awaitInbox(bridge, ownerId, 1);

            com.weav.workspace.domain.model.Connection connection = transactionRunner.required(() ->
                    connectionRepository.save(com.weav.workspace.domain.model.Connection.createNew(
                            workspace.id(), ownerId, "OAuth runtime connection", ConnectionProvider.GMAIL,
                            ConnectionAuthType.OAUTH2, java.util.Map.of())));

            String activationState = oauthState(startOAuth.execute(
                    ownerId, workspace.id(), connection.getId()).authorizationUrl());
            assertThat(CompleteConnectionOAuthTestAccess.completeDirectly(
                    completeOAuth, activationState, "synthetic-activation-code").outcome())
                    .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
            assertThat(outboxCount(workspace.id(), "connection.connected")).isEqualTo(1);
            assertThat(publisher(EXCHANGE).publishPending()).isGreaterThanOrEqualTo(1);
            awaitInbox(bridge, ownerId, 2);
            assertThat(eventTypes(inbox(bridge, ownerId))).containsExactlyInAnyOrder(
                    "workspace.created", "connection.connected");

            String reauthorizationState = oauthState(startOAuth.execute(
                    ownerId, workspace.id(), connection.getId()).authorizationUrl());
            assertThat(CompleteConnectionOAuthTestAccess.completeDirectly(
                    completeOAuth, reauthorizationState, "synthetic-reauthorization-code").outcome())
                    .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
            assertThat(outboxCount(workspace.id(), "connection.connected")).isEqualTo(1);
            assertThat(publisher(EXCHANGE).publishPending()).isZero();
            assertThat(inbox(bridge, ownerId).path("items").size()).isEqualTo(2);
        } finally {
            bridge.close();
            dropNotificationDatabase(bridge.databaseName());
        }
    }

    @Test
    void outboxMigrationCanRerunWithoutLosingCommittedEvents() {
        UUID ownerId = UUID.randomUUID();
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(ownerId, "Migration preserves outbox"));
        List<UUID> eventIdsBefore = jdbc.query("select event_id from workspace.notification_outbox "
                        + "where payload ->> 'workspaceId' = ? order by event_id",
                (rs, row) -> rs.getObject(1, UUID.class), workspace.id().toString());

        flyway.migrate();
        flyway.migrate();

        List<UUID> eventIdsAfter = jdbc.query("select event_id from workspace.notification_outbox "
                        + "where payload ->> 'workspaceId' = ? order by event_id",
                (rs, row) -> rs.getObject(1, UUID.class), workspace.id().toString());
        assertThat(eventIdsAfter).containsExactlyElementsOf(eventIdsBefore).hasSize(1);
    }

    @Test
    void createKeepsItsRequiresNewWorkspaceAndOutboxWhenAmbientTransactionRollsBack() {
        UUID ownerId = UUID.randomUUID();
        UUID[] createdWorkspaceId = new UUID[1];

        assertThatThrownBy(() -> transactionRunner.required(() -> {
            WorkspaceResponse created = createWorkspace.execute(
                    new CreateWorkspaceCommand(ownerId, "Requires new notification"));
            createdWorkspaceId[0] = created.id();
            throw new IllegalStateException("force ambient rollback");
        })).isInstanceOf(IllegalStateException.class).hasMessage("force ambient rollback");

        WorkspaceResponse persisted = workspaceRepository.findById(createdWorkspaceId[0])
                .map(WorkspaceResponse::from)
                .orElseThrow();
        assertThat(persisted.name()).isEqualTo("Requires new notification");
        assertThat(membershipRepository.findByWorkspaceIdAndUserId(createdWorkspaceId[0], ownerId))
                .isPresent();
        assertThat(outboxCount(createdWorkspaceId[0], "workspace.created")).isEqualTo(1);
    }

    @Test
    void outboxInsertFailureRollsBackTheWorkspaceRename() {
        UUID ownerId = UUID.randomUUID();
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(ownerId, "Before outbox failure"));
        UUID memberId = UUID.randomUUID();
        transactionRunner.required(() -> membershipRepository.save(Membership.member(workspace.id(), memberId)));
        jdbc.execute("create function workspace.reject_task4_rename_notification() returns trigger "
                + "language plpgsql as $$ begin if new.event_type = 'workspace.renamed' then "
                + "raise exception 'forced task4 outbox failure'; end if; return new; end $$");
        jdbc.execute("create trigger reject_task4_rename_notification before insert "
                + "on workspace.notification_outbox for each row "
                + "execute function workspace.reject_task4_rename_notification()");
        try {
            assertThatThrownBy(() -> renameWorkspace.execute(ownerId, workspace.id(), "Must roll back"))
                    .isInstanceOf(com.weav.workspace.application.notification.NotificationOutboxWriteException.class)
                    .hasMessage("Could not persist Workspace notification outbox event");
        } finally {
            jdbc.execute("drop trigger if exists reject_task4_rename_notification "
                    + "on workspace.notification_outbox");
            jdbc.execute("drop function if exists workspace.reject_task4_rename_notification()");
        }

        assertThat(workspaceRepository.findById(workspace.id()).orElseThrow().getName())
                .isEqualTo("Before outbox failure");
        assertThat(outboxCount(workspace.id(), "workspace.created")).isEqualTo(1);
        assertThat(outboxCount(workspace.id(), "workspace.renamed")).isZero();
    }

    @Test
    void outboxAdapterRequiresTheCallerTransaction() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        WorkspaceNotificationEvent event = new WorkspaceNotificationEvent(
                2,
                eventId,
                "workspace.created",
                "2026-09-27T00:00:00Z",
                "workspace-service",
                actorId,
                List.of(actorId),
                workspaceId,
                new WorkspaceNotificationEvent.Entity("WORKSPACE", workspaceId),
                new WorkspaceNotificationEvent.WorkspaceNameData("Transaction required"));

        assertThatThrownBy(() -> outboxPort.append(event))
                .isInstanceOf(org.springframework.dao.InvalidDataAccessApiUsageException.class)
                .hasMessage("Notification outbox append requires the caller transaction");
        assertThat(jdbc.queryForObject("select count(*) from workspace.notification_outbox where event_id = ?",
                Integer.class, eventId)).isZero();
    }

    @Test
    void publisherRetriesNegativeConfirmsAndConfirmTimeouts() {
        UUID nackOwner = UUID.randomUUID();
        WorkspaceResponse nackWorkspace = createWorkspace.execute(
                new CreateWorkspaceCommand(nackOwner, "Negative confirm"));
        OutboxEvent nackEvent = latestEvent(nackWorkspace.id());
        String nackPayload = jdbc.queryForObject("select payload::text from workspace.notification_outbox "
                + "where event_id = ?", String.class, nackEvent.eventId());
        RabbitTemplate nackTemplate = mock(RabbitTemplate.class);
        doAnswer(invocation -> {
            CorrelationData correlation = invocation.getArgument(3);
            correlation.getFuture().complete(new CorrelationData.Confirm(false, "simulated nack"));
            return null;
        }).when(nackTemplate).send(anyString(), anyString(), any(Message.class), any(CorrelationData.class));

        assertThat(publisher(EXCHANGE, nackTemplate).publishPending()).isZero();
        assertOutboxRetry(nackEvent.eventId(), "nack", nackPayload);
        jdbc.update("update workspace.notification_outbox set next_attempt_at = current_timestamp "
                + "+ interval '1 hour' where event_id = ?", nackEvent.eventId());

        UUID timeoutOwner = UUID.randomUUID();
        WorkspaceResponse timeoutWorkspace = createWorkspace.execute(
                new CreateWorkspaceCommand(timeoutOwner, "Confirm timeout"));
        OutboxEvent timeoutEvent = latestEvent(timeoutWorkspace.id());
        String timeoutPayload = jdbc.queryForObject("select payload::text from workspace.notification_outbox "
                + "where event_id = ?", String.class, timeoutEvent.eventId());
        RabbitTemplate timeoutTemplate = mock(RabbitTemplate.class);

        assertThat(publisher(EXCHANGE, timeoutTemplate, Duration.ofMillis(20)).publishPending()).isZero();
        assertOutboxRetry(timeoutEvent.eventId(), "confirm-timeout", timeoutPayload);
    }

    @Test
    void concurrentPublishersClaimOneDueRowOnlyOnce() throws Exception {
        String exchange = "workspace-task4-concurrent-" + UUID.randomUUID().toString().replace("-", "");
        String queueName = exchange + "-queue";
        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        admin.declareExchange(new TopicExchange(exchange, true, false));
        admin.declareQueue(new Queue(queueName, true, false, false));
        admin.declareBinding(BindingBuilder.bind(new Queue(queueName)).to(
                new TopicExchange(exchange)).with("workspace.created"));
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(UUID.randomUUID(), "Concurrent publication"));
        UUID eventId = latestEvent(workspace.id()).eventId();
        NotificationOutboxPublisher firstPublisher = publisher(exchange);
        NotificationOutboxPublisher secondPublisher = publisher(exchange);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> first = executor.submit(() -> {
                start.await();
                return firstPublisher.publishPending();
            });
            Future<Integer> second = executor.submit(() -> {
                start.await();
                return secondPublisher.publishPending();
            });
            start.countDown();

            assertThat(first.get(10, TimeUnit.SECONDS) + second.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            Message received = rabbitTemplate.receive(queueName, 5_000);
            assertThat(received).isNotNull();
            assertThat(received.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
            assertThat(rabbitTemplate.receive(queueName, 100)).isNull();
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void publisherCommitsItsRowTransactionIndependentlyOfAnAmbientRollback() {
        String exchange = "workspace-task4-independent-tx-" + UUID.randomUUID().toString().replace("-", "");
        String queueName = exchange + "-queue";
        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        admin.declareExchange(new TopicExchange(exchange, true, false));
        Queue queue = new Queue(queueName, true, false, false);
        admin.declareQueue(queue);
        admin.declareBinding(BindingBuilder.bind(queue).to(new TopicExchange(exchange)).with("workspace.created"));
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(UUID.randomUUID(), "Publisher own transaction"));
        UUID eventId = latestEvent(workspace.id()).eventId();

        assertThatThrownBy(() -> transactionRunner.required(() -> {
            assertThat(publisher(exchange).publishPending()).isEqualTo(1);
            throw new IllegalStateException("force ambient rollback");
        })).isInstanceOf(IllegalStateException.class).hasMessage("force ambient rollback");

        assertThat(jdbc.queryForObject("select published_at is not null from workspace.notification_outbox "
                + "where event_id = ?", Boolean.class, eventId)).isTrue();
        Message received = rabbitTemplate.receive(queueName, 5_000);
        assertThat(received).isNotNull();
        assertThat(received.getMessageProperties().getMessageId()).isEqualTo(eventId.toString());
    }

    @Test
    void confirmedPublishCanDuplicateAfterOutboxMarkRollbackWithTheSameEventIdentity() {
        String exchange = "workspace-task4-mark-failure-" + UUID.randomUUID().toString().replace("-", "");
        String queueName = exchange + "-queue";
        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        admin.declareExchange(new TopicExchange(exchange, true, false));
        Queue queue = new Queue(queueName, true, false, false);
        admin.declareQueue(queue);
        admin.declareBinding(BindingBuilder.bind(queue).to(new TopicExchange(exchange)).with("workspace.created"));
        WorkspaceResponse workspace = createWorkspace.execute(
                new CreateWorkspaceCommand(UUID.randomUUID(), "Confirm before database mark"));
        OutboxEvent event = latestEvent(workspace.id());
        String storedPayload = jdbc.queryForObject("select payload::text from workspace.notification_outbox "
                + "where event_id = ?", String.class, event.eventId());
        jdbc.execute("create function workspace.fail_task4_publish_mark() returns trigger "
                + "language plpgsql as $$ begin if new.published_at is not null then "
                + "raise exception 'forced task4 publish-mark failure'; end if; return new; end $$");
        jdbc.execute("create trigger fail_task4_publish_mark before update of published_at "
                + "on workspace.notification_outbox for each row "
                + "execute function workspace.fail_task4_publish_mark()");
        Message firstDelivery;
        try {
            assertThat(publisher(exchange).publishPending()).isZero();
            firstDelivery = rabbitTemplate.receive(queueName, 5_000);
            assertThat(firstDelivery).isNotNull();
            assertThat(jdbc.queryForObject("select published_at is null and attempts = 0 "
                    + "from workspace.notification_outbox where event_id = ?", Boolean.class, event.eventId()))
                    .isTrue();
        } finally {
            jdbc.execute("drop trigger if exists fail_task4_publish_mark on workspace.notification_outbox");
            jdbc.execute("drop function if exists workspace.fail_task4_publish_mark()");
        }

        makeDue(event.eventId());
        assertThat(publisher(exchange).publishPending()).isEqualTo(1);
        Message secondDelivery = rabbitTemplate.receive(queueName, 5_000);
        assertThat(secondDelivery).isNotNull();
        assertThat(firstDelivery.getMessageProperties().getMessageId()).isEqualTo(event.eventId().toString());
        assertThat(secondDelivery.getMessageProperties().getMessageId()).isEqualTo(event.eventId().toString());
        assertThat(new String(firstDelivery.getBody(), StandardCharsets.UTF_8)).isEqualTo(storedPayload);
        assertThat(new String(secondDelivery.getBody(), StandardCharsets.UTF_8)).isEqualTo(storedPayload);
    }

    @Test
    void publisherRetriesUnroutableAndBrokerOutageRowsWithTheSameStoredEvent() throws Exception {
        String exchange = "workspace-task4-" + UUID.randomUUID().toString().replace("-", "");
        String queueName = exchange + "-queue";
        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        CachingConnectionFactory configuredConnection = (CachingConnectionFactory) rabbitTemplate.getConnectionFactory();
        assertThat(rabbitProperties.getPublisherConfirmType()).isEqualTo(ConfirmType.CORRELATED);
        assertThat(environment.getProperty("spring.rabbitmq.publisher-confirm-type")).isEqualTo("correlated");
        assertThat(configuredConnection.isPublisherConfirms())
                .withFailMessage("Rabbit confirms setting=%s, property=%s, connectionFactory=%s",
                        rabbitProperties.getPublisherConfirmType(),
                        environment.getProperty("spring.rabbitmq.publisher-confirm-type"),
                        configuredConnection.getClass().getName())
                .isTrue();
        assertThat(configuredConnection.isSimplePublisherConfirms()).isFalse();
        assertThat(configuredConnection.isPublisherReturns()).isTrue();
        assertThat(rabbitTemplate.isMandatoryFor(new org.springframework.amqp.core.Message(new byte[0]))).isTrue();
        admin.declareExchange(new TopicExchange(exchange, true, false));
        UUID workspaceId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        transactionRunner.required(() -> {
            recorder.recordCreated(workspaceId, ownerId, "Retry workspace");
            return Boolean.TRUE;
        });
        OutboxEvent event = latestEvent(workspaceId);
        String originalPayload = jdbc.queryForObject(
                "select payload::text from workspace.notification_outbox where event_id = ?",
                String.class, event.eventId());
        NotificationOutboxPublisher publisher = publisher(exchange);

        assertThat(publisher.publishPending()).isZero();
        assertOutboxRetry(event.eventId(), "unroutable", originalPayload);

        Queue queue = new Queue(queueName, true, false, false);
        admin.declareQueue(queue);
        admin.declareBinding(BindingBuilder.bind(queue).to(new TopicExchange(exchange)).with("workspace.created"));
        makeDue(event.eventId());

        CachingConnectionFactory offlineConnection = new CachingConnectionFactory("127.0.0.1");
        offlineConnection.setPort(1);
        offlineConnection.setPublisherConfirmType(ConfirmType.CORRELATED);
        offlineConnection.setPublisherReturns(true);
        RabbitTemplate offlineTemplate = new RabbitTemplate(offlineConnection);
        offlineTemplate.setMandatory(true);
        offlineTemplate.setReturnsCallback(returned -> {});
        try {
            assertThat(publisher(exchange, offlineTemplate).publishPending()).isZero();
            assertOutboxRetry(event.eventId(), "transport-failed", originalPayload);
        } finally {
            offlineConnection.destroy();
        }

        makeDue(event.eventId());
        assertThat(publisher.publishPending()).isEqualTo(1);
        assertThat(jdbc.queryForObject("select published_at is not null from workspace.notification_outbox "
                + "where event_id = ?", Boolean.class, event.eventId())).isTrue();
        var received = rabbitTemplate.receive(queueName, 5_000);
        assertThat(received).isNotNull();
        assertThat(received.getMessageProperties().getMessageId()).isEqualTo(event.eventId().toString());
        assertThat(new String(received.getBody(), StandardCharsets.UTF_8)).isEqualTo(originalPayload);
    }

    private NotificationOutboxPublisher publisher(String exchange) {
        return publisher(exchange, rabbitTemplate);
    }

    private NotificationOutboxPublisher publisher(String exchange, RabbitTemplate template) {
        return publisher(exchange, template, Duration.ofSeconds(5));
    }

    private NotificationOutboxPublisher publisher(
            String exchange, RabbitTemplate template, Duration confirmTimeout) {
        return new NotificationOutboxPublisher(jdbc, template, transactionManager,
                "workspace", exchange, 250, confirmTimeout, Duration.ofSeconds(60));
    }

    private List<OutboxEvent> loadWorkspaceEvents(UUID workspaceId) {
        return jdbc.query("select event_id, event_type, payload::text from workspace.notification_outbox "
                        + "where payload ->> 'workspaceId' = ? order by created_at, event_id",
                (rs, row) -> new OutboxEvent(rs.getObject(1, UUID.class), rs.getString(2),
                        objectMapper.readTree(rs.getString(3))), workspaceId.toString());
    }

    private OutboxEvent latestEvent(UUID workspaceId) {
        return jdbc.queryForObject("select event_id, event_type, payload::text from workspace.notification_outbox "
                        + "where payload ->> 'workspaceId' = ? order by created_at desc limit 1",
                (rs, row) -> new OutboxEvent(rs.getObject(1, UUID.class), rs.getString(2),
                        objectMapper.readTree(rs.getString(3))), workspaceId.toString());
    }

    private OutboxEvent eventOf(List<OutboxEvent> events, String type) {
        return events.stream().filter(event -> event.eventType().equals(type)).findFirst().orElseThrow();
    }

    private void assertOutboxRetry(UUID eventId, String failureCode, String originalPayload) {
        JsonNode row = jdbc.queryForObject("select jsonb_build_object('attempts', attempts, "
                        + "'published', published_at is not null, 'failure', last_failure_code, "
                        + "'payload', payload)::text from workspace.notification_outbox where event_id = ?",
                (rs, rowNumber) -> objectMapper.readTree(rs.getString(1)), eventId);
        assertThat(row.path("attempts").intValue()).isGreaterThanOrEqualTo(1);
        assertThat(row.path("published").booleanValue()).isFalse();
        assertThat(row.path("failure").asText()).isEqualTo(failureCode);
        assertThat(row.path("payload")).isEqualTo(objectMapper.readTree(originalPayload));
        assertThat(jdbc.queryForObject("select payload::text from workspace.notification_outbox where event_id = ?",
                String.class, eventId)).isEqualTo(originalPayload);
    }

    private void makeDue(UUID eventId) {
        jdbc.update("update workspace.notification_outbox set next_attempt_at = current_timestamp "
                + "where event_id = ?", eventId);
    }

    private int outboxCount(UUID workspaceId, String eventType) {
        return jdbc.queryForObject("select count(*) from workspace.notification_outbox "
                        + "where event_type = ? and payload ->> 'workspaceId' = ?",
                Integer.class, eventType, workspaceId.toString());
    }

    private static String oauthState(String authorizationUrl) {
        int start = authorizationUrl.indexOf("state=");
        if (start < 0) {
            throw new IllegalArgumentException("Synthetic OAuth URL omitted state");
        }
        return authorizationUrl.substring(start + "state=".length());
    }

    private WorkspaceNotificationRuntimeBridge startNotificationBridge(UUID ownerId, UUID memberId)
            throws Exception {
        String databaseName = "notification_task4_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("create database \"" + databaseName + "\"");
        }
        Path script = Path.of("test/notification-runtime-bridge.cjs").toAbsolutePath();
        ProcessBuilder builder = new ProcessBuilder("node", script.toString())
                .directory(Path.of("../../services/notification-service").toAbsolutePath().normalize().toFile())
                .redirectErrorStream(true);
        var env = builder.environment();
        env.put("DB_HOST", postgres.getHost());
        env.put("DB_PORT", postgres.getMappedPort(5432).toString());
        env.put("DB_NAME", databaseName);
        env.put("DB_USERNAME", postgres.getUsername());
        env.put("DB_PASSWORD", postgres.getPassword());
        env.put("DB_SSL_MODE", "disable");
        env.put("DB_SCHEMA", "notification");
        env.put("JWT_ACCESS_SECRET", "task4-only-not-a-production-secret-0123456789");
        env.put("JWT_ISSUER", "weav-identity");
        env.put("JWT_AUDIENCE", "weav-api");
        env.put("RABBITMQ_HOST", rabbit.getHost());
        env.put("RABBITMQ_PORT", rabbit.getAmqpPort().toString());
        env.put("RABBITMQ_USERNAME", rabbit.getAdminUsername());
        env.put("RABBITMQ_PASSWORD", rabbit.getAdminPassword());
        env.put("RABBITMQ_VHOST", "/");
        env.put("NOTIFICATION_EXCHANGE", EXCHANGE);
        env.put("NOTIFICATION_QUEUE", "workspace-task4-" + UUID.randomUUID());
        env.put("NOTIFICATION_DLQ", "workspace-task4-dlq-" + UUID.randomUUID());
        env.put("NOTIFICATION_TELEGRAM_ENABLED", "false");
        env.put("NOTIFICATION_EXPO_ENABLED", "false");
        env.put("TASK4_OWNER_ID", ownerId.toString());
        env.put("TASK4_MEMBER_ID", memberId.toString());
        env.put("NODE_PATH", Path.of("../notification-service/node_modules").toAbsolutePath().normalize().toString());
        Process process = builder.start();
        BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
        List<String> bridgeOutput = new ArrayList<>();
        try {
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
                    throw new IllegalStateException("Notification runtime bridge exited before readiness: "
                            + String.join(" | ", bridgeOutput));
                }
                bridgeOutput.add(readyLine);
            } while (!readyLine.startsWith("TASK4_READY:"));
            JsonNode ready = objectMapper.readTree(readyLine.substring("TASK4_READY:".length()));
            return new WorkspaceNotificationRuntimeBridge(process, ready.path("url").asText(),
                    ready.path("ownerToken").asText(), ready.path("memberToken").asText(), databaseName,
                    ownerId, memberId);
        } catch (Exception exception) {
            process.destroyForcibly();
            dropNotificationDatabase(databaseName);
            throw exception;
        }
    }

    private void dropNotificationDatabase(String databaseName) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             Statement statement = connection.createStatement()) {
            statement.execute("drop database if exists \"" + databaseName + "\" with (force)");
        }
    }

    private void awaitInbox(WorkspaceNotificationRuntimeBridge bridge, UUID userId, int expected) throws Exception {
        await(() -> inbox(bridge, userId).path("items").size() == expected);
    }

    private JsonNode inbox(WorkspaceNotificationRuntimeBridge bridge, UUID userId) throws Exception {
        String token = userId.equals(bridge.ownerId()) ? bridge.ownerToken() : bridge.memberToken();
        var request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(bridge.url() + "/api/v2/notifications?limit=100&locale=en"))
                .header("Authorization", "Bearer " + token)
                .GET().build();
        var response = java.net.http.HttpClient.newHttpClient().send(request,
                java.net.http.HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("Notification inbox returned HTTP " + response.statusCode());
        }
        return objectMapper.readTree(response.body());
    }

    private List<String> eventTypes(JsonNode page) {
        List<String> result = new ArrayList<>();
        page.path("items").forEach(item -> result.add(item.path("eventType").asText()));
        return result;
    }

    private JsonNode findItem(JsonNode page, String eventType) {
        for (JsonNode item : page.path("items")) {
            if (eventType.equals(item.path("eventType").asText())) return item;
        }
        return null;
    }

    private Integer notificationDbScalar(String databaseName, String sql, UUID eventId) throws Exception {
        String url = postgres.getJdbcUrl().replace("/" + postgres.getDatabaseName(), "/" + databaseName);
        try (Connection connection = DriverManager.getConnection(url, postgres.getUsername(), postgres.getPassword());
             var statement = connection.prepareStatement(sql)) {
            if (eventId != null) statement.setObject(1, eventId);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getInt(1);
            }
        }
    }

    private void await(CheckedBooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for Notification inbox state");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class OAuthPortFixtureConfiguration {
        @Bean
        @Primary
        GoogleOAuthPort localGoogleOAuthPort() {
            return new GoogleOAuthPort() {
                @Override
                public String authorizationUrl(ConnectionProvider provider, String state, String codeChallenge) {
                    return "https://oauth-fixture.test/authorize?state=" + state;
                }

                @Override
                public GoogleOAuthTokenResponse exchangeAuthorizationCode(String authorizationCode, String codeVerifier) {
                    return new GoogleOAuthTokenResponse(
                            "synthetic-access-token",
                            "synthetic-refresh-token",
                            "Bearer",
                            List.of("openid", "email", GMAIL_SCOPE, GMAIL_SEND_SCOPE),
                            3600);
                }

                @Override
                public GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken) {
                    throw new UnsupportedOperationException("Refresh is not part of this runtime test");
                }

                @Override
                public ConnectionTestResult verify(
                        ConnectionProvider provider,
                        String accessToken,
                        List<String> grantedScopes) {
                    return ConnectionTestResult.verified();
                }
            };
        }
    }

    private record OutboxEvent(UUID eventId, String eventType, JsonNode payload) {}
    @FunctionalInterface private interface CheckedBooleanSupplier { boolean getAsBoolean() throws Exception; }

    private static final class WorkspaceNotificationRuntimeBridge implements AutoCloseable {
        private final Process process;
        private final String url;
        private final String ownerToken;
        private final String memberToken;
        private final String databaseName;
        private final UUID ownerId;
        private final UUID memberId;

        private WorkspaceNotificationRuntimeBridge(Process process, String url, String ownerToken,
                String memberToken, String databaseName, UUID ownerId, UUID memberId) {
            this.process = process;
            this.url = url;
            this.ownerToken = ownerToken;
            this.memberToken = memberToken;
            this.databaseName = databaseName;
            this.ownerId = ownerId;
            this.memberId = memberId;
        }

        String url() { return url; }
        String ownerToken() { return ownerToken; }
        String memberToken() { return memberToken; }
        String databaseName() { return databaseName; }
        UUID ownerId() { return ownerId; }
        UUID memberId() { return memberId; }

        @Override
        public void close() throws Exception {
            try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8))) {
                writer.write("STOP\n");
                writer.flush();
            }
            if (!process.waitFor(20, TimeUnit.SECONDS)) process.destroyForcibly();
        }
    }
}
