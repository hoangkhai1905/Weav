package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.infrastructure.storage.AvatarCleanupReconciler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
@TestPropertySource(properties = {
        "weav.oauth.enabled=false",
        "weav.identity.notification-outbox.publisher-enabled=false"
})
class AvatarCleanupReconcilerIntegrationTest {

    private static final UUID USER_ID = UUID.randomUUID();

    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private TransactionRunner transactionRunner;

    private FakeStorage storage;
    private AvatarCleanupReconciler reconciler;

    @BeforeEach
    void reset() {
        jdbc.update("delete from identity.avatar_cleanup");
        storage = new FakeStorage();
        reconciler = new AvatarCleanupReconciler(storage, jdbc, transactionManager, "identity");
    }

    @Test
    void enqueueRollsBackWithTheCallerTransactionAndCommitsWithIt() {
        assertThrows(IllegalStateException.class, () -> transactionRunner.required(() -> {
            reconciler.enqueue(USER_ID, "avatars/rolled-back.png");
            throw new IllegalStateException("swap failed");
        }));
        assertEquals(0, rows());

        transactionRunner.required(() -> {
            reconciler.enqueue(USER_ID, "avatars/old.png");
            reconciler.enqueue(USER_ID, "avatars/old.png");
            return null;
        });
        assertEquals(1, rows());
    }

    @Test
    void reconcileDeletesTheObjectAndTheRow() {
        reconciler.enqueue(USER_ID, "avatars/old.png");

        reconciler.reconcileNow();

        assertEquals(List.of("avatars/old.png"), storage.deleted);
        assertEquals(0, rows());
    }

    @Test
    void failedDeleteKeepsTheRowAndCountsTheAttempt() {
        reconciler.enqueue(USER_ID, "avatars/old.png");
        storage.fail = true;

        reconciler.reconcileNow();

        assertEquals(1, rows());
        assertEquals(1, jdbc.queryForObject("select attempts from identity.avatar_cleanup", Integer.class));
        assertEquals("IllegalStateException",
                jdbc.queryForObject("select last_error from identity.avatar_cleanup", String.class));

        // backed off: an immediate second pass does not touch it again
        reconciler.reconcileNow();
        assertEquals(1, jdbc.queryForObject("select attempts from identity.avatar_cleanup", Integer.class));
    }

    @Test
    void rowsThatExhaustedTheirAttemptsAreSkipped() {
        reconciler.enqueue(USER_ID, "avatars/old.png");
        jdbc.update("update identity.avatar_cleanup set attempts = 10");

        reconciler.reconcileNow();

        assertEquals(List.of(), storage.deleted);
        assertEquals(1, rows());
    }

    private int rows() {
        return jdbc.queryForObject("select count(*) from identity.avatar_cleanup", Integer.class);
    }

    private static final class FakeStorage implements AvatarStorage {
        private final List<String> deleted = new ArrayList<>();
        private boolean fail;

        @Override
        public String createObjectKey(UUID userId, String extension) {
            return "avatars/" + extension;
        }

        @Override
        public void put(UUID userId, String objectKey, byte[] content, String contentType) {
        }

        @Override
        public SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime) {
            return new SignedUrl(URI.create("https://storage.invalid/" + objectKey), Instant.now().plus(lifetime));
        }

        @Override
        public void delete(UUID userId, String objectKey) {
            if (fail) {
                throw new IllegalStateException("storage unavailable");
            }
            deleted.add(objectKey);
        }
    }
}
