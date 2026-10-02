package com.weav.identity.infrastructure.authstate;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import com.weav.identity.infrastructure.security.oauth.GoogleOidcAdapter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ValkeyOAuthTransactionStoreWiringIntegrationTest {

    @Container
    static final GenericContainer<?> VALKEY = new GenericContainer<>(
            DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private OAuthTransactionStore transactionStore;

    @Autowired
    private OAuthProviderClient providerClient;

    @Autowired
    private OAuthFlowCoordinator flowCoordinator;

    @DynamicPropertySource
    static void dependencies(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.url", () ->
                "redis://" + VALKEY.getHost() + ":" + VALKEY.getMappedPort(6379));
        registry.add("weav.oauth.enabled", () -> "true");
        registry.add("weav.oauth.google.client-id", () -> "enabled-test-client");
        registry.add("weav.oauth.google.client-secret", () -> "enabled-test-provider-secret");
        registry.add("weav.oauth.google.issuer-uri", () -> "https://accounts.google.com");
        registry.add("weav.oauth.google.redirect-uri", () ->
                "http://localhost:8081/auth/oauth/google/callback");
        registry.add("weav.oauth.web.return-target-uri", () ->
                "http://localhost:5173/auth/callback");
        registry.add("weav.oauth.web.allowed-origins[0]", () -> "http://localhost:5173");
    }

    @Test
    void enabledConfigurationRegistersOneStoreAndLazilyCreatesProviderRuntime() throws Exception {
        Map<String, OAuthTransactionStore> stores = applicationContext.getBeansOfType(OAuthTransactionStore.class);
        Map<String, OAuthProviderClient> providers = applicationContext.getBeansOfType(OAuthProviderClient.class);
        Map<String, OAuthFlowCoordinator> coordinators = applicationContext.getBeansOfType(OAuthFlowCoordinator.class);

        assertEquals(1, stores.size());
        assertEquals(1, providers.size());
        assertEquals(1, coordinators.size());
        assertInstanceOf(ValkeyOAuthTransactionStore.class, transactionStore);
        assertInstanceOf(GoogleOidcAdapter.class, providerClient);
        assertInstanceOf(OAuthFlowCoordinator.class, flowCoordinator);
        var providerRuntime = GoogleOidcAdapter.class.getDeclaredField("providerRuntime");
        providerRuntime.setAccessible(true);
        assertTrue(providerRuntime.get(providerClient) == null,
                "provider discovery must remain lazy during context startup");
        assertTrue(applicationContext.getBean("oauthConfiguration", com.weav.identity.application.dto.OAuthConfiguration.class)
                .enabled());

        OAuthTransactionStore.Transaction transaction = transaction();
        assertTrue(transactionStore.start(transaction).accepted());
        assertEquals(OAuthTransactionStore.CallbackStatus.CONSUMED,
                transactionStore.consumeCallback(new OAuthTransactionStore.CallbackBinding(
                        transaction.transactionId(), transaction.transactionId(), transaction.providerStateFingerprint()))
                        .status());
    }

    private static OAuthTransactionStore.Transaction transaction() {
        return new OAuthTransactionStore.Transaction(
                token(1), OAuthTransactionStore.Intent.LOGIN, "web", "web", token(2), token(3),
                new OAuthSecret("enabled-provider-verifier"), token(4), null, null, null,
                Duration.ofSeconds(10));
    }

    private static String token(long seed) {
        byte[] bytes = new byte[32];
        ByteBuffer.wrap(bytes).putLong(seed).putLong(~seed);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
