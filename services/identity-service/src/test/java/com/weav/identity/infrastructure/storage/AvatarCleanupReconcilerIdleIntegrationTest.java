package com.weav.identity.infrastructure.storage;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.TransactionRunner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/** Neon scale-to-zero: the cleanup poller backs off while idle, sleeps until the next due row and wakes on enqueue. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@TestPropertySource(properties = {
        "weav.oauth.enabled=false",
        "weav.identity.notification-outbox.publisher-enabled=false"
})
class AvatarCleanupReconcilerIdleIntegrationTest {

    private static final UUID USER_ID = UUID.randomUUID();

    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private TransactionRunner transactionRunner;

    private AvatarStorage storage;
    private AvatarCleanupReconciler reconciler;

    @BeforeEach
    void reset() {
        jdbc.update("delete from identity.avatar_cleanup");
        storage = mock(AvatarStorage.class);
        reconciler = new AvatarCleanupReconciler(storage, jdbc, transactionManager, "identity",
                100, Duration.ofMinutes(10));
    }

    @Test
    void earliestPendingDueIgnoresRowsThatGaveUpAndFindsTheSoonestOne() {
        assertThat(reconciler.earliestPendingDue()).isNull();
        insert("avatars/gave-up.png", "now() - interval '1 hour'", AvatarCleanupReconciler.MAX_ATTEMPTS);
        assertThat(reconciler.earliestPendingDue()).isNull();
        insert("avatars/later.png", "now() + interval '300 seconds'", 0);
        insert("avatars/soon.png", "now() + interval '90 seconds'", 0);

        assertThat(reconciler.earliestPendingDue())
                .isBetween(Instant.now().plusSeconds(80), Instant.now().plusSeconds(95));
    }

    @Test
    void idlePollerStaysAsleepUntilEnqueueCommitsThenCleansUpAtOnce() {
        reconciler.reconcileOnSchedule();
        insert("avatars/unwoken.png", "now()", 0);

        reconciler.reconcileOnSchedule();
        verify(storage, never()).delete(USER_ID, "avatars/unwoken.png");

        transactionRunner.required(() -> {
            reconciler.enqueue(USER_ID, "avatars/woken.png");
            return null;
        });
        reconciler.reconcileOnSchedule();

        verify(storage).delete(USER_ID, "avatars/unwoken.png");
        verify(storage).delete(USER_ID, "avatars/woken.png");
        assertThat(jdbc.queryForObject("select count(*) from identity.avatar_cleanup", Integer.class)).isZero();
    }

    @Test
    void anEnqueueThatRollsBackDoesNotWakeThePoller() {
        reconciler.reconcileOnSchedule();
        insert("avatars/unwoken.png", "now()", 0);

        try {
            transactionRunner.required(() -> {
                reconciler.enqueue(USER_ID, "avatars/rolled-back.png");
                throw new IllegalStateException("swap failed");
            });
        } catch (IllegalStateException expected) {
            // rolled back
        }
        reconciler.reconcileOnSchedule();

        verify(storage, never()).delete(USER_ID, "avatars/unwoken.png");
    }

    @Test
    void pollerSleepsUntilTheNextPendingRowIsDueInsteadOfPollingEveryInterval() throws Exception {
        insert("avatars/soon.png", "now() + interval '1500 milliseconds'", 0);

        reconciler.reconcileOnSchedule();
        Thread.sleep(300);
        reconciler.reconcileOnSchedule();
        verify(storage, never()).delete(USER_ID, "avatars/soon.png");

        Thread.sleep(1500);
        reconciler.reconcileOnSchedule();

        verify(storage, times(1)).delete(USER_ID, "avatars/soon.png");
    }

    private void insert(String key, String nextAttemptSql, int attempts) {
        jdbc.update("insert into identity.avatar_cleanup (object_key, user_id, next_attempt_at, attempts) values (?, ?, "
                + nextAttemptSql + ", ?)", key, USER_ID, attempts);
    }
}
