package com.weav.identity.presentation.http;

import com.weav.identity.application.usecase.UpdateAvatarUseCase;
import com.weav.identity.infrastructure.security.AuthRateLimitExceededException;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.oauth2.jwt.Jwt;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class AvatarControllerRateLimitTest {

    private static final GenericContainer<?> VALKEY =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);
    private static LettuceConnectionFactory connectionFactory;

    @BeforeAll
    static void connect() {
        VALKEY.start();
        connectionFactory = new LettuceConnectionFactory(VALKEY.getHost(), VALKEY.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
    }

    @AfterAll
    static void disconnect() {
        connectionFactory.destroy();
        VALKEY.stop();
    }

    @Test
    void eleventhUploadInTheWindowIsRejectedBeforeTheUseCaseRuns() {
        StringRedisTemplate redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
        UpdateAvatarUseCase useCase = mock(UpdateAvatarUseCase.class);
        AvatarController controller = new AvatarController(useCase, null, null,
                mock(UserPresentationMapper.class), new AuthRateLimiter(redis));
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("sid", UUID.randomUUID().toString()).issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60)).build();
        MockMultipartFile file = new MockMultipartFile("file", "a.png", "image/png", new byte[]{1});

        for (int upload = 0; upload < 10; upload++) {
            controller.updateAvatar(jwt, file);
        }
        assertThrows(AuthRateLimitExceededException.class, () -> controller.updateAvatar(jwt, file));

        verify(useCase, times(10)).execute(any(), any(), any(), any());
    }
}
