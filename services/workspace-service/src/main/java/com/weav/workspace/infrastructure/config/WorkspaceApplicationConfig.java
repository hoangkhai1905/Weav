package com.weav.workspace.infrastructure.config;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.domain.policy.WorkspaceAuthorizationPolicy;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.infrastructure.cache.RedisWorkspaceAuthorizationCache;
import com.weav.workspace.infrastructure.cache.WorkspaceAuthorizationCacheProperties;
import com.weav.workspace.infrastructure.persistence.SpringTransactionRunner;
import com.weav.workspace.infrastructure.persistence.SpringAfterCommitExecutor;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(WorkspaceAuthorizationCacheProperties.class)
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
    public WorkspaceAuthorizationCache workspaceAuthorizationCache(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            WorkspaceAuthorizationCacheProperties properties) {
        return new RedisWorkspaceAuthorizationCache(redis, objectMapper, properties.ttl());
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
