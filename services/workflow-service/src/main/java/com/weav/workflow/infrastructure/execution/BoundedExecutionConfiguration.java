package com.weav.workflow.infrastructure.execution;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Bounded local execution resources. Rabbit carries executions, not individual nodes. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class BoundedExecutionConfiguration {

    @Bean(name = "workflowExecutionExecutor", destroyMethod = "shutdown")
    ThreadPoolExecutor workflowExecutionExecutor(
            @Value("${weav.workflow.execution.executor-threads:8}") int threads,
            @Value("${weav.workflow.execution.executor-queue-size:128}") int queueSize) {
        if (threads < 1 || threads > 128) {
            throw new IllegalArgumentException("Workflow executor threads must be between one and 128");
        }
        if (queueSize < 1 || queueSize > 10_000) {
            throw new IllegalArgumentException("Workflow executor queue size must be between one and 10000");
        }
        return new ThreadPoolExecutor(threads, threads, 0L, TimeUnit.MILLISECONDS,
                new java.util.concurrent.ArrayBlockingQueue<>(queueSize),
                runnable -> {
                    Thread thread = new Thread(runnable, "workflow-node");
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.CallerRunsPolicy());
    }

    @Bean(name = "workflowExecutionTimer", destroyMethod = "shutdown")
    ScheduledExecutorService workflowExecutionTimer(
            @Value("${weav.workflow.execution.timer-threads:2}") int threads) {
        if (threads < 1 || threads > 16) {
            throw new IllegalArgumentException("Workflow timer threads must be between one and 16");
        }
        return Executors.newScheduledThreadPool(threads, runnable -> {
            Thread thread = new Thread(runnable, "workflow-execution-timer");
            thread.setDaemon(true);
            return thread;
        });
    }
}
