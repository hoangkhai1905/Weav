package com.weav.identity.infrastructure.persistence;

import com.weav.identity.application.port.out.TransactionRunner;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Objects;
import java.util.function.Supplier;

public final class SpringTransactionRunner implements TransactionRunner {

    private final TransactionTemplate transactionTemplate;

    public SpringTransactionRunner(TransactionTemplate transactionTemplate) {
        this.transactionTemplate = Objects.requireNonNull(
                transactionTemplate,
                "transactionTemplate must not be null"
        );
    }

    @Override
    public <T> T required(Supplier<T> work) {
        Objects.requireNonNull(work, "work must not be null");
        return transactionTemplate.execute(status -> work.get());
    }
}
