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
        RecordingQueue reconciler = new RecordingQueue();
        UserRepository repository = mock(UserRepository.class);
        TransactionRunner failingTransaction = failingTransaction();
        UpdateAvatarUseCase useCase = updateUseCase(repository, storage, reconciler, failingTransaction);

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(USER_ID, SESSION_ID, png(), "image/png"));

        assertTrue(storage.objects.isEmpty());
        assertEquals(0, reconciler.keys.size());
    }

    @Test
    void replacedObjectIsQueuedForDurableCleanupInsteadOfDeletedInline() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.objects.put("avatars/old.png", png());
        storage.failDeletes.add("avatars/old.png");
        RecordingQueue reconciler = new RecordingQueue();
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(repository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        UpdateAvatarUseCase useCase = updateUseCase(repository, storage, reconciler, directTransaction());

        AuthenticatedUserResult result = useCase.execute(USER_ID, SESSION_ID, png(), "image/png");

        assertEquals(user.getAvatarStorageKey(), result.avatarStorageKey());
        assertFalse(result.avatarStorageKey().equals("avatars/old.png"));
        assertTrue(storage.objects.containsKey(result.avatarStorageKey()));

        assertEquals(java.util.List.of("avatars/old.png"), reconciler.keys);
        assertTrue(storage.objects.containsKey("avatars/old.png"));
    }

    @Test
    void transactionFailureBeforeWorkLeavesReferenceAndObjectUntouched() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.objects.put("avatars/old.png", png());
        RecordingQueue reconciler = new RecordingQueue();
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        TransactionRunner failingTransaction = failingTransaction();
        DeleteAvatarUseCase useCase = deleteUseCase(repository, storage, reconciler, failingTransaction);

        assertThrows(IllegalStateException.class, () -> useCase.execute(USER_ID, SESSION_ID));

        assertEquals("avatars/old.png", user.getAvatarStorageKey());
        assertTrue(storage.objects.containsKey("avatars/old.png"));
        assertEquals(0, reconciler.keys.size());
    }

    @Test
    void storageOutageAfterReferenceCommitIsRetryableAndDoesNotLeakKey() throws Exception {
        InMemoryAvatarStorage storage = new InMemoryAvatarStorage();
        storage.failDeletes.add("avatars/old.png");
        RecordingQueue reconciler = new RecordingQueue();
        User user = user("avatars/old.png");
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(repository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));
        DeleteAvatarUseCase useCase = deleteUseCase(repository, storage, reconciler, directTransaction());

        useCase.execute(USER_ID, SESSION_ID);

        assertTrue(user.getAvatarStorageKey() == null);
        assertEquals(1, reconciler.keys.size());
    }

    @Test
    void cleanupQueueFailureInsideTransactionAbortsSwapAndRemovesNewObject() throws Exception {
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

        assertEquals(java.util.Set.of("avatars/old.png"), storage.objects.keySet());
        assertTrue(storage.objects.containsKey("avatars/old.png"));
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
            AvatarCleanupQueue reconciler,
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

    private static final class RecordingQueue implements AvatarCleanupQueue {
        private final java.util.List<String> keys = new java.util.ArrayList<>();

        @Override
        public void enqueue(UUID userId, String objectKey) {
            keys.add(objectKey);
        }
    }
}
