package com.weav.workflow.infrastructure.execution;

import com.weav.workflow.application.port.out.ExecutionFinishedListener;
import com.weav.workflow.application.service.AlertEvaluator;
import com.weav.workflow.application.service.WorkflowEventTriggerService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * The persistence adapter takes one {@link ExecutionFinishedListener}; this fans a finished run out to the alert
 * evaluator and the workflow-event trigger. Each listener already swallows its own failures; the second still runs
 * if the first throws anyway.
 */
@Configuration
public class FinishedListenerConfiguration {

    @Bean
    @Primary
    ExecutionFinishedListener executionFinishedListeners(AlertEvaluator alerts, WorkflowEventTriggerService events) {
        return executionId -> {
            try {
                alerts.onExecutionFinished(executionId);
            } finally {
                events.onExecutionFinished(executionId);
            }
        };
    }
}
