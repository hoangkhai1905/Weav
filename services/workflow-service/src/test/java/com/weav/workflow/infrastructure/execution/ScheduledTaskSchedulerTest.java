package com.weav.workflow.infrastructure.execution;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScheduledTaskSchedulerTest {

    @Test
    void scheduledJobsRunOnTheDedicatedSchedulerNotTheRunnerTimer() throws Exception {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test",
                    Map.of("weav.workflow.scheduling.pool-size", "3")));
            context.register(BoundedExecutionConfiguration.class, ProbeJob.class);
            context.refresh();

            String threadName = context.getBean(ProbeJob.class).ran.get(5, TimeUnit.SECONDS);

            assertTrue(threadName.startsWith("workflow-scheduling-"), threadName);
            assertEquals(3, context.getBean("taskScheduler", ThreadPoolTaskScheduler.class)
                    .getScheduledThreadPoolExecutor().getCorePoolSize());
        }
    }

    @Test
    void rejectsOutOfRangeSchedulerPool() {
        BoundedExecutionConfiguration configuration = new BoundedExecutionConfiguration();
        assertThrows(IllegalArgumentException.class, () -> configuration.taskScheduler(0));
        assertThrows(IllegalArgumentException.class, () -> configuration.taskScheduler(33));
    }

    static class ProbeJob {
        final CompletableFuture<String> ran = new CompletableFuture<>();

        @Scheduled(fixedDelay = 10)
        void tick() {
            ran.complete(Thread.currentThread().getName());
        }
    }
}
