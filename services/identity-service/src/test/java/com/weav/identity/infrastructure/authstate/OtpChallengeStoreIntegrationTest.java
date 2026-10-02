package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.infrastructure.config.OtpProperties;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OtpChallengeStoreIntegrationTest {

    private static final String SECRET = "test-otp-hmac-secret-01234567890123456789";

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private StringRedisTemplate clientOne;
    private StringRedisTemplate clientTwo;
    private HmacKeyedFingerprint keyedFingerprint;
    private OtpProperties properties;
    private ValkeyOtpChallengeStore storeOne;
    private ValkeyOtpChallengeStore storeTwo;

    @BeforeAll
    void connectClients() {
        if (!valkey.isRunning()) valkey.start();
        clientOne = template();
        clientTwo = template();
        keyedFingerprint = new HmacKeyedFingerprint(SECRET);
        properties = new OtpProperties();
        properties.setHmacSecret(SECRET);
        properties.setKeyPrefix("test:otp:" + UUID.randomUUID());
        storeOne = new ValkeyOtpChallengeStore(clientOne, properties, keyedFingerprint);
        storeTwo = new ValkeyOtpChallengeStore(clientTwo, properties, keyedFingerprint);
    }

    @BeforeEach
    void clearDatabase() {
        clientOne.getConnectionFactory().getConnection().serverCommands().flushDb();
    }

    @AfterAll
    void closeClients() {
        if (clientOne != null) ((LettuceConnectionFactory) clientOne.getConnectionFactory()).destroy();
        if (clientTwo != null) ((LettuceConnectionFactory) clientTwo.getConnectionFactory()).destroy();
        if (valkey.isRunning()) valkey.stop();
    }

    @Test
    void twoClientsCanConsumeAChallengeOnlyOnce() throws Exception {
        String account = keyedFingerprint.fingerprint("account", "user@example.com");
        String challengeId = storeOne.newChallengeId();
        String code = keyedFingerprint.fingerprint("otp-code", challengeId + "|123456");
        storeOne.issue(new OtpChallengeStore.Challenge(
                challengeId, OtpChallengeStore.Purpose.EMAIL_VERIFICATION, account, "user-1", code, null,
                Duration.ofMinutes(5)));

        OtpChallengeStore.ChallengeMetadata metadata = storeTwo.lookup(challengeId);
        assertNotNull(metadata);
        assertEquals(OtpChallengeStore.Purpose.EMAIL_VERIFICATION, metadata.purpose());
        assertEquals("user-1", metadata.userId());
        long challengeTtl = clientOne.getExpire(
                properties.getKeyPrefix() + ":challenge-index:" + challengeId, SECONDS);
        assertTrue(challengeTtl > 0 && challengeTtl <= Duration.ofMinutes(5).toSeconds());

        List<OtpChallengeStore.VerificationResult> results = concurrently(
                () -> storeOne.verify(new OtpChallengeStore.VerificationAttempt(challengeId, code, 5, Duration.ofMinutes(5))),
                () -> storeTwo.verify(new OtpChallengeStore.VerificationAttempt(challengeId, code, 5, Duration.ofMinutes(5))));

        assertEquals(1, results.stream().filter(OtpChallengeStore.VerificationResult::verified).count());
        assertEquals(1, results.stream().filter(result -> result.status() != OtpChallengeStore.Status.VERIFIED).count());
    }

    @Test
    void resetGrantIsHashOnlyOneUseAndResendInvalidatesThePreviousGeneration() {
        String account = keyedFingerprint.fingerprint("account", "reset@example.com");
        String firstId = storeOne.newChallengeId();
        String firstCode = keyedFingerprint.fingerprint("otp-code", firstId + "|111111");
        storeOne.issue(new OtpChallengeStore.Challenge(
                firstId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-2", firstCode, "credential-1",
                Duration.ofMinutes(5)));
        OtpChallengeStore.VerificationResult first = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(firstId, firstCode, 5, Duration.ofMinutes(5)));
        assertTrue(first.verified());
        assertNotNull(first.grantToken());
        assertEquals(43, first.grantToken().length());
        assertEquals(32, java.util.Base64.getUrlDecoder().decode(first.grantToken()).length);
        String firstFingerprint = keyedFingerprint.fingerprint("reset-grant", first.grantToken());
        Set<String> grantKeys = clientOne.keys(properties.getKeyPrefix() + ":grant:{" + account + "}:*");
        assertNotNull(grantKeys);
        assertEquals(1, grantKeys.size());
        String persistedGrantKey = grantKeys.iterator().next();
        Map<Object, Object> persistedGrant = clientOne.opsForHash().entries(persistedGrantKey);
        assertTrue(persistedGrantKey.endsWith(firstFingerprint));
        assertEquals(firstFingerprint, persistedGrant.get("token"));
        assertTrue(persistedGrant.values().stream().noneMatch(first.grantToken()::equals));
        assertFalse(persistedGrantKey.contains(first.grantToken()));
        long grantTtl = clientOne.getExpire(persistedGrantKey, SECONDS);
        assertTrue(grantTtl > 0 && grantTtl <= Duration.ofMinutes(5).toSeconds());

        String secondId = storeOne.newChallengeId();
        String secondCode = keyedFingerprint.fingerprint("otp-code", secondId + "|222222");
        storeOne.issue(new OtpChallengeStore.Challenge(
                secondId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-2", secondCode, "credential-2",
                Duration.ofMinutes(5)));
        assertFalse(storeOne.consumeGrant(first.grantToken()).consumed());

        OtpChallengeStore.VerificationResult second = storeTwo.verify(
                new OtpChallengeStore.VerificationAttempt(secondId, secondCode, 5, Duration.ofMinutes(5)));
        assertTrue(second.verified());
        OtpChallengeStore.GrantConsumptionResult consumed = storeOne.consumeGrant(second.grantToken());
        assertTrue(consumed.consumed());
        assertEquals("credential-2", consumed.credentialFingerprint());
        assertFalse(storeTwo.consumeGrant(second.grantToken()).consumed());
    }

    @Test
    void expiredIndexesAndGrantStateAreRejectedWithoutWaiting() {
        String account = keyedFingerprint.fingerprint("account", "expiry@example.com");
        String challengeId = storeOne.newChallengeId();
        String code = keyedFingerprint.fingerprint("otp-code", challengeId + "|123456");
        storeOne.issue(new OtpChallengeStore.Challenge(
                challengeId, OtpChallengeStore.Purpose.EMAIL_VERIFICATION, account, "user-5", code, null,
                Duration.ofMinutes(5)));
        String challengeIndex = properties.getKeyPrefix() + ":challenge-index:" + challengeId;
        assertTrue(clientOne.expire(challengeIndex, 0, SECONDS));
        assertNull(storeTwo.lookup(challengeId));
        assertEquals(OtpChallengeStore.Status.EXPIRED,
                storeOne.verify(new OtpChallengeStore.VerificationAttempt(challengeId, code, 5, null)).status());

        String resetId = storeOne.newChallengeId();
        String resetCode = keyedFingerprint.fingerprint("otp-code", resetId + "|654321");
        storeOne.issue(new OtpChallengeStore.Challenge(
                resetId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-5", resetCode, "credential-1",
                Duration.ofMinutes(5)));
        OtpChallengeStore.VerificationResult verified = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(resetId, resetCode, 5, Duration.ofMinutes(5)));
        assertTrue(verified.verified());
        Set<String> grantKeys = clientOne.keys(properties.getKeyPrefix() + ":grant:{" + account + "}:*");
        assertNotNull(grantKeys);
        assertEquals(1, grantKeys.size());
        assertTrue(clientOne.expire(grantKeys.iterator().next(), 0, SECONDS));
        assertFalse(storeTwo.consumeGrant(verified.grantToken()).consumed());
    }

    @Test
    void twoClientsCanRedeemTheSameGrantOnlyOnce() throws Exception {
        String account = keyedFingerprint.fingerprint("account", "race@example.com");
        String challengeId = storeOne.newChallengeId();
        String code = keyedFingerprint.fingerprint("otp-code", challengeId + "|246810");
        storeOne.issue(new OtpChallengeStore.Challenge(
                challengeId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-6", code, "credential-1",
                Duration.ofMinutes(5)));
        OtpChallengeStore.VerificationResult verified = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(challengeId, code, 5, Duration.ofMinutes(5)));
        assertTrue(verified.verified());

        List<OtpChallengeStore.GrantConsumptionResult> results = concurrently(
                () -> storeOne.consumeGrant(verified.grantToken()),
                () -> storeTwo.consumeGrant(verified.grantToken()));

        assertEquals(1, results.stream().filter(OtpChallengeStore.GrantConsumptionResult::consumed).count());
        assertEquals(1, results.stream().filter(result -> !result.consumed()).count());
    }

    @Test
    void delayedInvalidationOfAReplacedChallengeCannotRemoveTheReplacement() {
        String account = keyedFingerprint.fingerprint("account", "delayed@example.com");
        String firstId = storeOne.newChallengeId();
        String firstCode = keyedFingerprint.fingerprint("otp-code", firstId + "|111222");
        OtpChallengeStore.Challenge firstChallenge = new OtpChallengeStore.Challenge(
                firstId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-7", firstCode, "credential-1",
                Duration.ofMinutes(5));
        storeOne.issue(firstChallenge);
        OtpChallengeStore.VerificationResult first = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(firstId, firstCode, 5, Duration.ofMinutes(5)));
        assertTrue(first.verified());

        String secondId = storeOne.newChallengeId();
        String secondCode = keyedFingerprint.fingerprint("otp-code", secondId + "|333444");
        storeOne.issue(new OtpChallengeStore.Challenge(
                secondId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-7", secondCode, "credential-2",
                Duration.ofMinutes(5)));
        storeTwo.invalidate(firstChallenge);

        OtpChallengeStore.VerificationResult second = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(secondId, secondCode, 5, Duration.ofMinutes(5)));
        assertTrue(second.verified());
        OtpChallengeStore.GrantConsumptionResult consumed = storeTwo.consumeGrant(second.grantToken());
        assertTrue(consumed.consumed());
        assertEquals("credential-2", consumed.credentialFingerprint());
    }

    @Test
    void wrongCodeAttemptsAreAtomicAndAdmissionIsBoundedPerKey() {
        String account = keyedFingerprint.fingerprint("account", "attempts@example.com");
        String challengeId = storeOne.newChallengeId();
        String code = keyedFingerprint.fingerprint("otp-code", challengeId + "|999999");
        storeOne.issue(new OtpChallengeStore.Challenge(
                challengeId, OtpChallengeStore.Purpose.EMAIL_VERIFICATION, account, "user-3", code, null,
                Duration.ofMinutes(5)));
        String wrong = keyedFingerprint.fingerprint("otp-code", challengeId + "|000000");
        for (int i = 0; i < 4; i++) {
            assertEquals(OtpChallengeStore.Status.WRONG_CODE,
                    storeTwo.verify(new OtpChallengeStore.VerificationAttempt(challengeId, wrong, 5, Duration.ofMinutes(5))).status());
        }
        assertEquals(OtpChallengeStore.Status.TOO_MANY_ATTEMPTS,
                storeOne.verify(new OtpChallengeStore.VerificationAttempt(challengeId, wrong, 5, Duration.ofMinutes(5))).status());

        assertTrue(storeOne.reserve("account", account, 2, Duration.ofMinutes(1)).allowed());
        assertTrue(storeTwo.reserve("account", account, 2, Duration.ofMinutes(1)).allowed());
        assertFalse(storeOne.reserve("account", account, 2, Duration.ofMinutes(1)).allowed());
    }

    @Test
    void invalidatingAPurposeSupersedesAnOutstandingChallengeAndGrant() {
        String account = keyedFingerprint.fingerprint("account", "invalidate@example.com");
        String challengeId = storeOne.newChallengeId();
        String code = keyedFingerprint.fingerprint("otp-code", challengeId + "|123123");
        storeOne.issue(new OtpChallengeStore.Challenge(
                challengeId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-4", code, "credential-1",
                Duration.ofMinutes(5)));
        OtpChallengeStore.VerificationResult verified = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(challengeId, code, 5, Duration.ofMinutes(5)));
        assertTrue(verified.verified());
        assertNotNull(verified.grantToken());

        storeTwo.invalidatePurpose(account, OtpChallengeStore.Purpose.PASSWORD_RESET);

        assertFalse(storeOne.consumeGrant(verified.grantToken()).consumed());
        assertEquals(OtpChallengeStore.Status.EXPIRED,
                storeOne.verify(new OtpChallengeStore.VerificationAttempt(
                        challengeId, code, 5, Duration.ofMinutes(5))).status());
    }

    @Test
    void activeAccountStateDoesNotShortenTheOtherPurposesTtl() {
        String account = keyedFingerprint.fingerprint("account", "ttl@example.com");
        String emailChallengeId = storeOne.newChallengeId();
        String emailCode = keyedFingerprint.fingerprint("otp-code", emailChallengeId + "|123456");
        storeOne.issue(new OtpChallengeStore.Challenge(
                emailChallengeId, OtpChallengeStore.Purpose.EMAIL_VERIFICATION, account, "user-ttl",
                emailCode, null, Duration.ofSeconds(20)));

        String resetChallengeId = storeOne.newChallengeId();
        String resetCode = keyedFingerprint.fingerprint("otp-code", resetChallengeId + "|654321");
        storeOne.issue(new OtpChallengeStore.Challenge(
                resetChallengeId, OtpChallengeStore.Purpose.PASSWORD_RESET, account, "user-ttl",
                resetCode, "credential-ttl", Duration.ofSeconds(20)));
        OtpChallengeStore.VerificationResult reset = storeOne.verify(
                new OtpChallengeStore.VerificationAttempt(
                        resetChallengeId, resetCode, 5, Duration.ofSeconds(5)));
        assertTrue(reset.verified());

        String activeKey = properties.getKeyPrefix() + ":active:{" + account + "}";
        String emailKey = properties.getKeyPrefix() + ":challenge:{" + account + "}:" + emailChallengeId;
        long activeTtl = clientOne.getExpire(activeKey, SECONDS);
        long emailTtl = clientOne.getExpire(emailKey, SECONDS);
        assertTrue(emailTtl > 0);
        assertTrue(activeTtl >= emailTtl,
                () -> "active TTL " + activeTtl + " shortened email TTL " + emailTtl);
    }

    private StringRedisTemplate template() {
        LettuceConnectionFactory connectionFactory = new LettuceConnectionFactory(valkey.getHost(), valkey.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(connectionFactory);
        template.afterPropertiesSet();
        return template;
    }

    private static <T> List<T> concurrently(
            java.util.function.Supplier<T> first,
            java.util.function.Supplier<T> second
    ) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            Future<T> left = executor.submit(() -> runAfter(ready, start, first));
            Future<T> right = executor.submit(() -> runAfter(ready, start, second));
            assertTrue(ready.await(10, SECONDS));
            start.countDown();
            return List.of(left.get(15, SECONDS), right.get(15, SECONDS));
        } finally {
            executor.shutdownNow();
        }
    }

    private static <T> T runAfter(
            CountDownLatch ready,
            CountDownLatch start,
            java.util.function.Supplier<T> task
    ) throws InterruptedException {
        ready.countDown();
        assertTrue(start.await(10, SECONDS));
        return task.get();
    }
}
