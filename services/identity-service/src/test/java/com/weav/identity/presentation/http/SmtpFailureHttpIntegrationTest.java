package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the real SMTP adapter and asynchronous HTTP admission with a
 * loopback protocol server. No provider or real recipient is contacted.
 */
@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class SmtpFailureHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String NEW_PASSWORD = "replacement-horse-battery-staple";
    private static final String HMAC_SECRET = "identity-smtp-failure-hmac-secret-012345678901234567890";

    private static final ProtocolSmtpServer SMTP = ProtocolSmtpServer.start();

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private OtpChallengeStore challengeStore;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.otp.hmac-secret", () -> HMAC_SECRET);
        registry.add("weav.mail.host", () -> "127.0.0.1");
        registry.add("weav.mail.port", SMTP::port);
        registry.add("weav.mail.from", () -> "no-reply@example.test");
        registry.add("weav.mail.auth", () -> false);
        registry.add("weav.mail.start-tls", () -> false);
        registry.add("weav.mail.start-tls-required", () -> false);
        registry.add("weav.mail.ssl", () -> false);
        registry.add("weav.mail.connection-timeout", () -> "250ms");
        registry.add("weav.mail.read-timeout", () -> "2s");
        registry.add("weav.mail.write-timeout", () -> "250ms");
        registry.add("weav.mail.queue-capacity", () -> 20);
        registry.add("weav.mail.core-pool-size", () -> 1);
        registry.add("weav.mail.max-pool-size", () -> 2);
    }

    @BeforeEach
    void resetSmtpServer() throws Exception {
        SMTP.releaseAll();
        assertTrue(SMTP.awaitQuiescence(5, TimeUnit.SECONDS),
                "previous SMTP test session did not terminate");
        SMTP.reset();
    }

    @AfterEach
    void cleanupSmtpServer() throws Exception {
        SMTP.releaseAll();
        assertTrue(SMTP.awaitQuiescence(5, TimeUnit.SECONDS),
                "SMTP test session did not terminate");
    }

    @AfterAll
    static void stopSmtpServer() throws Exception {
        SMTP.releaseAll();
        SMTP.close();
        assertTrue(SMTP.awaitQuiescence(5, TimeUnit.SECONDS),
                "SMTP test clients did not terminate");
    }

    @Test
    void smtpRejectionInvalidatesOnlyItsChallengeAndCoreAuthSurvives() throws Exception {
        String rejectedEmail = uniqueEmail("smtp-rejected");
        String acceptedEmail = uniqueEmail("smtp-accepted");
        register(rejectedEmail);
        register(acceptedEmail);
        TokenResponse coreSession = login(rejectedEmail, PASSWORD);
        SMTP.behavior(rejectedEmail, Behavior.REJECT_AFTER_DATA);
        SMTP.behavior(acceptedEmail, Behavior.ACCEPT);

        CompletableFuture<HttpResponse<String>> rejectedFuture = postAsync(
                "/auth/forgot-password", null, Map.of("email", rejectedEmail));
        SMTP.awaitPending(rejectedEmail);
        assertTrue(SMTP.sessionIsLive(rejectedEmail),
                "SMTP connection must remain open before controlled rejection");
        assertTrue(SMTP.outcomePending(rejectedEmail),
                "SMTP server must not have sent a rejection before HTTP admission completes");
        HttpResponse<String> rejectedRequest = rejectedFuture.get(1, TimeUnit.SECONDS);
        assertEquals(202, rejectedRequest.statusCode());
        assertTrue(SMTP.sessionIsLive(rejectedEmail),
                "HTTP 202 must complete while SMTP is still awaiting its final response");
        JsonNode rejectedReceipt = objectMapper.readTree(rejectedRequest.body());

        SMTP.release(rejectedEmail);
        HttpResponse<String> acceptedRequest = post("/auth/forgot-password", null,
                Map.of("email", acceptedEmail));
        assertEquals(202, acceptedRequest.statusCode());
        JsonNode acceptedReceipt = objectMapper.readTree(acceptedRequest.body());

        String rejectedCode = otpCode(SMTP.awaitBody(rejectedEmail));
        SMTP.awaitOutcome(rejectedEmail, Outcome.FAILURE);
        SMTP.awaitSessionClosed(rejectedEmail);
        awaitChallengeAbsent(rejectedReceipt.get("challengeId").asText());
        assertEquals(400, post("/auth/otp/verify", null, Map.of(
                "challengeId", rejectedReceipt.get("challengeId").asText(),
                "code", rejectedCode)).statusCode());

        String acceptedCode = otpCode(SMTP.awaitBody(acceptedEmail));
        SMTP.awaitOutcome(acceptedEmail, Outcome.SUCCESS);
        assertNotNull(challengeStore.lookup(acceptedReceipt.get("challengeId").asText()),
                "a different challenge must not be invalidated by the rejected delivery");
        assertEquals(200, post("/auth/otp/verify", null, Map.of(
                "challengeId", acceptedReceipt.get("challengeId").asText(),
                "code", acceptedCode)).statusCode());

        assertEquals(200, get("/users/me", coreSession.accessToken()).statusCode());
        assertNotNull(login(rejectedEmail, PASSWORD).accessToken());
    }

    @Test
    void smtpTimeoutDoesNotDelayEligibleOrNoopRequestsAndPreservesCoreAuth() throws Exception {
        String eligibleEmail = uniqueEmail("smtp-timeout");
        String disabledEmail = uniqueEmail("smtp-disabled");
        String oauthOnlyEmail = uniqueEmail("smtp-oauth-only");
        register(eligibleEmail);
        UserResponse disabled = register(disabledEmail);
        UserResponse oauthOnly = register(oauthOnlyEmail);
        jdbcTemplate.update("update identity.users set status = 'DISABLED' where id = ?", disabled.id());
        jdbcTemplate.update("update identity.users set password_hash = null where id = ?", oauthOnly.id());
        TokenResponse coreSession = login(eligibleEmail, PASSWORD);
        SMTP.defaultBehavior(Behavior.TIMEOUT_AFTER_DATA);

        String[] categories = {uniqueEmail("smtp-unknown"), disabledEmail, oauthOnlyEmail};
        CompletableFuture<HttpResponse<String>> eligibleFuture = postAsync(
                "/auth/forgot-password", null, Map.of("email", eligibleEmail));
        SMTP.awaitPending(eligibleEmail);
        assertTrue(SMTP.sessionIsLive(eligibleEmail),
                "SMTP connection must remain open before its timeout");
        assertTrue(SMTP.outcomePending(eligibleEmail),
                "SMTP server must not have completed before HTTP admission");
        HttpResponse<String> eligibleResponse = eligibleFuture.get(1, TimeUnit.SECONDS);
        assertEquals(202, eligibleResponse.statusCode());
        assertTrue(SMTP.sessionIsLive(eligibleEmail),
                "HTTP 202 must complete before the SMTP read timeout");
        JsonNode eligibleReceipt = objectMapper.readTree(eligibleResponse.body());

        for (String email : categories) {
            long started = System.nanoTime();
            HttpResponse<String> response = post("/auth/forgot-password", null, Map.of("email", email));
            long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();
            assertEquals(202, response.statusCode());
            assertTrue(elapsedMillis < 1000, "SMTP timeout must not block " + email);
            JsonNode receipt = objectMapper.readTree(response.body());
            if (email.equals(eligibleEmail)) eligibleReceipt = receipt;
        }
        assertNotNull(eligibleReceipt);

        String eligibleCode = otpCode(SMTP.awaitBody(eligibleEmail));
        SMTP.awaitOutcome(eligibleEmail, Outcome.FAILURE);
        SMTP.awaitSessionClosed(eligibleEmail);
        assertTrue(SMTP.outcomeElapsedMillis(eligibleEmail) >= 1000,
                "SMTP timeout must be observed after the HTTP admission bound");
        awaitChallengeAbsent(eligibleReceipt.get("challengeId").asText());
        assertEquals(400, post("/auth/otp/verify", null, Map.of(
                "challengeId", eligibleReceipt.get("challengeId").asText(),
                "code", eligibleCode)).statusCode());
        assertEquals(1, SMTP.connectionCount(), "only the eligible account may reach SMTP");
        assertEquals(200, get("/users/me", coreSession.accessToken()).statusCode());
        assertNotNull(login(eligibleEmail, PASSWORD).accessToken());
    }

    private void awaitChallengeAbsent(String challengeId) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (System.nanoTime() < deadline) {
            if (challengeStore.lookup(challengeId) == null) return;
            Thread.sleep(25);
        }
        throw new AssertionError("SMTP failure did not invalidate the challenge in time");
    }

    private UserResponse register(String email) throws Exception {
        HttpResponse<String> response = post("/auth/register", null,
                Map.of("email", email, "password", PASSWORD, "displayName", "SMTP failure test"));
        assertEquals(201, response.statusCode());
        return objectMapper.readValue(response.body(), UserResponse.class);
    }

    private TokenResponse login(String email, String password) throws Exception {
        HttpResponse<String> response = post("/auth/login", null,
                Map.of("email", email, "password", password));
        assertEquals(200, response.statusCode());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private HttpResponse<String> post(String path, String token, Object body) throws Exception {
        return postAsync(path, token, body).get(5, TimeUnit.SECONDS);
    }

    private CompletableFuture<HttpResponse<String>> postAsync(String path, String token, Object body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json");
        if (token != null) request.header("Authorization", "Bearer " + token);
        return httpClient.sendAsync(request.POST(HttpRequest.BodyPublishers.ofString(
                objectMapper.writeValueAsString(body))).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                        .timeout(Duration.ofSeconds(5))
                        .header("Authorization", "Bearer " + token)
                        .GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static String otpCode(String body) {
        Matcher matcher = Pattern.compile("security code is ([0-9]{6})").matcher(body);
        if (!matcher.find()) throw new AssertionError("SMTP test server did not capture an OTP");
        return matcher.group(1);
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private enum Behavior { ACCEPT, REJECT_AFTER_DATA, TIMEOUT_AFTER_DATA }

    private enum Outcome { SUCCESS, FAILURE }

    private static final class ProtocolSmtpServer implements AutoCloseable {

        private static final Pattern RECIPIENT = Pattern.compile("(?i)^RCPT TO:\\s*<([^>]+)>.*$");

        private final ServerSocket serverSocket;
        private final ExecutorService acceptor;
        private final ExecutorService clients;
        private final AtomicBoolean running = new AtomicBoolean(true);
        private final AtomicInteger connections = new AtomicInteger();
        private final ConcurrentMap<String, Attempt> attempts = new ConcurrentHashMap<>();
        private final ConcurrentMap<String, Behavior> behaviors = new ConcurrentHashMap<>();
        private final java.util.Set<Socket> activeSockets = ConcurrentHashMap.newKeySet();
        private volatile Behavior defaultBehavior = Behavior.ACCEPT;

        private ProtocolSmtpServer() throws IOException {
            serverSocket = new ServerSocket(0, 20, InetAddress.getLoopbackAddress());
            acceptor = Executors.newSingleThreadExecutor(daemonFactory("smtp-acceptor"));
            clients = Executors.newCachedThreadPool(daemonFactory("smtp-client"));
            acceptor.execute(this::acceptConnections);
        }

        static ProtocolSmtpServer start() {
            try {
                return new ProtocolSmtpServer();
            } catch (IOException exception) {
                throw new ExceptionInInitializerError(exception);
            }
        }

        int port() {
            return serverSocket.getLocalPort();
        }

        void reset() {
            activeSockets.forEach(this::closeQuietly);
            attempts.clear();
            behaviors.clear();
            connections.set(0);
            defaultBehavior = Behavior.ACCEPT;
        }

        void behavior(String recipient, Behavior behavior) {
            behaviors.put(recipient, behavior);
        }

        void defaultBehavior(Behavior behavior) {
            defaultBehavior = behavior;
        }

        int connectionCount() {
            return connections.get();
        }

        String awaitBody(String recipient) throws Exception {
            Attempt attempt = attempt(recipient);
            assertTrue(attempt.bodyReady.await(3, TimeUnit.SECONDS),
                    "SMTP server did not receive a message for " + recipient);
            return attempt.body;
        }

        void awaitOutcome(String recipient, Outcome outcome) throws Exception {
            Attempt attempt = attempt(recipient);
            CountDownLatch latch = outcome == Outcome.SUCCESS ? attempt.succeeded : attempt.failed;
            assertTrue(latch.await(3, TimeUnit.SECONDS),
                    "SMTP server did not observe " + outcome + " for " + recipient);
        }

        void awaitPending(String recipient) throws Exception {
            Attempt attempt = attempt(recipient);
            assertTrue(attempt.pending.await(3, TimeUnit.SECONDS),
                    "SMTP server did not enter the controlled pending phase for " + recipient);
        }

        boolean sessionIsLive(String recipient) {
            Attempt attempt = attempt(recipient);
            Socket socket = attempt.socket;
            return attempt.sessionPending.get()
                    && !attempt.finalResponseSent.get()
                    && socket != null
                    && activeSockets.contains(socket)
                    && !socket.isClosed();
        }

        boolean outcomePending(String recipient) {
            Attempt attempt = attempt(recipient);
            return attempt.failed.getCount() == 1 && attempt.succeeded.getCount() == 1;
        }

        void release(String recipient) {
            attempt(recipient).release.countDown();
        }

        void releaseAll() {
            attempts.values().forEach(attempt -> attempt.release.countDown());
            activeSockets.forEach(this::closeQuietly);
        }

        void awaitSessionClosed(String recipient) throws Exception {
            assertTrue(attempt(recipient).closed.await(3, TimeUnit.SECONDS),
                    "SMTP session did not close for " + recipient);
        }

        long outcomeElapsedMillis(String recipient) {
            Attempt attempt = attempt(recipient);
            return TimeUnit.NANOSECONDS.toMillis(attempt.failedAtNanos - attempt.pendingAtNanos);
        }

        boolean awaitQuiescence(long timeout, TimeUnit unit) throws InterruptedException {
            long deadline = System.nanoTime() + unit.toNanos(timeout);
            while (System.nanoTime() < deadline) {
                if (activeSockets.isEmpty()) return true;
                Thread.sleep(25);
            }
            return activeSockets.isEmpty();
        }

        private Attempt attempt(String recipient) {
            return attempts.computeIfAbsent(recipient, ignored -> new Attempt());
        }

        private void acceptConnections() {
            while (running.get()) {
                try {
                    Socket socket = serverSocket.accept();
                    connections.incrementAndGet();
                    activeSockets.add(socket);
                    clients.execute(() -> handle(socket));
                } catch (IOException exception) {
                    if (running.get()) throw new IllegalStateException("SMTP test server stopped unexpectedly", exception);
                }
            }
        }

        private void handle(Socket socket) {
            String recipient = null;
            try (socket;
                 BufferedReader reader = new BufferedReader(new InputStreamReader(
                         socket.getInputStream(), StandardCharsets.US_ASCII));
                 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                         socket.getOutputStream(), StandardCharsets.US_ASCII))) {
                socket.setSoTimeout(5000);
                line(writer, "220 loopback SMTP test server");
                String command;
                while ((command = reader.readLine()) != null) {
                    String upper = command.toUpperCase(java.util.Locale.ROOT);
                    if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
                        writer.write("250-loopback\r\n250 SIZE 1000000\r\n");
                        writer.flush();
                    } else if (upper.startsWith("MAIL FROM")) {
                        line(writer, "250 sender accepted");
                    } else if (upper.startsWith("RCPT TO")) {
                        Matcher matcher = RECIPIENT.matcher(command);
                        recipient = matcher.matches() ? matcher.group(1) : "unknown@example.test";
                        line(writer, "250 recipient accepted");
                    } else if (upper.equals("DATA")) {
                        line(writer, "354 end with <CRLF>.<CRLF>");
                        StringBuilder body = new StringBuilder();
                        String bodyLine;
                        while ((bodyLine = reader.readLine()) != null && !".".equals(bodyLine)) {
                            body.append(bodyLine).append('\n');
                        }
                        if (recipient == null) return;
                        Attempt attempt = attempt(recipient);
                        attempt.body = body.toString();
                        attempt.bodyReady.countDown();
                        attempt.socket = socket;
                        attempt.pendingAtNanos = System.nanoTime();
                        attempt.sessionPending.set(true);
                        attempt.pending.countDown();
                        Behavior behavior = behaviors.getOrDefault(recipient, defaultBehavior);
                        if (behavior == Behavior.REJECT_AFTER_DATA) {
                            try {
                                attempt.release.await(3, TimeUnit.SECONDS);
                            } catch (InterruptedException exception) {
                                Thread.currentThread().interrupt();
                            }
                            line(writer, "550 rejected by deterministic SMTP test server");
                            attempt.finalResponseSent.set(true);
                            attempt.failed.countDown();
                            return;
                        }
                        if (behavior == Behavior.TIMEOUT_AFTER_DATA) {
                            try {
                                while (reader.readLine() != null) {
                                    // Wait for the JavaMail read timeout to close the socket.
                                }
                            } catch (IOException ignored) {
                                // Client timeout/close is the expected failure signal.
                            } finally {
                                attempt.failedAtNanos = System.nanoTime();
                                attempt.failed.countDown();
                            }
                            return;
                        }
                        line(writer, "250 message accepted");
                        attempt.finalResponseSent.set(true);
                        attempt.succeeded.countDown();
                    } else if (upper.startsWith("QUIT")) {
                        line(writer, "221 bye");
                        return;
                    } else {
                        line(writer, "250 command accepted");
                    }
                }
            } catch (IOException ignored) {
                if (recipient != null) {
                    Attempt attempt = attempt(recipient);
                    attempt.failedAtNanos = System.nanoTime();
                    attempt.failed.countDown();
                }
            } finally {
                if (recipient != null) attempt(recipient).sessionPending.set(false);
                if (recipient != null) attempt(recipient).closed.countDown();
                activeSockets.remove(socket);
                closeQuietly(socket);
            }
        }

        private static void line(BufferedWriter writer, String value) throws IOException {
            writer.write(value);
            writer.write("\r\n");
            writer.flush();
        }

        private static java.util.concurrent.ThreadFactory daemonFactory(String prefix) {
            AtomicInteger sequence = new AtomicInteger();
            return runnable -> {
                Thread thread = new Thread(runnable, prefix + "-" + sequence.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            };
        }

        private void closeQuietly(Socket socket) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // Best-effort cleanup for a test-only socket.
            }
        }

        @Override
        public void close() {
            if (!running.compareAndSet(true, false)) return;
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // Already closed.
            }
            activeSockets.forEach(this::closeQuietly);
            acceptor.shutdownNow();
            clients.shutdownNow();
        }

        private static final class Attempt {
            private final CountDownLatch bodyReady = new CountDownLatch(1);
            private final CountDownLatch pending = new CountDownLatch(1);
            private final CountDownLatch release = new CountDownLatch(1);
            private final CountDownLatch succeeded = new CountDownLatch(1);
            private final CountDownLatch failed = new CountDownLatch(1);
            private final CountDownLatch closed = new CountDownLatch(1);
            private final AtomicBoolean sessionPending = new AtomicBoolean();
            private final AtomicBoolean finalResponseSent = new AtomicBoolean();
            private volatile String body;
            private volatile Socket socket;
            private volatile long pendingAtNanos;
            private volatile long failedAtNanos;
        }
    }
}
