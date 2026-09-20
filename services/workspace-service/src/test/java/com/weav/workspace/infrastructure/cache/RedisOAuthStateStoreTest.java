package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.application.dto.OAuthPendingState;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Testcontainers
class RedisOAuthStateStoreTest {

    @Container
    private static final GenericContainer<?> valkey = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine"))
            .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;
    private static final ObjectMapper objectMapper = new ObjectMapper();

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
    void stateIsStoredWithOnlyTheFourCallbackFieldsAndConsumedOnce() {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String state = randomState();
        OAuthPendingState pending = new OAuthPendingState(
                workspaceId, connectionId, userId, ConnectionProvider.GOOGLE_SHEETS);
        RedisOAuthStateStore store = new RedisOAuthStateStore(redis, objectMapper, Duration.ofMinutes(10));

        store.save(state, pending);

        String stored = redis.opsForValue().get(key(state));
        assertThat(stored).isNotNull();
        JsonNode json = objectMapper.readTree(stored);
        assertThat(json.size()).isEqualTo(4);
        assertThat(json.get("workspaceId").asText()).isEqualTo(workspaceId.toString());
        assertThat(json.get("connectionId").asText()).isEqualTo(connectionId.toString());
        assertThat(json.get("userId").asText()).isEqualTo(userId.toString());
        assertThat(json.get("provider").asText()).isEqualTo("GOOGLE_SHEETS");
        assertThat(stored).doesNotContain("accessToken", "refreshToken", "authorizationCode");
        assertThat(redis.getExpire(key(state), TimeUnit.SECONDS)).isBetween(590L, 600L);

        assertThat(store.consume(state)).contains(pending);
        assertThat(store.consume(state)).isEmpty();
        assertThat(redis.opsForValue().get(key(state))).isNull();
    }

    @Test
    void expiredStateCannotBeConsumed() throws Exception {
        String state = randomState();
        RedisOAuthStateStore store = new RedisOAuthStateStore(redis, objectMapper, Duration.ofSeconds(1));
        store.save(state, pendingState());
        long expiryDeadline = System.nanoTime() + Duration.ofSeconds(4).toNanos();
        while (System.nanoTime() < expiryDeadline && redis.getExpire(key(state), TimeUnit.MILLISECONDS) > 0) {
            Thread.sleep(40);
        }

        assertThat(store.consume(state)).isEmpty();
        assertThat(redis.getExpire(key(state))).isLessThanOrEqualTo(0);
    }

    @Test
    void concurrentConsumersCanWinOnlyOnce() throws Exception {
        String state = randomState();
        RedisOAuthStateStore store = new RedisOAuthStateStore(redis, objectMapper, Duration.ofMinutes(1));
        store.save(state, pendingState());
        int consumers = 24;
        ExecutorService executor = Executors.newFixedThreadPool(consumers);
        CountDownLatch ready = new CountDownLatch(consumers);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int index = 0; index < consumers; index++) {
                results.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, TimeUnit.SECONDS)) {
                        return false;
                    }
                    return store.consume(state).isPresent();
                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            long winners = 0;
            for (Future<Boolean> result : results) {
                if (result.get(5, TimeUnit.SECONDS)) {
                    winners++;
                }
            }
            assertThat(winners).isEqualTo(1);
            assertThat(redis.opsForValue().get(key(state))).isNull();
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void malformedOrUnknownStatePayloadIsConsumedAndRejected() {
        String state = randomState();
        redis.opsForValue().set(key(state),
                "{\"workspaceId\":\"" + UUID.randomUUID()
                        + "\",\"connectionId\":\"" + UUID.randomUUID()
                        + "\",\"userId\":\"" + UUID.randomUUID()
                        + "\",\"provider\":\"GMAIL\",\"authorizationCode\":\"synthetic\"}",
                Duration.ofMinutes(1));
        RedisOAuthStateStore store = new RedisOAuthStateStore(redis, objectMapper, Duration.ofMinutes(1));

        assertThat(store.consume(state)).isEmpty();
        assertThat(store.consume(state)).isEmpty();
    }

    @Test
    void redisOutageFailsClosedForStateWritesAndConsumes() {
        StringRedisTemplate failingRedis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> failingValues = mock(ValueOperations.class);
        when(failingRedis.opsForValue()).thenReturn(failingValues);
        doThrow(new RedisConnectionFailureException("synthetic unavailable"))
                .when(failingValues).set(anyString(), anyString(), any(Duration.class));
        doThrow(new RedisConnectionFailureException("synthetic unavailable"))
                .when(failingRedis).execute(any(RedisScript.class), anyList());
        RedisOAuthStateStore store = new RedisOAuthStateStore(
                failingRedis, objectMapper, Duration.ofMinutes(1));
        String state = randomState();

        assertThatThrownBy(() -> store.save(state, pendingState()))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
        assertThatThrownBy(() -> store.consume(state))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");
    }

    private static OAuthPendingState pendingState() {
        return new OAuthPendingState(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), ConnectionProvider.GMAIL);
    }

    private static String randomState() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String key(String state) {
        return "workspace:oauth-state:" + state;
    }
}
