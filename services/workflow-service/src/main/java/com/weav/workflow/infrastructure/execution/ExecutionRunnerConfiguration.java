package com.weav.workflow.infrastructure.execution;

import com.weav.workflow.application.execution.ExecutionRunner;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.RetryWaitPort;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Registers the concrete runner while allowing focused worker tests to provide a handoff double. */
@Configuration(proxyBeanMethods = false)
public class ExecutionRunnerConfiguration {

    @Bean
    @ConditionalOnMissingBean(com.weav.workflow.application.port.in.ExecutionRunner.class)
    ExecutionRunner workflowExecutionRunner(
            ExecutionStatePort state,
            NodeExecutorRegistry registry,
            RetryWaitPort retryWait,
            @Qualifier("workflowExecutionExecutor") ExecutorService executor,
            @Qualifier("workflowExecutionTimer") ScheduledExecutorService timer,
            @Qualifier("workflowExecutionClock") Clock clock,
            @Value("${weav.workflow.execution.max-concurrent-nodes:4}") int maxConcurrentNodes,
            @Value("${weav.workflow.execution.worker.lease-duration:PT60S}") Duration leaseDuration,
            @Value("${weav.workflow.execution.worker.heartbeat-interval:PT15S}") Duration heartbeatInterval) {
        return new ExecutionRunner(state, registry, retryWait, executor, timer, clock, maxConcurrentNodes,
                leaseDuration, heartbeatInterval);
    }
}
