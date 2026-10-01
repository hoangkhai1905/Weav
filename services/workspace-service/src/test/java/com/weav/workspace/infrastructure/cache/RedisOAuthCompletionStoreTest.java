package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.application.port.out.OAuthCompletionStore.PendingCompletion;
import com.weav.workspace.application.port.out.OAuthStateStore.ConsumedState;
import com.weav.workspace.application.port.out.OAuthStateStore.NotificationOrigin;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class RedisOAuthCompletionStoreTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(valkey.getHost(), valkey.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void closeRedis() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    @BeforeEach
    void clearRedis() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
    }

    @Test
    void roundTripsOnceWithTtlAndRedactedToString() {
        RedisOAuthCompletionStore store = new RedisOAuthCompletionStore(redis, objectMapper, Duration.ofMinutes(5));
        String id = randomId();
        PendingCompletion completion = completion("synthetic-code");

        store.save(id, completion);

        assertThat(redis.getExpire("workspace:oauth-completion:" + id, TimeUnit.SECONDS)).isBetween(290L, 300L);
        assertThat(store.consume(id)).contains(completion);
        assertThat(store.consume(id)).isEmpty();
        assertThat(redis.hasKey("workspace:oauth-completion:" + id)).isFalse();
        assertThat(completion.toString()).doesNotContain("synthetic-code");
    }

    @Test
    void concurrentConsumersCanNeverBothWin() throws Exception {
        RedisOAuthCompletionStore store = new RedisOAuthCompletionStore(redis, objectMapper, Duration.ofMinutes(5));
        int threads = 16;
        for (int round = 0; round < 10; round++) {
            String id = randomId();
            store.save(id, completion("synthetic-code"));
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            CountDownLatch start = new CountDownLatch(1);
            try {
                List<Future<Boolean>> results = new ArrayList<>();
                for (int i = 0; i < threads; i++) {
                    results.add(pool.submit(() -> {
                        start.await();
                        return store.consume(id).isPresent();
                    }));
                }
                start.countDown();
                int winners = 0;
                for (Future<Boolean> result : results) {
                    if (result.get(10, TimeUnit.SECONDS)) {
                        winners++;
                    }
                }
                assertThat(winners).isEqualTo(1);
            } finally {
                pool.shutdownNow();
            }
        }
    }

    @Test
    void unknownMalformedAndExpiredIdsAreEmpty() throws Exception {
        RedisOAuthCompletionStore store = new RedisOAuthCompletionStore(redis, objectMapper, Duration.ofSeconds(1));
        String id = randomId();
        store.save(id, completion("synthetic-code"));
        Thread.sleep(1500);

        assertThat(store.consume(id)).isEmpty();
        assertThat(store.consume(randomId())).isEmpty();
        assertThat(store.consume("short")).isEmpty();
        assertThat(store.consume(null)).isEmpty();
        assertThatThrownBy(() -> store.save("short", completion("c"))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void corruptedPayloadIsConsumedAndNeverTrusted() {
        RedisOAuthCompletionStore store = new RedisOAuthCompletionStore(redis, objectMapper, Duration.ofMinutes(5));
        String id = randomId();
        redis.opsForValue().set("workspace:oauth-completion:" + id, "{\"unexpected\":true}");

        assertThat(store.consume(id)).isEmpty();
        assertThat(redis.hasKey("workspace:oauth-completion:" + id)).isFalse();
    }

    @Test
    void redisFailureFailsClosed() {
        StringRedisTemplate broken = new StringRedisTemplate(new LettuceConnectionFactory("127.0.0.1", 1));
        broken.afterPropertiesSet();
        RedisOAuthCompletionStore store = new RedisOAuthCompletionStore(broken, objectMapper, Duration.ofMinutes(5));

        assertThatThrownBy(() -> store.save(randomId(), completion("c")))
                .isInstanceOf(DependencyUnavailableException.class);
        assertThatThrownBy(() -> store.consume(randomId()))
                .isInstanceOf(DependencyUnavailableException.class);
    }

    private static PendingCompletion completion(String code) {
        OAuthPendingState pending = new OAuthPendingState(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                ConnectionProvider.GMAIL, "v".repeat(64));
        return new PendingCompletion(new ConsumedState(pending, NotificationOrigin.NON_ACTIVE, null), code);
    }

    private static String randomId() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
