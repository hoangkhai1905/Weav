package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.usecase.LoginUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.infrastructure.security.AuthRateLimitExceededException;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.request.LoginRequest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthControllerLoginRateLimitTest {

    private static final GenericContainer<?> VALKEY =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);
    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;

    private final LoginUseCase loginUseCase = mock(LoginUseCase.class);
    private final LoginRequest request = new LoginRequest("User@Example.com", "Password123!");
    private AuthController controller;

    @BeforeAll
    static void connect() {
        VALKEY.start();
        connectionFactory = new LettuceConnectionFactory(VALKEY.getHost(), VALKEY.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void disconnect() {
        connectionFactory.destroy();
        VALKEY.stop();
    }

    @BeforeEach
    void reset() {
        redis.getConnectionFactory().getConnection().serverCommands().flushDb();
        controller = new AuthController(null, loginUseCase, null, null, new AuthRateLimiter(redis),
                new AuthInputPolicy(), mock(UserPresentationMapper.class));
    }

    @Test
    void successfulLoginsNeverBlock() {
        when(loginUseCase.execute(any())).thenReturn(mock(TokenPairResult.class));

        for (int login = 0; login < 50; login++) {
            assertDoesNotThrow(() -> controller.login(request, new MockHttpServletRequest()));
        }
    }

    @Test
    void failuresBlockAtTheLimit() {
        when(loginUseCase.execute(any())).thenThrow(new UnauthorizedException("Authentication failed"));

        for (int failure = 0; failure < 10; failure++) {
            assertThrows(UnauthorizedException.class, () -> controller.login(request, new MockHttpServletRequest()));
        }
        assertThrows(AuthRateLimitExceededException.class,
                () -> controller.login(request, new MockHttpServletRequest()));
    }

    @Test
    void parallelWrongPasswordGuessesCannotExceedTheLimit() throws Exception {
        AtomicInteger reachedUseCase = new AtomicInteger();
        when(loginUseCase.execute(any())).thenAnswer(invocation -> {
            reachedUseCase.incrementAndGet();
            throw new UnauthorizedException("Authentication failed");
        });
        for (int failure = 0; failure < 9; failure++) {
            assertThrows(UnauthorizedException.class, () -> controller.login(request, new MockHttpServletRequest()));
        }
        reachedUseCase.set(0);

        int callers = 5;
        CountDownLatch ready = new CountDownLatch(callers);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(callers);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (int index = 0; index < callers; index++) {
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    try {
                        controller.login(request, new MockHttpServletRequest());
                    } catch (UnauthorizedException | AuthRateLimitExceededException expected) {
                        // either a failed guess or a blocked request
                    }
                    return null;
                }));
            }
            ready.await();
            start.countDown();
            for (Future<?> future : futures) {
                future.get();
            }
        } finally {
            executor.shutdownNow();
        }

        assertEquals(1, reachedUseCase.get());
    }
}
