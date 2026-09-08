package com.weav.identity.infrastructure.mail;

import com.weav.identity.application.port.out.AuthMailDispatcher;
import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.infrastructure.config.MailProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Bounded, asynchronous SMTP admission. A no-op job consumes exactly the
 * same reservation as a real message, preventing account-existence timing
 * differences and ensuring SMTP never runs on an HTTP thread.
 */
@Component
public final class BoundedAuthMailDispatcher implements AuthMailDispatcher {

    private static final Logger log = LoggerFactory.getLogger(BoundedAuthMailDispatcher.class);

    private final AuthMailSender sender;
    private final ThreadPoolExecutor executor;
    private final Semaphore capacity;
    private final AtomicBoolean closed = new AtomicBoolean();

    public BoundedAuthMailDispatcher(AuthMailSender sender, MailProperties properties) {
        this.sender = Objects.requireNonNull(sender, "sender must not be null");
        Objects.requireNonNull(properties, "properties must not be null").validate();
        int total = properties.getQueueCapacity() + properties.getMaxPoolSize();
        this.capacity = new Semaphore(total, true);
        this.executor = new ThreadPoolExecutor(
                properties.getCorePoolSize(),
                properties.getMaxPoolSize(),
                30L,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(properties.getQueueCapacity()),
                new ThreadPoolExecutor.AbortPolicy());
        this.executor.allowCoreThreadTimeOut(false);
    }

    @Override
    public Lease reserve() {
        if (closed.get() || !capacity.tryAcquire()) {
            throw new DependencyUnavailableException();
        }
        return new Reservation();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        List<Runnable> cancelled = executor.shutdownNow();
        for (Runnable runnable : cancelled) {
            if (runnable instanceof MailJob job) job.cancel();
        }
    }

    public final class Reservation implements AuthMailDispatcher.Lease {
        private final AtomicBoolean submitted = new AtomicBoolean();

        private Reservation() {
        }

        @Override
        public void dispatch(AuthMailSender.Message message, Runnable onFailure) {
            if (!submitted.compareAndSet(false, true)) {
                throw new IllegalStateException("mail reservation already used");
            }
            if (closed.get()) {
                capacity.release();
                throw new DependencyUnavailableException();
            }

            MailJob job = new MailJob(message, onFailure);
            try {
                executor.execute(job);
            } catch (RejectedExecutionException exception) {
                capacity.release();
                throw new DependencyUnavailableException();
            }
        }

        @Override
        public void close() {
            if (submitted.compareAndSet(false, true)) capacity.release();
        }
    }

    private final class MailJob implements Runnable {
        private final AuthMailSender.Message message;
        private final Runnable onFailure;
        private final AtomicBoolean finished = new AtomicBoolean();

        private MailJob(AuthMailSender.Message message, Runnable onFailure) {
            this.message = message;
            this.onFailure = onFailure;
        }

        @Override
        public void run() {
            try {
                if (message != null) sender.send(message);
            } catch (DependencyUnavailableException exception) {
                runFailureCallback();
                log.warn("Authentication mail delivery failed due to an unavailable dependency");
            } catch (RuntimeException exception) {
                runFailureCallback();
                log.warn("Authentication mail delivery failed");
            } finally {
                release();
            }
        }

        private void cancel() {
            try {
                runFailureCallback();
            } finally {
                release();
            }
        }

        private void runFailureCallback() {
            if (onFailure == null) return;
            try {
                onFailure.run();
            } catch (RuntimeException callbackFailure) {
                log.warn("Authentication mail failure cleanup failed");
            }
        }

        private void release() {
            if (finished.compareAndSet(false, true)) capacity.release();
        }
    }
}
