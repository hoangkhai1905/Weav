package com.weav.workspace.infrastructure.config;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.GoogleOAuthPort;
import com.weav.workspace.application.port.out.OAuthStateStore;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
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
import com.weav.workspace.infrastructure.provider.telegram.TelegramConnectionProvider;
import com.weav.workspace.infrastructure.workflow.WorkflowConnectionUsageClient;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.net.URI;
import java.net.http.HttpClient;

@Configuration(proxyBeanMethods = false)
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
            ObjectMapper objectMapper) {
        return new WorkflowConnectionUsageClient(restClient, properties, objectMapper);
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

    @Bean
    public ConnectionUsageProtection connectionUsageProtection(
            com.weav.workspace.domain.port.out.ConnectionRepository connectionRepository,
            com.weav.workspace.domain.port.out.MembershipRepository membershipRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner) {
        return new ConnectionUsageProtection(
                connectionRepository,
                membershipRepository,
                authorizationPolicy,
                workflowConnectionUsagePort,
                transactionRunner);
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
    public ConnectionProviderRegistry connectionProviderRegistry(
            TelegramConnectionProvider telegramConnectionProvider,
            HttpConnectionProvider httpConnectionProvider,
            @Qualifier("gmailConnectionProvider") GoogleConnectionProvider gmailConnectionProvider,
            @Qualifier("googleSheetsConnectionProvider") GoogleConnectionProvider googleSheetsConnectionProvider) {
        return new ConnectionProviderRegistry(
                telegramConnectionProvider,
                httpConnectionProvider,
                gmailConnectionProvider,
                googleSheetsConnectionProvider);
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
    public AfterCommitExecutor afterCommitExecutor() {
        return new SpringAfterCommitExecutor();
    }

    @Bean("workspaceAuthorizationCacheTtl")
    public Duration workspaceAuthorizationCacheTtl(WorkspaceAuthorizationCacheProperties properties) {
        return properties.ttl();
    }
}
