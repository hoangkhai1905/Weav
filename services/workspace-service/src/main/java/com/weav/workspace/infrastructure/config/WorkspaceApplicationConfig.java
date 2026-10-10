package com.weav.workspace.infrastructure.config;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthCompletionStore;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.port.out.NotificationOutboxPort;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.infrastructure.cache.RedisWorkspaceAuthorizationCache;
import com.weav.workspace.infrastructure.cache.RedisOAuthCompletionStore;
import com.weav.workspace.infrastructure.cache.RedisOAuthStateStore;
import com.weav.workspace.infrastructure.cache.WorkspaceAuthorizationCacheProperties;
import com.weav.workspace.infrastructure.credential.AesGcmCredentialCrypto;
import com.weav.workspace.infrastructure.provider.google.GoogleConnectionProvider;
import com.weav.workspace.infrastructure.provider.google.GoogleOAuthProvider;
import com.weav.workspace.infrastructure.persistence.SpringTransactionRunner;
import com.weav.workspace.infrastructure.persistence.SpringAfterCommitExecutor;
import com.weav.workspace.infrastructure.provider.http.HttpConnectionProvider;
import com.weav.workspace.infrastructure.provider.http.HttpTargetValidator;
import com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport;
import com.weav.workspace.infrastructure.provider.discord.DiscordConnectionProvider;
import com.weav.workspace.infrastructure.provider.telegram.TelegramConnectionProvider;
import com.weav.workspace.infrastructure.workflow.WorkflowConnectionUsageClient;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.boot.amqp.autoconfigure.RabbitTemplateCustomizer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.net.URI;
import java.net.http.HttpClient;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@EnableConfigurationProperties({
        WorkspaceAuthorizationCacheProperties.class,
        CredentialEncryptionProperties.class,
        WorkflowServiceProperties.class,
        GoogleOAuthProperties.class})
public class WorkspaceApplicationConfig {

    @Bean
    public TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
        TransactionTemplate required = new TransactionTemplate(transactionManager);
        TransactionTemplate requiresNew = new TransactionTemplate(transactionManager);
        requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return new SpringTransactionRunner(required, requiresNew);
    }

    @Bean
    public WorkspaceNotificationRecorder workspaceNotificationRecorder(
            NotificationOutboxPort outbox) {
        return new WorkspaceNotificationRecorder(outbox, java.time.Clock.systemUTC());
    }

    @Bean
    public ConnectionNotificationRecorder connectionNotificationRecorder(
            NotificationOutboxPort outbox,
            com.weav.workspace.domain.port.out.WorkspaceRepository workspaceRepository,
            com.weav.workspace.domain.port.out.MembershipRepository membershipRepository,
            ConnectionAuthorizationPolicy authorizationPolicy) {
        return new ConnectionNotificationRecorder(
                outbox,
                workspaceRepository,
                membershipRepository,
                authorizationPolicy,
                java.time.Clock.systemUTC());
    }

    @Bean
    public RabbitTemplateCustomizer workspaceNotificationRabbitTemplateCustomizer() {
        return rabbitTemplate -> {
            rabbitTemplate.setMandatory(true);
            rabbitTemplate.setReturnsCallback(returned -> {
                // CorrelationData captures the returned message; do not log its payload.
            });
        };
    }

    @Bean
    public WorkspaceAuthorizationPolicy workspaceAuthorizationPolicy() {
        return new WorkspaceAuthorizationPolicy();
    }

    @Bean
    public ConnectionProviderPolicy connectionProviderPolicy() {
        return new ConnectionProviderPolicy();
    }

    @Bean
    public GoogleOAuthScopePolicy googleOAuthScopePolicy() {
        return new GoogleOAuthScopePolicy();
    }

    @Bean
    public ConnectionAuthorizationPolicy connectionAuthorizationPolicy() {
        return new ConnectionAuthorizationPolicy();
    }

    @Bean
    public ConnectionConfigPolicy connectionConfigPolicy() {
        return new ConnectionConfigPolicy();
    }

    @Bean("workflowConnectionUsageRestClient")
    public RestClient workflowConnectionUsageRestClient(WorkflowServiceProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.readTimeout());
        return RestClient.builder()
                .requestFactory(requestFactory)
                .build();
    }

    @Bean
    public WorkflowConnectionUsagePort workflowConnectionUsagePort(
            @Qualifier("workflowConnectionUsageRestClient") RestClient restClient,
            WorkflowServiceProperties properties,
            ObjectMapper objectMapper,
            @Value("${weav.workflow.circuit-breaker.window-size:20}") int window,
            @Value("${weav.workflow.circuit-breaker.failure-rate-percent:50}") float failureRate,
            @Value("${weav.workflow.circuit-breaker.minimum-calls:10}") int minimumCalls,
            @Value("${weav.workflow.circuit-breaker.open-duration:10s}") Duration openFor,
            @Value("${weav.workflow.circuit-breaker.half-open-permits:3}") int halfOpenPermits) {
        return new WorkflowConnectionUsageClient(restClient, properties, objectMapper,
                WorkflowConnectionUsageClient.circuitBreaker(window, failureRate, minimumCalls, openFor, halfOpenPermits));
    }

    /** Pausing every workflow (and unregistering Telegram bots) outlasts the 5 s usage-lookup read timeout. */
    @Bean("workflowShutdownRestClient")
    public RestClient workflowShutdownRestClient(
            WorkflowServiceProperties properties,
            @Value("${weav.workflow.shutdown-read-timeout:30s}") Duration readTimeout) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return RestClient.builder().requestFactory(requestFactory).build();
    }

    @Bean
    public com.weav.workspace.application.port.out.WorkflowShutdownPort workflowShutdownPort(
            @Qualifier("workflowShutdownRestClient") RestClient restClient,
            WorkflowServiceProperties properties,
            ObjectMapper objectMapper,
            @Value("${weav.workflow.circuit-breaker.window-size:20}") int window,
            @Value("${weav.workflow.circuit-breaker.failure-rate-percent:50}") float failureRate,
            @Value("${weav.workflow.circuit-breaker.minimum-calls:10}") int minimumCalls,
            @Value("${weav.workflow.circuit-breaker.open-duration:10s}") Duration openFor,
            @Value("${weav.workflow.circuit-breaker.half-open-permits:3}") int halfOpenPermits) {
        return new com.weav.workspace.infrastructure.workflow.WorkflowShutdownClient(
                restClient, properties, objectMapper,
                WorkflowConnectionUsageClient.circuitBreaker(window, failureRate, minimumCalls, openFor, halfOpenPermits));
    }

    @Bean("googleOAuthRestClient")
    public RestClient googleOAuthRestClient() {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(5));
        return RestClient.builder().requestFactory(requestFactory).build();
    }

    @Bean
    public GoogleOAuthPort googleOAuthPort(
            @Qualifier("googleOAuthRestClient") RestClient restClient,
            GoogleOAuthProperties properties,
            GoogleOAuthScopePolicy scopePolicy,
            ObjectMapper objectMapper) {
        return new GoogleOAuthProvider(restClient, properties, scopePolicy, objectMapper);
    }

    @Bean("gmailConnectionProvider")
    public GoogleConnectionProvider gmailConnectionProvider(
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy) {
        return new GoogleConnectionProvider(
                com.weav.workspace.domain.valueobject.ConnectionProvider.GMAIL,
                googleOAuthPort,
                scopePolicy);
    }

    @Bean("googleSheetsConnectionProvider")
    public GoogleConnectionProvider googleSheetsConnectionProvider(
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy) {
        return new GoogleConnectionProvider(
                com.weav.workspace.domain.valueobject.ConnectionProvider.GOOGLE_SHEETS,
                googleOAuthPort,
                scopePolicy);
    }

    @Bean("googleCalendarConnectionProvider")
    public GoogleConnectionProvider googleCalendarConnectionProvider(
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy) {
        return new GoogleConnectionProvider(
                com.weav.workspace.domain.valueobject.ConnectionProvider.GOOGLE_CALENDAR,
                googleOAuthPort,
                scopePolicy);
    }

    @Bean("googleDriveConnectionProvider")
    public GoogleConnectionProvider googleDriveConnectionProvider(
            GoogleOAuthPort googleOAuthPort,
            GoogleOAuthScopePolicy scopePolicy) {
        return new GoogleConnectionProvider(
                com.weav.workspace.domain.valueobject.ConnectionProvider.GOOGLE_DRIVE,
                googleOAuthPort,
                scopePolicy);
    }

    @Bean
    public ConnectionUsageProtection connectionUsageProtection(
            com.weav.workspace.domain.port.out.ConnectionRepository connectionRepository,
            com.weav.workspace.domain.port.out.MembershipRepository membershipRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock workspaceMutationLock) {
        return new ConnectionUsageProtection(
                connectionRepository,
                membershipRepository,
                authorizationPolicy,
                workflowConnectionUsagePort,
                transactionRunner,
                workspaceMutationLock);
    }

    @Bean
    public CredentialPayloadCodec credentialPayloadCodec(
            ObjectMapper objectMapper,
            ConnectionProviderPolicy providerPolicy) {
        return new CredentialPayloadCodec(objectMapper, providerPolicy);
    }

    @Bean
    public CredentialCryptoPort credentialCrypto(CredentialEncryptionProperties properties) {
        return new AesGcmCredentialCrypto(properties);
    }

    @Bean
    public HttpTargetValidator httpTargetValidator() {
        return new HttpTargetValidator();
    }

    @Bean
    public PinnedHttpTransport pinnedHttpTransport() {
        return new PinnedHttpTransport();
    }

    @Bean
    public HttpConnectionProvider httpConnectionProvider(
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport) {
        return new HttpConnectionProvider(targetValidator, transport);
    }

    @Bean
    public TelegramConnectionProvider telegramConnectionProvider(
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport,
            ObjectMapper objectMapper) {
        return new TelegramConnectionProvider(
                URI.create("https://api.telegram.org/"),
                targetValidator,
                transport,
                objectMapper);
    }

    @Bean
    public DiscordConnectionProvider discordConnectionProvider(
            HttpTargetValidator targetValidator,
            PinnedHttpTransport transport) {
        return new DiscordConnectionProvider(targetValidator, transport);
    }

    @Bean
    public ConnectionProviderRegistry connectionProviderRegistry(
            TelegramConnectionProvider telegramConnectionProvider,
            DiscordConnectionProvider discordConnectionProvider,
            HttpConnectionProvider httpConnectionProvider,
            @Qualifier("gmailConnectionProvider") GoogleConnectionProvider gmailConnectionProvider,
            @Qualifier("googleSheetsConnectionProvider") GoogleConnectionProvider googleSheetsConnectionProvider,
            @Qualifier("googleCalendarConnectionProvider") GoogleConnectionProvider googleCalendarConnectionProvider,
            @Qualifier("googleDriveConnectionProvider") GoogleConnectionProvider googleDriveConnectionProvider) {
        return new ConnectionProviderRegistry(
                telegramConnectionProvider,
                discordConnectionProvider,
                httpConnectionProvider,
                gmailConnectionProvider,
                googleSheetsConnectionProvider,
                googleCalendarConnectionProvider,
                googleDriveConnectionProvider);
    }

    @Bean
    public WorkspaceAuthorizationCache workspaceAuthorizationCache(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            WorkspaceAuthorizationCacheProperties properties) {
        return new RedisWorkspaceAuthorizationCache(redis, objectMapper, properties.ttl());
    }

    @Bean
    public OAuthStateStore oauthStateStore(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            GoogleOAuthProperties properties) {
        return new RedisOAuthStateStore(redis, objectMapper, properties.stateTtl());
    }

    @Bean
    public OAuthCompletionStore oauthCompletionStore(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            @Value("${weav.google.oauth.completion-ttl:PT5M}") Duration completionTtl) {
        // Short on purpose: Google codes expire after ~10 minutes and the browser hop takes seconds.
        if (completionTtl.compareTo(Duration.ofSeconds(1)) < 0 || completionTtl.compareTo(Duration.ofMinutes(10)) > 0) {
            throw new IllegalStateException("weav.google.oauth.completion-ttl must be between PT1S and PT10M");
        }
        return new RedisOAuthCompletionStore(redis, objectMapper, completionTtl);
    }

    @Bean
    public AfterCommitExecutor afterCommitExecutor() {
        return new SpringAfterCommitExecutor();
    }

    @Bean("workspaceAuthorizationCacheTtl")
    public Duration workspaceAuthorizationCacheTtl(WorkspaceAuthorizationCacheProperties properties) {
        return properties.ttl();
    }
}
