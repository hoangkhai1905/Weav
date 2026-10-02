package com.weav.workspace.infrastructure.cache;

import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisWorkspaceAuthorizationCacheLoggingTest {

    @Test
    void logsStructuredReadFailureWithRequestIdAndWithoutCacheSecrets() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock();
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenThrow(new IllegalStateException("redis password secret"));
        RedisWorkspaceAuthorizationCache cache = new RedisWorkspaceAuthorizationCache(redis, new ObjectMapper());

        Logger logger = (Logger) LoggerFactory.getLogger(RedisWorkspaceAuthorizationCache.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        MDC.put(RequestCorrelationFilter.MDC_KEY, "cache-test-42");
        try {
            cache.get(UUID.randomUUID(), UUID.randomUUID());
        } finally {
            MDC.remove(RequestCorrelationFilter.MDC_KEY);
            logger.detachAppender(appender);
        }

        String message = appender.list.get(0).getFormattedMessage();
        assertTrue(message.contains("event=workspace_authorization_cache_failure"));
        assertTrue(message.contains("requestId=cache-test-42"));
        assertTrue(message.contains("operation=read"));
        assertTrue(message.contains("downstream=redis"));
        assertTrue(message.contains("errorType=IllegalStateException"));
        assertTrue(message.contains("latencyMs="));
        assertFalse(message.contains("redis password secret"));
        assertFalse(message.contains("Authorization"));
        assertFalse(message.contains("X-Internal-Service-Key"));
    }

    @Test
    void evictRetriesTransientFailureThenSucceedsWithoutErrorLog() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new IllegalStateException("down"))
                .thenThrow(new IllegalStateException("down"))
                .thenReturn(1L);
        RedisWorkspaceAuthorizationCache cache = new RedisWorkspaceAuthorizationCache(redis, new ObjectMapper());

        ListAppender<ILoggingEvent> appender = attach();
        try {
            cache.evict(UUID.randomUUID(), UUID.randomUUID());
        } finally {
            detach(appender);
        }

        verify(redis, times(3)).execute(any(RedisScript.class), anyList(), any(Object[].class));
        assertFalse(appender.list.stream().anyMatch(e -> e.getLevel() == Level.ERROR));
    }

    @Test
    void evictPermanentFailureLogsErrorWithoutThrowingOrLeakingDetails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class)))
                .thenThrow(new IllegalStateException("redis password secret"));
        RedisWorkspaceAuthorizationCache cache = new RedisWorkspaceAuthorizationCache(redis, new ObjectMapper());
        UUID workspaceId = UUID.randomUUID();

        ListAppender<ILoggingEvent> appender = attach();
        try {
            cache.evict(workspaceId, UUID.randomUUID());
        } finally {
            detach(appender);
        }

        verify(redis, times(4)).execute(any(RedisScript.class), anyList(), any(Object[].class));
        ILoggingEvent error = appender.list.stream()
                .filter(e -> e.getLevel() == Level.ERROR).findFirst().orElseThrow();
        assertTrue(error.getFormattedMessage().contains("event=workspace_authorization_cache_evict_failed"));
        assertTrue(error.getFormattedMessage().contains("workspaceId=" + workspaceId));
        assertFalse(error.getFormattedMessage().contains("redis password secret"));
    }

    private static ListAppender<ILoggingEvent> attach() {
        Logger logger = (Logger) LoggerFactory.getLogger(RedisWorkspaceAuthorizationCache.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        return appender;
    }

    private static void detach(ListAppender<ILoggingEvent> appender) {
        ((Logger) LoggerFactory.getLogger(RedisWorkspaceAuthorizationCache.class)).detachAppender(appender);
    }
}
