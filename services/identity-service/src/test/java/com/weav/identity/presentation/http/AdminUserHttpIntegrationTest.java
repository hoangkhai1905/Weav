package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserPage;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.model.UserSessionPage;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import({TestcontainersConfiguration.class, AdminUserHttpIntegrationTest.ProbeConfiguration.class})
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class AdminUserHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private LockProbeUserRepository userRepositoryProbe;

    @Autowired
    private FailingUserSessionRepository sessionRepositoryProbe;

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private ListAppender<ILoggingEvent> auditAppender;

    @BeforeEach
    void attachAuditAppender() {
        Logger logger = (Logger) LoggerFactory.getLogger("com.weav.identity.application.usecase.ChangeUserStatusUseCase");
        auditAppender = new ListAppender<>();
        auditAppender.start();
        logger.addAppender(auditAppender);
    }

    @AfterEach
    void detachAuditAppender() {
        Logger logger = (Logger) LoggerFactory.getLogger("com.weav.identity.application.usecase.ChangeUserStatusUseCase");
        if (auditAppender != null) {
            logger.detachAppender(auditAppender);
            auditAppender.stop();
        }
        userRepositoryProbe.releaseAll();
        sessionRepositoryProbe.clearFailure();
    }

    @Test
    void enforcesAdminDatabaseAuthorizationAndAtomicStatusLifecycle() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account admin = registerAndPromote("admin." + suffix + "@example.com", "Admin " + suffix);
        Account user = register("user." + suffix + "@example.com", "User " + suffix);
        TokenResponse adminTokens = login(admin.email());
        TokenResponse userTokens = login(user.email());

        assertEquals(401, get("/admin/users", null).statusCode());
        assertEquals(403, get("/admin/users", userTokens.accessToken()).statusCode());
        assertEquals(401, get("/admin/users/" + user.id(), null).statusCode());
        assertEquals(401, patchStatus(null, user.id(), "DISABLED").statusCode());
        assertEquals(403, get("/admin/users/" + user.id(), userTokens.accessToken()).statusCode());
        assertEquals(403, patchStatus(userTokens.accessToken(), user.id(), "DISABLED").statusCode());

        jdbcTemplate.update("update identity.users set system_role = 'USER' where id = ?", admin.id());
        assertEquals(403, get("/admin/users", adminTokens.accessToken()).statusCode());
        assertEquals(403, get("/admin/users/" + user.id(), adminTokens.accessToken()).statusCode());
        assertEquals(403, patchStatus(adminTokens.accessToken(), user.id(), "DISABLED").statusCode());
        jdbcTemplate.update("update identity.users set system_role = 'ADMIN' where id = ?", admin.id());
        assertEquals(200, get("/admin/users", adminTokens.accessToken()).statusCode());

        HttpResponse<String> list = get(
                "/admin/users?search=" + user.email() + "&status=ACTIVE&page=0&size=10",
                adminTokens.accessToken());
        assertEquals(200, list.statusCode());
        JsonNode page = objectMapper.readTree(list.body());
        assertEquals(1, page.get("items").size());
        assertEquals(user.id().toString(), page.get("items").get(0).get("id").asText());
        assertEquals(1, page.get("totalItems").asInt());
        assertFalse(list.body().contains("passwordHash"));
        assertFalse(list.body().contains("avatarStorageKey"));
        assertEquals(400, get("/admin/users?page=-1", adminTokens.accessToken()).statusCode());
        assertEquals(400, get("/admin/users?size=101", adminTokens.accessToken()).statusCode());
        assertEquals(400, get("/admin/users?search=" + "x".repeat(121), adminTokens.accessToken()).statusCode());

        assertEquals(200, get("/admin/users/" + user.id(), adminTokens.accessToken()).statusCode());
        UUID missingUserId = UUID.randomUUID();
        assertEquals(404, get("/admin/users/" + missingUserId, adminTokens.accessToken()).statusCode());
        assertEquals(404, patchStatus(adminTokens.accessToken(), missingUserId, "DISABLED").statusCode());
        assertEquals(409, patchStatus(adminTokens.accessToken(), admin.id(), "DISABLED").statusCode());

        HttpResponse<String> disabled = patchStatus(adminTokens.accessToken(), user.id(), "DISABLED");
        assertEquals(200, disabled.statusCode());
        assertEquals("DISABLED", objectMapper.readTree(disabled.body()).get("status").asText());
        assertEquals(401, get("/users/me", userTokens.accessToken()).statusCode());
        assertEquals(401, refresh(userTokens.refreshToken()).statusCode());
        assertEquals(0, activeSessionCount(user.id()));

        String invalidCorrelation = "invalid correlation " + PASSWORD + " " + user.email();
        assertEquals(200, patchStatus(adminTokens.accessToken(), user.id(), "DISABLED", invalidCorrelation).statusCode());
        assertEquals(200, patchStatus(adminTokens.accessToken(), user.id(), "ACTIVE").statusCode());
        assertEquals(401, get("/users/me", userTokens.accessToken()).statusCode());
        assertEquals(401, refresh(userTokens.refreshToken()).statusCode());
        TokenResponse newUserTokens = login(user.email());
        assertEquals(200, get("/users/me", newUserTokens.accessToken()).statusCode());

        assertEquals(200, get("/users/me", newUserTokens.accessToken()).statusCode());
        assertEquals(204, delete("/users/me/sessions", adminTokens.accessToken()).statusCode());
        assertEquals(401, get("/admin/users", adminTokens.accessToken()).statusCode());
        assertEquals(401, get("/admin/users/" + user.id(), adminTokens.accessToken()).statusCode());
        assertEquals(401, patchStatus(adminTokens.accessToken(), user.id(), "DISABLED").statusCode());

        TokenResponse reauthenticatedAdmin = login(admin.email());
        jdbcTemplate.update("update identity.users set status = 'DISABLED' where id = ?", admin.id());
        assertEquals(401, get("/admin/users", reauthenticatedAdmin.accessToken()).statusCode());
        assertEquals(401, get("/admin/users/" + user.id(), reauthenticatedAdmin.accessToken()).statusCode());
        assertEquals(401, patchStatus(reauthenticatedAdmin.accessToken(), user.id(), "DISABLED").statusCode());
        jdbcTemplate.update("update identity.users set status = 'ACTIVE' where id = ?", admin.id());
        assertEquals(200, get("/admin/users", reauthenticatedAdmin.accessToken()).statusCode());

        String audit = auditMessages();
        assertTrue(audit.contains("actorId=" + admin.id()));
        assertTrue(audit.contains("targetId=" + user.id()));
        assertTrue(audit.contains("action=CHANGE_USER_STATUS"));
        assertTrue(audit.contains("result=SUCCESS"));
        assertTrue(audit.contains("result=CONFLICT"));
        assertTrue(audit.contains("result=NOT_FOUND"));
        assertTrue(audit.contains("result=FORBIDDEN"));
        assertTrue(audit.contains("result=UNAUTHORIZED"));
        assertTrue(audit.contains("correlationId=admin-test-correlation"));
        assertTrue(audit.contains("correlationId=invalid"));
        assertFalse(audit.contains(invalidCorrelation));
        assertFalse(audit.contains(PASSWORD));
        assertFalse(audit.contains(user.email()));
    }

    @Test
    void serializesConcurrentAdminStatusOperationsWithLogin() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account firstAdmin = registerAndPromote("admin.one." + suffix + "@example.com", "Admin One");
        Account secondAdmin = registerAndPromote("admin.two." + suffix + "@example.com", "Admin Two");
        Account target = register("target." + suffix + "@example.com", "Target");
        TokenResponse firstAdminTokens = login(firstAdmin.email());
        TokenResponse secondAdminTokens = login(secondAdmin.email());
        TokenResponse targetTokens = login(target.email());

        assertEquals(200, get("/admin/users/" + secondAdmin.id(), firstAdminTokens.accessToken()).statusCode());
        assertEquals(409, patchStatus(firstAdminTokens.accessToken(), secondAdmin.id(), "DISABLED").statusCode());

        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(4);
        try {
            Future<HttpResponse<String>> firstStatus = executor.submit(() -> {
                await(start);
                return patchStatus(firstAdminTokens.accessToken(), target.id(), "DISABLED");
            });
            Future<HttpResponse<String>> secondStatus = executor.submit(() -> {
                await(start);
                return patchStatus(secondAdminTokens.accessToken(), target.id(), "DISABLED");
            });
            Future<HttpResponse<String>> racingLogin = executor.submit(() -> {
                await(start);
                return post("/auth/login", Map.of("email", target.email(), "password", PASSWORD));
            });
            Future<HttpResponse<String>> racingRefresh = executor.submit(() -> {
                await(start);
                return refresh(targetTokens.refreshToken());
            });
            start.countDown();

            HttpResponse<String> first = firstStatus.get(30, SECONDS);
            HttpResponse<String> second = secondStatus.get(30, SECONDS);
            HttpResponse<String> login = racingLogin.get(30, SECONDS);
            HttpResponse<String> refreshResponse = racingRefresh.get(30, SECONDS);
            assertEquals(200, first.statusCode());
            assertEquals(200, second.statusCode());
            assertEquals("DISABLED", objectMapper.readTree(second.body()).get("status").asText());
            assertEquals("DISABLED", jdbcTemplate.queryForObject(
                    "select status from identity.users where id = ?", String.class, target.id()));
            assertEquals(0, activeSessionCount(target.id()));
            if (login.statusCode() == 200) {
                TokenResponse racedTokens = objectMapper.readValue(login.body(), TokenResponse.class);
                assertEquals(401, refresh(racedTokens.refreshToken()).statusCode());
                assertEquals(401, get("/users/me", racedTokens.accessToken()).statusCode());
            } else {
                assertEquals(401, login.statusCode());
            }
            if (refreshResponse.statusCode() == 200) {
                TokenResponse racedTokens = objectMapper.readValue(refreshResponse.body(), TokenResponse.class);
                assertEquals(401, refresh(racedTokens.refreshToken()).statusCode());
                assertEquals(401, get("/users/me", racedTokens.accessToken()).statusCode());
            } else {
                assertEquals(401, refreshResponse.statusCode());
            }
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void holdsTargetLockBeforeLoginAndRefreshAndThenRejectsBothAfterDisable() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account admin = registerAndPromote("admin.gated." + suffix + "@example.com", "Gated Admin");
        Account target = register("target.gated." + suffix + "@example.com", "Gated Target");
        TokenResponse adminTokens = login(admin.email());
        TokenResponse targetTokens = login(target.email());

        userRepositoryProbe.armStatusLock(admin.id(), target.id());
        ExecutorService executor = Executors.newFixedThreadPool(3);
        try {
            Future<HttpResponse<String>> status = executor.submit(
                    () -> patchStatus(adminTokens.accessToken(), target.id(), "DISABLED"));
            assertTrue(userRepositoryProbe.awaitStatusLocksAcquired(),
                    "status request should hold both ordered user locks");

            Future<HttpResponse<String>> login = executor.submit(
                    () -> post("/auth/login", Map.of("email", target.email(), "password", PASSWORD)));
            Future<HttpResponse<String>> refresh = executor.submit(
                    () -> refresh(targetTokens.refreshToken()));

            assertTrue(userRepositoryProbe.awaitTargetLockAttempts(),
                    "login, refresh, and status should all reach the target lock window");
            assertFalse(status.isDone());
            assertFalse(login.isDone());
            assertFalse(refresh.isDone());

            userRepositoryProbe.releaseStatusLocks();
            assertEquals(200, status.get(30, SECONDS).statusCode());
            assertEquals(401, login.get(30, SECONDS).statusCode());
            assertEquals(401, refresh.get(30, SECONDS).statusCode());
            assertEquals("DISABLED", jdbcTemplate.queryForObject(
                    "select status from identity.users where id = ?", String.class, target.id()));
            assertEquals(0, activeSessionCount(target.id()));
        } finally {
            userRepositoryProbe.releaseAll();
            executor.shutdownNow();
        }
    }

    @Test
    void rechecksActorRoleAfterDeterministicLockAdmissionWindow() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account admin = registerAndPromote("admin.recheck." + suffix + "@example.com", "Recheck Admin");
        Account target = register("target.recheck." + suffix + "@example.com", "Recheck Target");
        TokenResponse adminTokens = login(admin.email());

        userRepositoryProbe.armActorLockAttempt(admin.id());
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<HttpResponse<String>> status = executor.submit(
                    () -> patchStatus(adminTokens.accessToken(), target.id(), "DISABLED"));
            assertTrue(userRepositoryProbe.awaitActorLockAttempt(),
                    "status request should reach the actor pessimistic-lock admission window");
            assertEquals(1, jdbcTemplate.update(
                    "update identity.users set system_role = 'USER' where id = ?", admin.id()));
            userRepositoryProbe.releaseActorLockAttempt();

            assertEquals(403, status.get(30, SECONDS).statusCode());
            assertEquals("ACTIVE", jdbcTemplate.queryForObject(
                    "select status from identity.users where id = ?", String.class, target.id()));
        } finally {
            userRepositoryProbe.releaseAll();
            executor.shutdownNow();
        }
    }

    @Test
    void rollsBackStatusMutationWhenSessionRevocationFailsAfterTheUpdate() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Account admin = registerAndPromote("admin.rollback." + suffix + "@example.com", "Rollback Admin");
        Account target = register("target.rollback." + suffix + "@example.com", "Rollback Target");
        TokenResponse adminTokens = login(admin.email());
        login(target.email());
        assertEquals(1, activeSessionCount(target.id()));

        sessionRepositoryProbe.failNextRevokeAfterDelegate();
        HttpResponse<String> response = patchStatus(adminTokens.accessToken(), target.id(), "DISABLED");

        assertEquals(500, response.statusCode());
        assertEquals("ACTIVE", jdbcTemplate.queryForObject(
                "select status from identity.users where id = ?", String.class, target.id()));
        assertEquals(1, activeSessionCount(target.id()));
        assertFalse(response.body().contains(PASSWORD));
    }

    private Account register(String email, String displayName) throws Exception {
        HttpResponse<String> response = post("/auth/register", Map.of(
                "email", email,
                "password", PASSWORD,
                "displayName", displayName));
        assertEquals(201, response.statusCode(), response.body());
        UserResponse user = objectMapper.readValue(response.body(), UserResponse.class);
        return new Account(user.id(), email);
    }

    private Account registerAndPromote(String email, String displayName) throws Exception {
        Account account = register(email, displayName);
        int updated = jdbcTemplate.update(
                "update identity.users set system_role = 'ADMIN' where id = ?", account.id());
        assertEquals(1, updated);
        return account;
    }

    private TokenResponse login(String email) throws Exception {
        HttpResponse<String> response = post("/auth/login", Map.of(
                "email", email,
                "password", PASSWORD));
        assertEquals(200, response.statusCode(), response.body());
        TokenResponse tokens = objectMapper.readValue(response.body(), TokenResponse.class);
        assertNotNull(tokens.accessToken());
        assertNotNull(tokens.refreshToken());
        return tokens;
    }

    private HttpResponse<String> patchStatus(String accessToken, UUID targetId, String status) throws Exception {
        return patchStatus(accessToken, targetId, status, "admin-test-correlation");
    }

    private HttpResponse<String> patchStatus(
            String accessToken,
            UUID targetId,
            String status,
            String correlationId) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri("/admin/users/" + targetId + "/status"));
        if (accessToken != null) {
            request.header("Authorization", "Bearer " + accessToken);
        }
        request.header("Content-Type", "application/json")
                .header("X-Correlation-Id", correlationId)
                .method("PATCH", HttpRequest.BodyPublishers.ofString(
                        objectMapper.writeValueAsString(Map.of("status", status))));
        return httpClient.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String auditMessages() {
        return auditAppender.list.stream()
                .map(ILoggingEvent::getFormattedMessage)
                .reduce("", (left, right) -> left + "\n" + right);
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path));
        if (accessToken != null) {
            request.header("Authorization", "Bearer " + accessToken);
        }
        return httpClient.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> delete(String path, String accessToken) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .DELETE()
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> refresh(String refreshToken) throws Exception {
        return post("/auth/refresh", Map.of("refreshToken", refreshToken));
    }

    private HttpResponse<String> post(String path, Object body) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private int activeSessionCount(UUID userId) {
        Integer count = jdbcTemplate.queryForObject(
                "select count(*) from identity.user_sessions where user_id = ? and revoked_at is null and expires_at > current_timestamp",
                Integer.class,
                userId);
        return count == null ? 0 : count;
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(30, SECONDS));
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted", exception);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ProbeConfiguration {

        @Bean
        @Primary
        LockProbeUserRepository lockProbeUserRepository(UserRepositoryAdapter delegate) {
            return new LockProbeUserRepository(delegate);
        }

        @Bean
        @Primary
        FailingUserSessionRepository failingUserSessionRepository(UserSessionRepositoryAdapter delegate) {
            return new FailingUserSessionRepository(delegate);
        }
    }

    static final class LockProbeUserRepository implements UserRepository {

        private final UserRepository delegate;
        private final Object monitor = new Object();
        private volatile UUID actorId;
        private volatile UUID targetId;
        private volatile boolean statusGateArmed;
        private volatile boolean actorGateArmed;
        private volatile CountDownLatch statusLocksAcquired = new CountDownLatch(0);
        private volatile CountDownLatch targetLockAttempts = new CountDownLatch(0);
        private volatile CountDownLatch statusRelease = new CountDownLatch(0);
        private volatile CountDownLatch actorLockAttempt = new CountDownLatch(0);
        private volatile CountDownLatch actorRelease = new CountDownLatch(0);
        private boolean actorLocked;
        private boolean targetLocked;
        private boolean statusPauseActivated;

        LockProbeUserRepository(UserRepository delegate) {
            this.delegate = delegate;
        }

        void armStatusLock(UUID actorId, UUID targetId) {
            synchronized (monitor) {
                this.actorId = actorId;
                this.targetId = targetId;
                actorLocked = false;
                targetLocked = false;
                statusPauseActivated = false;
                statusGateArmed = true;
                statusLocksAcquired = new CountDownLatch(1);
                targetLockAttempts = new CountDownLatch(3);
                statusRelease = new CountDownLatch(1);
            }
        }

        void armActorLockAttempt(UUID actorId) {
            this.actorId = actorId;
            actorGateArmed = true;
            actorLockAttempt = new CountDownLatch(1);
            actorRelease = new CountDownLatch(1);
        }

        boolean awaitStatusLocksAcquired() throws InterruptedException {
            return statusLocksAcquired.await(15, SECONDS);
        }

        boolean awaitTargetLockAttempts() throws InterruptedException {
            return targetLockAttempts.await(15, SECONDS);
        }

        boolean awaitActorLockAttempt() throws InterruptedException {
            return actorLockAttempt.await(15, SECONDS);
        }

        void releaseStatusLocks() {
            statusRelease.countDown();
        }

        void releaseActorLockAttempt() {
            actorRelease.countDown();
        }

        void releaseAll() {
            statusGateArmed = false;
            actorGateArmed = false;
            statusRelease.countDown();
            actorRelease.countDown();
        }

        @Override
        public User save(User user) {
            return delegate.save(user);
        }

        @Override
        public Optional<User> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<User> findByIdForUpdate(UUID id) {
            if (actorGateArmed && actorId != null && actorId.equals(id)) {
                actorLockAttempt.countDown();
                awaitGate(actorRelease, "actor lock attempt");
                actorGateArmed = false;
            }

            boolean statusGate = statusGateArmed
                    && actorId != null
                    && targetId != null
                    && (actorId.equals(id) || targetId.equals(id));
            if (statusGate && targetId.equals(id)) {
                targetLockAttempts.countDown();
            }
            User result = delegate.findByIdForUpdate(id).orElse(null);
            if (!statusGate) {
                return Optional.ofNullable(result);
            }

            boolean pause = false;
            synchronized (monitor) {
                if (actorId.equals(id)) {
                    actorLocked = true;
                }
                if (targetId.equals(id)) {
                    targetLocked = true;
                }
                if (actorLocked && targetLocked && !statusPauseActivated) {
                    statusPauseActivated = true;
                    pause = true;
                    statusLocksAcquired.countDown();
                }
            }
            if (pause) {
                awaitGate(statusRelease, "status lock release");
                statusGateArmed = false;
            }
            return Optional.ofNullable(result);
        }

        @Override
        public Optional<User> findByEmail(String email) {
            return delegate.findByEmail(email);
        }

        @Override
        public boolean existsByEmail(String email) {
            return delegate.existsByEmail(email);
        }

        @Override
        public UserPage findPage(String search, UserStatus status, int page, int size) {
            return delegate.findPage(search, status, page, size);
        }

        private static void awaitGate(CountDownLatch gate, String description) {
            try {
                if (!gate.await(30, SECONDS)) {
                    throw new IllegalStateException("timed out waiting for " + description);
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted while waiting for " + description, exception);
            }
        }
    }

    static final class FailingUserSessionRepository implements UserSessionRepository {

        private final UserSessionRepository delegate;
        private final AtomicBoolean failAfterRevoke = new AtomicBoolean();

        FailingUserSessionRepository(UserSessionRepository delegate) {
            this.delegate = delegate;
        }

        void failNextRevokeAfterDelegate() {
            failAfterRevoke.set(true);
        }

        void clearFailure() {
            failAfterRevoke.set(false);
        }

        @Override
        public UserSession save(UserSession session) {
            return delegate.save(session);
        }

        @Override
        public Optional<UserSession> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<UserSession> findByIdForUpdate(UUID id) {
            return delegate.findByIdForUpdate(id);
        }

        @Override
        public Optional<UserSession> findByRefreshTokenHash(String refreshTokenHash) {
            return delegate.findByRefreshTokenHash(refreshTokenHash);
        }

        @Override
        public Optional<UserSession> findByRefreshTokenHashForUpdate(String refreshTokenHash) {
            return delegate.findByRefreshTokenHashForUpdate(refreshTokenHash);
        }

        @Override
        public UserSessionPage findActiveByUserId(UUID userId, Instant now, int page, int size) {
            return delegate.findActiveByUserId(userId, now, page, size);
        }

        @Override
        public int revokeAllForUser(UUID userId, Instant revokedAt) {
            int result = delegate.revokeAllForUser(userId, revokedAt);
            if (failAfterRevoke.compareAndSet(true, false)) {
                throw new IllegalStateException("injected revoke failure after delegate");
            }
            return result;
        }
    }

    private record Account(UUID id, String email) {
    }
}
