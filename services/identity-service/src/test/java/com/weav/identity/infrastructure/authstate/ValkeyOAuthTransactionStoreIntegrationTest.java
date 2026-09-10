package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

import static java.util.concurrent.TimeUnit.SECONDS;
import static java.util.concurrent.TimeUnit.MILLISECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ValkeyOAuthTransactionStoreIntegrationTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private static final AtomicLong TOKEN_COUNTER = new AtomicLong();
    private StringRedisTemplate clientOne;
    private StringRedisTemplate clientTwo;
    private ValkeyOAuthTransactionStore storeOne;
    private ValkeyOAuthTransactionStore storeTwo;

    @BeforeAll
    void connectClients() {
        if (!valkey.isRunning()) {
            valkey.start();
        }
        clientOne = template();
        clientTwo = template();
        OAuthConfiguration configuration = testConfiguration();
        storeOne = new ValkeyOAuthTransactionStore(clientOne, configuration);
        storeTwo = new ValkeyOAuthTransactionStore(clientTwo, configuration);
    }

    @BeforeEach
    void clearDatabase() {
        clientOne.getConnectionFactory().getConnection().serverCommands().flushDb();
    }

    @AfterAll
    void closeClients() {
        if (clientOne != null) {
            ((LettuceConnectionFactory) clientOne.getConnectionFactory()).destroy();
        }
        if (clientTwo != null) {
            ((LettuceConnectionFactory) clientTwo.getConnectionFactory()).destroy();
        }
        if (valkey.isRunning()) {
            valkey.stop();
        }
    }

    @Test
    void loginAndLinkHandoffsRoundTripValidatedIdentityAndRetainBoundTtl() {
        OAuthTransactionStore.Transaction login = transaction(OAuthTransactionStore.Intent.LOGIN);
        assertTrue(storeOne.start(login).accepted());
        assertTtl(transactionKey(login.transactionId()), 10);
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED,
                storeTwo.consumeCallback(new OAuthTransactionStore.CallbackBinding(
                        login.transactionId(), login.transactionId(), login.providerStateFingerprint())).status());

        OAuthProviderClient.ProviderIdentity identity = identity("subject-login", "person@example.com", true);
        OAuthTransactionStore.Handoff loginHandoff = handoff(login, identity, 5);
        assertTrue(storeOne.issueHandoff(loginHandoff).accepted());
        assertTtl(handoffKey(loginHandoff.handoffCodeFingerprint()), 10);
        OAuthTransactionStore.HandoffConsumeResult loginResult = storeTwo.consumeHandoff(binding(loginHandoff));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED, loginResult.status());
        assertEquals(identity, loginResult.handoff().providerIdentity());
        assertEquals(loginHandoff.ttl(), loginResult.handoff().ttl());
        assertEquals("person@example.com", loginResult.handoff().providerIdentity().providerEmail());

        OAuthTransactionStore.Transaction link = transaction(OAuthTransactionStore.Intent.LINK);
        assertTrue(storeOne.start(link).accepted());
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED,
                storeOne.consumeCallback(new OAuthTransactionStore.CallbackBinding(
                        link.transactionId(), link.transactionId(), link.providerStateFingerprint())).status());
        OAuthProviderClient.ProviderIdentity subjectOnly = identity("subject-link", true);
        OAuthTransactionStore.Handoff linkHandoff = handoff(link, subjectOnly, 5);
        assertTrue(storeTwo.issueHandoff(linkHandoff).accepted());
        OAuthTransactionStore.HandoffConsumeResult linkResult = storeOne.consumeHandoff(binding(linkHandoff));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED, linkResult.status());
        assertEquals(subjectOnly, linkResult.handoff().providerIdentity());
        assertEquals(link.userId(), linkResult.handoff().userId());
        assertEquals(link.sessionId(), linkResult.handoff().sessionId());
    }

    @Test
    void callbackStateMismatchLeavesTheValidRecordForCorrectProof() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        storeOne.start(transaction);
        String key = transactionKey(transaction.transactionId());
        long before = clientOne.getExpire(key, SECONDS);

        OAuthTransactionStore.CallbackConsumeResult mismatch = storeTwo.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), token()));
        assertEquals(OAuthTransactionStore.CallbackStatus.MISMATCH, mismatch.status());
        assertTrue(clientOne.hasKey(key));
        assertTrue(clientOne.getExpire(key, SECONDS) > 0);
        assertTrue(clientOne.getExpire(key, SECONDS) <= before);

        OAuthTransactionStore.CallbackConsumeResult consumed = storeOne.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint()));
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED, consumed.status());
        assertFalse(clientOne.hasKey(key));
    }

    @Test
    void callbackCorrelationCookieMismatchLeavesTheValidRecordForCorrectProof() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        storeOne.start(transaction);
        String key = transactionKey(transaction.transactionId());

        OAuthTransactionStore.CallbackConsumeResult mismatch = storeTwo.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), token(), transaction.providerStateFingerprint()));
        assertEquals(OAuthTransactionStore.CallbackStatus.MISMATCH, mismatch.status());
        assertTrue(clientOne.hasKey(key));

        OAuthTransactionStore.CallbackConsumeResult consumed = storeOne.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint()));
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED, consumed.status());
        assertFalse(clientOne.hasKey(key));
    }

    @Test
    void callbackReplayIsNotFoundAfterTheOneUseConsume() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.CallbackBinding binding = new OAuthTransactionStore.CallbackBinding(
                transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint());
        storeOne.start(transaction);

        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED, storeOne.consumeCallback(binding).status());
        assertEquals(OAuthTransactionStore.CallbackStatus.NOT_FOUND, storeTwo.consumeCallback(binding).status());
    }

    @Test
    void concurrentCallbackConsumersHaveExactlyOneWinner() throws Exception {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.CallbackBinding binding = new OAuthTransactionStore.CallbackBinding(
                transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint());
        storeOne.start(transaction);

        List<OAuthTransactionStore.CallbackStatus> statuses = concurrently(
                8, () -> storeTwo.consumeCallback(binding).status());

        assertEquals(1, statuses.stream().filter(OAuthTransactionStore.CallbackStatus.CONSUMED::equals).count());
        assertEquals(7, statuses.stream().filter(OAuthTransactionStore.CallbackStatus.NOT_FOUND::equals).count());
    }

    @Test
    void startAndIssueCollisionsPreserveTheFirstRecord() {
        OAuthTransactionStore.Transaction original = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Transaction replacement = new OAuthTransactionStore.Transaction(
                original.transactionId(), original.intent(), original.clientId(), original.returnTargetId(),
                token(), original.nonceFingerprint(), new OAuthSecret("replacement-provider-verifier"),
                original.handoffCodeChallenge(), null, null, null, original.ttl());
        assertTrue(storeOne.start(original).accepted());
        assertFalse(storeTwo.start(replacement).accepted());
        OAuthTransactionStore.Transaction consumed = storeOne.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        original.transactionId(), original.transactionId(), original.providerStateFingerprint())).transaction();
        assertEquals(original.providerCodeVerifier(), consumed.providerCodeVerifier());
        assertEquals(original.providerStateFingerprint(), consumed.providerStateFingerprint());

        OAuthProviderClient.ProviderIdentity firstIdentity = identity("first-subject", true);
        OAuthProviderClient.ProviderIdentity replacementIdentity = identity("replacement-subject", true);
        OAuthTransactionStore.Handoff originalHandoff = handoff(original, firstIdentity, 5);
        OAuthTransactionStore.Handoff replacementHandoff = new OAuthTransactionStore.Handoff(
                originalHandoff.handoffCodeFingerprint(), originalHandoff.transactionId(), originalHandoff.intent(),
                originalHandoff.clientId(), originalHandoff.returnTargetId(), originalHandoff.codeChallenge(),
                replacementIdentity, null, null, null, originalHandoff.ttl(), originalHandoff.maxProofFailures());
        assertTrue(storeOne.issueHandoff(originalHandoff).accepted());
        assertFalse(storeTwo.issueHandoff(replacementHandoff).accepted());
        OAuthTransactionStore.HandoffConsumeResult result = storeTwo.consumeHandoff(binding(originalHandoff));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED, result.status());
        assertEquals(firstIdentity, result.handoff().providerIdentity());
    }

    @Test
    void positiveSubsecondTtlCanConsumeAndCollisionReceiptDoesNotExtendLifetime() {
        Duration ttl = Duration.ofMillis(1_500);
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN, ttl);
        OAuthTransactionStore.TransactionReceipt created = storeOne.start(transaction);
        assertTrue(created.accepted());
        assertEquals(1, created.expiresInSeconds());

        String transactionKey = transactionKey(transaction.transactionId());
        long beforeCollision = awaitSubsecondTtl(transactionKey);
        OAuthTransactionStore.TransactionReceipt collision = storeTwo.start(transaction);
        assertFalse(collision.accepted());
        assertEquals(1, collision.expiresInSeconds());
        long afterCollision = clientOne.getExpire(transactionKey, MILLISECONDS);
        assertTrue(afterCollision > 0 && afterCollision <= beforeCollision,
                () -> "collision must not extend transaction lifetime: before="
                        + beforeCollision + ", after=" + afterCollision);
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED,
                storeOne.consumeCallback(new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint())).status());

        OAuthTransactionStore.Handoff handoff = handoff(
                transaction, identity("subsecond-handoff", true), 5, ttl);
        OAuthTransactionStore.HandoffReceipt handoffCreated = storeOne.issueHandoff(handoff);
        assertTrue(handoffCreated.accepted());
        assertEquals(1, handoffCreated.expiresInSeconds());

        String handoffKey = handoffKey(handoff.handoffCodeFingerprint());
        long handoffBeforeCollision = awaitSubsecondTtl(handoffKey);
        OAuthTransactionStore.HandoffReceipt handoffCollision = storeTwo.issueHandoff(handoff);
        assertFalse(handoffCollision.accepted());
        assertEquals(1, handoffCollision.expiresInSeconds());
        long handoffAfterCollision = clientOne.getExpire(handoffKey, MILLISECONDS);
        assertTrue(handoffAfterCollision > 0 && handoffAfterCollision <= handoffBeforeCollision,
                () -> "collision must not extend handoff lifetime: before="
                        + handoffBeforeCollision + ", after=" + handoffAfterCollision);
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED,
                storeOne.consumeHandoff(binding(handoff)).status());
    }

    @Test
    void everyWrongHandoffBindingFieldLeavesAFreshRecordForCorrectProof() {
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                token(), handoff.transactionId(), handoff.intent(), handoff.clientId(),
                handoff.returnTargetId(), handoff.codeChallenge()));
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), token(), handoff.intent(), handoff.clientId(),
                handoff.returnTargetId(), handoff.codeChallenge()));
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), handoff.transactionId(), OAuthTransactionStore.Intent.LINK,
                handoff.clientId(), handoff.returnTargetId(), handoff.codeChallenge()));
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), handoff.transactionId(), handoff.intent(), "other-client",
                handoff.returnTargetId(), handoff.codeChallenge()));
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), handoff.transactionId(), handoff.intent(), handoff.clientId(),
                "other-return", handoff.codeChallenge()));
        assertWrongHandoffBindingThenValidProof(handoff -> new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), handoff.transactionId(), handoff.intent(), handoff.clientId(),
                handoff.returnTargetId(), token()));
    }

    @Test
    void issueHandoffRejectsProofFailureLimitAboveConfiguredCeiling() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff accepted = handoff(transaction, identity("ceiling-accepted", true), 5);
        assertTrue(storeOne.issueHandoff(accepted).accepted());

        OAuthTransactionStore.Transaction rejectedTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff rejected = handoff(
                rejectedTransaction, identity("ceiling-rejected", true), 6);
        assertThrows(IllegalArgumentException.class, () -> storeOne.issueHandoff(rejected));
        assertFalse(clientOne.hasKey(handoffKey(rejected.handoffCodeFingerprint())));
    }

    @Test
    void tamperedCallbackWithoutLiveTtlIsRejectedWithoutReturningState() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        storeOne.start(transaction);
        String key = transactionKey(transaction.transactionId());
        assertTrue(clientOne.persist(key));

        assertThrows(DependencyUnavailableException.class, () -> storeTwo.consumeCallback(
                new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint())));
        assertTrue(clientOne.hasKey(key));
    }

    @Test
    void tamperedHandoffRecordsAreRejectedWithoutReturningIdentity() {
        OAuthTransactionStore.Transaction noTtlTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff noTtl = handoff(noTtlTransaction, identity("tampered-no-ttl", true), 5);
        storeOne.issueHandoff(noTtl);
        String noTtlKey = handoffKey(noTtl.handoffCodeFingerprint());
        assertTrue(clientOne.persist(noTtlKey));
        assertThrows(DependencyUnavailableException.class,
                () -> storeTwo.consumeHandoff(binding(noTtl)));

        OAuthTransactionStore.Transaction missingTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff missing = handoff(missingTransaction, identity("tampered-missing", true), 5);
        storeOne.issueHandoff(missing);
        String missingKey = handoffKey(missing.handoffCodeFingerprint());
        assertTrue(clientOne.opsForHash().delete(missingKey, "providerEmail") > 0);
        clientOne.expire(missingKey, 10, SECONDS);
        assertThrows(DependencyUnavailableException.class,
                () -> storeTwo.consumeHandoff(binding(missing)));

        OAuthTransactionStore.Transaction malformedTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff malformed = handoff(malformedTransaction, identity("tampered-malformed", true), 5);
        storeOne.issueHandoff(malformed);
        String malformedKey = handoffKey(malformed.handoffCodeFingerprint());
        clientOne.opsForHash().put(malformedKey, "proofFailures", "not-a-number");
        assertThrows(DependencyUnavailableException.class,
                () -> storeTwo.consumeHandoff(binding(malformed)));

        OAuthTransactionStore.Transaction atLimitTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff atLimit = handoff(atLimitTransaction, identity("tampered-limit", true), 5);
        storeOne.issueHandoff(atLimit);
        String atLimitKey = handoffKey(atLimit.handoffCodeFingerprint());
        clientOne.opsForHash().put(atLimitKey, "proofFailures", "5");
        assertThrows(DependencyUnavailableException.class,
                () -> storeTwo.consumeHandoff(binding(atLimit)));
        assertTrue(clientOne.hasKey(atLimitKey));

        OAuthTransactionStore.Transaction aboveCeilingTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff aboveCeiling = handoff(
                aboveCeilingTransaction, identity("tampered-ceiling", true), 5);
        storeOne.issueHandoff(aboveCeiling);
        String aboveCeilingKey = handoffKey(aboveCeiling.handoffCodeFingerprint());
        clientOne.opsForHash().put(aboveCeilingKey, "maxProofFailures", "6");
        assertThrows(DependencyUnavailableException.class,
                () -> storeTwo.consumeHandoff(binding(aboveCeiling)));
        assertTrue(clientOne.hasKey(aboveCeilingKey));
    }

    @Test
    void unavailableBackendFailsClosedWithBoundedSanitizedException() {
        LettuceClientConfiguration clientConfiguration = LettuceClientConfiguration.builder()
                .commandTimeout(Duration.ofMillis(250))
                .shutdownTimeout(Duration.ofMillis(100))
                .build();
        LettuceConnectionFactory unavailableFactory = new LettuceConnectionFactory(
                new RedisStandaloneConfiguration("127.0.0.1", 1), clientConfiguration);
        StringRedisTemplate unavailableClient = new StringRedisTemplate(unavailableFactory);
        try {
            unavailableFactory.afterPropertiesSet();
            unavailableClient.afterPropertiesSet();
            ValkeyOAuthTransactionStore unavailableStore = new ValkeyOAuthTransactionStore(
                    unavailableClient, testConfiguration());
            long started = System.nanoTime();
            DependencyUnavailableException exception = assertThrows(
                    DependencyUnavailableException.class,
                    () -> unavailableStore.start(transaction(OAuthTransactionStore.Intent.LOGIN)));
            long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();

            assertTrue(elapsedMillis < 5_000, () -> "unavailable backend was not bounded: " + elapsedMillis + "ms");
            assertEquals("A required authentication dependency is temporarily unavailable", exception.getMessage());
            assertNull(exception.getCause());
            assertFalse(exception.toString().contains("backend-provider-verifier"));
        } finally {
            unavailableFactory.destroy();
        }
    }

    @Test
    void exactProofFailureThresholdInvalidatesOnlyTheTargetedHandoff() {
        OAuthTransactionStore.Transaction firstTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Transaction secondTransaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff first = handoff(firstTransaction, identity("threshold-first", true), 3);
        OAuthTransactionStore.Handoff second = handoff(secondTransaction, identity("threshold-second", true), 3);
        storeOne.issueHandoff(first);
        storeOne.issueHandoff(second);
        OAuthTransactionStore.HandoffBinding wrong = new OAuthTransactionStore.HandoffBinding(
                first.handoffCodeFingerprint(), first.transactionId(), first.intent(), first.clientId(),
                first.returnTargetId(), token());

        assertEquals(OAuthTransactionStore.HandoffStatus.MISMATCH, storeTwo.consumeHandoff(wrong).status());
        assertEquals(OAuthTransactionStore.HandoffStatus.MISMATCH, storeTwo.consumeHandoff(wrong).status());
        assertTrue(clientOne.hasKey(handoffKey(first.handoffCodeFingerprint())));
        assertEquals(OAuthTransactionStore.HandoffStatus.TOO_MANY_PROOF_FAILURES,
                storeTwo.consumeHandoff(wrong).status());
        assertFalse(clientOne.hasKey(handoffKey(first.handoffCodeFingerprint())));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED,
                storeOne.consumeHandoff(binding(second)).status());
    }

    @Test
    void unknownHandoffFingerprintCannotMutateAnExistingValidRecord() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff handoff = handoff(transaction, identity("isolation-subject", true), 5);
        storeOne.issueHandoff(handoff);

        OAuthTransactionStore.HandoffBinding unknown = new OAuthTransactionStore.HandoffBinding(
                token(), handoff.transactionId(), handoff.intent(), handoff.clientId(), handoff.returnTargetId(),
                handoff.codeChallenge());
        assertEquals(OAuthTransactionStore.HandoffStatus.NOT_FOUND, storeTwo.consumeHandoff(unknown).status());
        assertTrue(clientOne.hasKey(handoffKey(handoff.handoffCodeFingerprint())));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED,
                storeTwo.consumeHandoff(binding(handoff)).status());
    }

    @Test
    void concurrentConsumersHaveExactlyOneWinner() throws Exception {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff handoff = handoff(transaction, identity("race-subject", true), 5);
        storeOne.issueHandoff(handoff);
        List<OAuthTransactionStore.HandoffStatus> statuses = concurrently(8, () -> storeTwo.consumeHandoff(binding(handoff)).status());

        assertEquals(1, statuses.stream().filter(OAuthTransactionStore.HandoffStatus.CONSUMED::equals).count());
        assertEquals(7, statuses.stream().filter(OAuthTransactionStore.HandoffStatus.NOT_FOUND::equals).count());
    }

    @Test
    void expiredRecordsBecomeNotFoundWithoutRetainedTombstones() {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN, Duration.ofSeconds(2));
        storeOne.start(transaction);
        String transactionKey = transactionKey(transaction.transactionId());
        assertTtl(transactionKey, 2);
        awaitAbsent(transactionKey);
        assertEquals(OAuthTransactionStore.CallbackStatus.NOT_FOUND,
                storeTwo.consumeCallback(new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint())).status());

        OAuthTransactionStore.Handoff handoff = handoff(transaction, identity("expiry-subject", true), 5,
                Duration.ofSeconds(2));
        storeOne.issueHandoff(handoff);
        String handoffKey = handoffKey(handoff.handoffCodeFingerprint());
        assertTtl(handoffKey, 2);
        awaitAbsent(handoffKey);
        assertEquals(OAuthTransactionStore.HandoffStatus.NOT_FOUND,
                storeOne.consumeHandoff(binding(handoff)).status());
    }

    private OAuthTransactionStore.Transaction transaction(OAuthTransactionStore.Intent intent) {
        return transaction(intent, Duration.ofSeconds(5));
    }

    private OAuthTransactionStore.Transaction transaction(
            OAuthTransactionStore.Intent intent,
            Duration ttl
    ) {
        UUID userId = intent == OAuthTransactionStore.Intent.LINK
                ? UUID.fromString("00000000-0000-0000-0000-000000000001") : null;
        UUID sessionId = intent == OAuthTransactionStore.Intent.LINK
                ? UUID.fromString("00000000-0000-0000-0000-000000000002") : null;
        OAuthSecret credential = intent == OAuthTransactionStore.Intent.LINK
                ? new OAuthSecret("credential-fingerprint") : null;
        return new OAuthTransactionStore.Transaction(
                token(), intent, "web", "web", token(), token(),
                new OAuthSecret("backend-provider-verifier"), token(), userId, sessionId, credential, ttl);
    }

    private OAuthTransactionStore.Handoff handoff(
            OAuthTransactionStore.Transaction transaction,
            OAuthProviderClient.ProviderIdentity identity,
            int maxProofFailures
    ) {
        return handoff(transaction, identity, maxProofFailures, Duration.ofSeconds(5));
    }

    private OAuthTransactionStore.Handoff handoff(
            OAuthTransactionStore.Transaction transaction,
            OAuthProviderClient.ProviderIdentity identity,
            int maxProofFailures,
            Duration ttl
    ) {
        return new OAuthTransactionStore.Handoff(
                token(), transaction.transactionId(), transaction.intent(), transaction.clientId(),
                transaction.returnTargetId(), transaction.handoffCodeChallenge(), identity,
                transaction.userId(), transaction.sessionId(), transaction.credentialFingerprint(), ttl,
                maxProofFailures);
    }

    private void assertWrongHandoffBindingThenValidProof(
            Function<OAuthTransactionStore.Handoff, OAuthTransactionStore.HandoffBinding> wrongBindingFactory
    ) {
        OAuthTransactionStore.Transaction transaction = transaction(OAuthTransactionStore.Intent.LOGIN);
        OAuthTransactionStore.Handoff handoff = handoff(
                transaction, identity("binding-" + TOKEN_COUNTER.incrementAndGet(), true), 5);
        assertTrue(storeOne.issueHandoff(handoff).accepted());

        OAuthTransactionStore.HandoffBinding wrongBinding = wrongBindingFactory.apply(handoff);
        OAuthTransactionStore.HandoffStatus expected = handoff.handoffCodeFingerprint()
                .equals(wrongBinding.handoffCodeFingerprint())
                ? OAuthTransactionStore.HandoffStatus.MISMATCH
                : OAuthTransactionStore.HandoffStatus.NOT_FOUND;
        assertEquals(expected, storeTwo.consumeHandoff(wrongBinding).status());
        assertTrue(clientOne.hasKey(handoffKey(handoff.handoffCodeFingerprint())));
        assertEquals(OAuthTransactionStore.HandoffStatus.CONSUMED,
                storeOne.consumeHandoff(binding(handoff)).status());
    }

    private static OAuthTransactionStore.HandoffBinding binding(OAuthTransactionStore.Handoff handoff) {
        return new OAuthTransactionStore.HandoffBinding(
                handoff.handoffCodeFingerprint(), handoff.transactionId(), handoff.intent(), handoff.clientId(),
                handoff.returnTargetId(), handoff.codeChallenge());
    }

    private static OAuthProviderClient.ProviderIdentity identity(String subject, boolean emailVerified) {
        return identity(subject, emailVerified ? null : "person@example.com", emailVerified);
    }

    private static OAuthProviderClient.ProviderIdentity identity(
            String subject,
            String email,
            boolean emailVerified
    ) {
        return new OAuthProviderClient.ProviderIdentity(
                OAuthProvider.GOOGLE, subject, email, emailVerified,
                "example.com", Instant.parse("2026-09-09T00:00:00.123456Z"));
    }

    private static OAuthConfiguration testConfiguration() {
        OAuthClientRegistration registration = new OAuthClientRegistration(
                "web", "web", OAuthProvider.GOOGLE, "test-client",
                URI.create("http://localhost:8081/auth/oauth/google/callback"),
                URI.create("http://localhost:5173/auth/callback"), Set.of("http://localhost:5173"));
        return OAuthConfiguration.enabled(
                registration,
                URI.create("https://accounts.google.com"),
                new OAuthSecret("test-provider-secret"),
                Duration.ofSeconds(10), Duration.ofSeconds(10), Duration.ofSeconds(10),
                Duration.ofSeconds(5), 5, OAuthConfiguration.CookiePolicy.defaults(), Set.of());
    }

    private StringRedisTemplate template() {
        LettuceConnectionFactory connectionFactory = new LettuceConnectionFactory(
                valkey.getHost(), valkey.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        StringRedisTemplate template = new StringRedisTemplate(connectionFactory);
        template.afterPropertiesSet();
        return template;
    }

    private static String token() {
        long counter = TOKEN_COUNTER.incrementAndGet();
        byte[] bytes = new byte[32];
        java.nio.ByteBuffer.wrap(bytes).putLong(counter).putLong(~counter);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String transactionKey(String transactionId) {
        return "oauth:tx:" + transactionId;
    }

    private static String handoffKey(String handoffFingerprint) {
        return "oauth:handoff:" + handoffFingerprint;
    }

    private void assertTtl(String key, long maximumSeconds) {
        long ttl = clientOne.getExpire(key, SECONDS);
        assertTrue(ttl > 0 && ttl <= maximumSeconds,
                () -> "expected positive TTL <= " + maximumSeconds + " for " + key + ", got " + ttl);
    }

    private void awaitAbsent(String key) {
        long deadline = System.nanoTime() + Duration.ofSeconds(4).toNanos();
        while (System.nanoTime() < deadline && clientOne.hasKey(key)) {
            try {
                Thread.sleep(50);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError("interrupted while waiting for Redis expiry", exception);
            }
        }
        assertFalse(clientOne.hasKey(key), () -> "key did not expire: " + key);
    }

    private long awaitSubsecondTtl(String key) {
        long deadline = System.nanoTime() + Duration.ofSeconds(2).toNanos();
        while (System.nanoTime() < deadline) {
            long pttl = clientOne.getExpire(key, MILLISECONDS);
            if (pttl > 200 && pttl < 1_000) {
                return pttl;
            }
            try {
                Thread.sleep(20);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError("interrupted while waiting for subsecond TTL", exception);
            }
        }
        throw new AssertionError("key did not reach a positive subsecond TTL: " + key);
    }

    private static <T> List<T> concurrently(int count, java.util.function.Supplier<T> task) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(count);
        try {
            CountDownLatch ready = new CountDownLatch(count);
            CountDownLatch start = new CountDownLatch(1);
            List<Future<T>> futures = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                futures.add(executor.submit(() -> runAfter(ready, start, task)));
            }
            assertTrue(ready.await(10, SECONDS));
            start.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) {
                results.add(future.get(15, SECONDS));
            }
            return results;
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
