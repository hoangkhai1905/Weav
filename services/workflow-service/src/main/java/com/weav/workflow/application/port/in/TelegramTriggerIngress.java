package com.weav.workflow.application.port.in;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.service.TriggerDependencyUnavailableException;

import java.util.UUID;

/** Application boundary for already-normalized Telegram events; it defines no transport contract. */
@FunctionalInterface
public interface TelegramTriggerIngress {
    ExecutionAdmissionPort.Admission accept(UUID triggerId, Object normalizedInput);

    static TelegramTriggerIngress unconfigured() {
        return (triggerId, normalizedInput) -> {
            throw new TriggerDependencyUnavailableException();
        };
    }
}
