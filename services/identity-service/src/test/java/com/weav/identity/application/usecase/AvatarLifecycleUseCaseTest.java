package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AvatarImageValidator;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.config.AvatarStorageProperties;
import com.weav.identity.infrastructure.storage.AvatarCleanupReconciler;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AvatarLifecycleUseCaseTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    void transactionFailureBeforeWorkDoesNotUploadObject() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        AvatarCleanupReconciler reconciler = reconciler(storage);
        UserRepository repository = mock(UserRepository.class);
        TransactionRunner failingTransaction = failingTransaction();
        UpdateAvatarUseCase useCase = updateUseCase(repository, storage, reconciler, failingTransaction);

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(USER_ID, SESSION_ID, png(), "image/png"));

        assertTrue(storage.objects.isEmpty());
        assertEquals(0, reconciler.pendingCount());
    }

    @Test
    void cleanupFailureIsQueuedAndReconciledIdempotentlyAfterCommit() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.objects.put("avatars/old.png", png());
        storage.failDeletes.add("avatars/old.png");
        AvatarCleanupReconciler reconciler = reconciler(storage);
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(repository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        UpdateAvatarUseCase useCase = updateUseCase(repository, storage, reconciler, directTransaction());

        AuthenticatedUserResult result = useCase.execute(USER_ID, SESSION_ID, png(), "image/png");

        assertEquals(user.getAvatarStorageKey(), result.avatarStorageKey());
        assertFalse(result.avatarStorageKey().equals("avatars/old.png"));
        assertTrue(storage.objects.containsKey(result.avatarStorageKey()));
        assertEquals(1, reconciler.pendingCount());

        storage.failDeletes.clear();
        reconciler.reconcileNow();
        reconciler.reconcileNow();
        assertEquals(0, reconciler.pendingCount());
        assertFalse(storage.objects.containsKey("avatars/old.png"));
    }

    @Test
    void transactionFailureBeforeWorkLeavesReferenceAndObjectUntouched() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.objects.put("avatars/old.png", png());
        AvatarCleanupReconciler reconciler = reconciler(storage);
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        TransactionRunner failingTransaction = failingTransaction();
        DeleteAvatarUseCase useCase = deleteUseCase(repository, storage, reconciler, failingTransaction);

        assertThrows(IllegalStateException.class, () -> useCase.execute(USER_ID, SESSION_ID));

        assertEquals("avatars/old.png", user.getAvatarStorageKey());
        assertTrue(storage.objects.containsKey("avatars/old.png"));
        assertEquals(0, reconciler.pendingCount());
    }

    @Test
    void storageOutageAfterReferenceCommitIsRetryableAndDoesNotLeakKey() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.failDeletes.add("avatars/old.png");
        AvatarCleanupReconciler reconciler = reconciler(storage);
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(repository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        DeleteAvatarUseCase useCase = deleteUseCase(repository, storage, reconciler, directTransaction());

        useCase.execute(USER_ID, SESSION_ID);

        assertTrue(user.getAvatarStorageKey() == null);
        assertEquals(1, reconciler.pendingCount());
    }

    @Test
    void cleanupQueueFailureAfterCommitDoesNotDeleteCurrentAvatar() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.objects.put("avatars/old.png", png());
        storage.failDeletes.add("avatars/old.png");
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(repository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        AvatarCleanupQueue failingQueue = (userId, objectKey) -> {
            throw new IllegalStateException("cleanup queue unavailable");
        };
        UpdateAvatarUseCase useCase = updateUseCase(repository, storage, failingQueue, directTransaction());

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(USER_ID, SESSION_ID, png(), "image/png"));

        String currentKey = user.getAvatarStorageKey();
        assertTrue(currentKey != null && !currentKey.equals("avatars/old.png"));
        assertTrue(storage.objects.containsKey(currentKey));
        assertTrue(storage.objects.containsKey("avatars/old.png"));
    }

    @Test
    void queueFullDropsAdditionalCleanupAndEmitsExplicitEvent() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        AvatarCleanupReconciler reconciler = reconciler(storage, 1);
        Logger logger = (Logger) LoggerFactory.getLogger(AvatarCleanupReconciler.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            reconciler.enqueue(USER_ID, "avatars/first.png");
            reconciler.enqueue(USER_ID, "avatars/second.png");

            assertEquals(1, reconciler.pendingCount());
            assertTrue(appender.list.stream()
                    .map(ILoggingEvent::getFormattedMessage)
                    .anyMatch(message -> message.contains("action=ENQUEUE")
                            && message.contains("result=QUEUE_FULL")));
        } finally {
            logger.detachAppender(appender);
        }
    }

    private UpdateAvatarUseCase updateUseCase(
            UserRepository repository,
            AvatarStorage storage,
            AvatarCleanupQueue cleanupQueue,
            TransactionRunner transactionRunner
    ) {
        CurrentIdentityGuard guard = mock(CurrentIdentityGuard.class);
        doNothing().when(guard).requireActiveSessionForLockedUser(any(User.class), any(), any());
        when(guard.requireActiveUser(USER_ID, SESSION_ID)).thenReturn(user(null));
        return new UpdateAvatarUseCase(
                guard,
                repository,
                storage,
                cleanupQueue,
                new AvatarImageValidator(),
                transactionRunner,
                CLOCK);
    }

    private DeleteAvatarUseCase deleteUseCase(
            UserRepository repository,
            AvatarStorage storage,
            AvatarCleanupReconciler reconciler,
            TransactionRunner transactionRunner
    ) {
        CurrentIdentityGuard guard = mock(CurrentIdentityGuard.class);
        doNothing().when(guard).requireActiveSessionForLockedUser(any(User.class), any(), any());
        when(guard.requireActiveUser(USER_ID, SESSION_ID)).thenReturn(user(null));
        return new DeleteAvatarUseCase(
                guard,
                repository,
                storage,
                reconciler,
                transactionRunner,
                CLOCK);
    }

    private static AvatarCleanupReconciler reconciler(AvatarStorage storage) {
        return reconciler(storage, 10);
    }

    private static AvatarCleanupReconciler reconciler(AvatarStorage storage, int capacity) {
        AvatarStorageProperties properties = new AvatarStorageProperties();
        properties.setCleanupQueueCapacity(capacity);
        return new AvatarCleanupReconciler(storage, properties, CLOCK);
    }

    private static TransactionRunner directTransaction() {
        return new TransactionRunner() {
            @Override
            public <T> T required(Supplier<T> work) {
                return work.get();
            }
        };
    }

    private static TransactionRunner failingTransaction() {
        return new TransactionRunner() {
            @Override
            public <T> T required(Supplier<T> work) {
                throw new IllegalStateException("database unavailable");
            }
        };
    }

    private static User user(String avatarStorageKey) {
        return new User(
                USER_ID,
                "avatar-test@example.com",
                "password-hash",
                "Avatar Test",
                avatarStorageKey,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW.minusSeconds(60),
                NOW.minusSeconds(30));
    }

    private static byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(image, "png", bytes);
        return bytes.toByteArray();
    }

    private static final class InMemoryAvatarStorage implements AvatarStorage {
        private final Map<String, byte[]> objects = new ConcurrentHashMap<>();
        private final Set<String> failDeletes = ConcurrentHashMap.newKeySet();

        @Override
        public String createObjectKey(UUID userId, String extension) {
            return "avatars/" + userId + "/" + UUID.randomUUID() + "." + extension;
        }

        @Override
        public void put(UUID userId, String objectKey, byte[] content, String contentType) {
            objects.put(objectKey, content.clone());
        }

        @Override
        public SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime) {
            return new SignedUrl(URI.create("https://storage.invalid/" + objectKey), NOW.plus(lifetime));
        }

        @Override
        public void delete(UUID userId, String objectKey) {
            if (failDeletes.contains(objectKey)) {
                throw new IllegalStateException("storage unavailable");
            }
            objects.remove(objectKey);
        }
    }
}
