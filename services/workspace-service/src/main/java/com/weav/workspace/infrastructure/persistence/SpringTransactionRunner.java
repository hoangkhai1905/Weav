package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.application.port.out.TransactionRunner;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Objects;
import java.util.function.Supplier;

public final class SpringTransactionRunner implements TransactionRunner {

    private final TransactionTemplate requiredTransactionTemplate;
    private final TransactionTemplate requiresNewTransactionTemplate;

    public SpringTransactionRunner(
            TransactionTemplate requiredTransactionTemplate,
            TransactionTemplate requiresNewTransactionTemplate) {
        this.requiredTransactionTemplate = Objects.requireNonNull(
                requiredTransactionTemplate,
                "requiredTransactionTemplate must not be null");
        this.requiresNewTransactionTemplate = Objects.requireNonNull(
                requiresNewTransactionTemplate,
                "requiresNewTransactionTemplate must not be null");
    }

    @Override
    public <T> T required(Supplier<T> work) {
        Objects.requireNonNull(work, "work must not be null");
        try {
            return TransactionRunner.requireResult(requiredTransactionTemplate.execute(status -> work.get()));
        } catch (RuntimeException exception) {
            throw WorkspacePersistenceExceptionTranslator.translate(exception);
        }
    }

    @Override
    public <T> T requiresNew(Supplier<T> work) {
        Objects.requireNonNull(work, "work must not be null");
        try {
            return TransactionRunner.requireResult(requiresNewTransactionTemplate.execute(status -> work.get()));
        } catch (RuntimeException exception) {
            throw WorkspacePersistenceExceptionTranslator.translate(exception);
        }
    }
}
