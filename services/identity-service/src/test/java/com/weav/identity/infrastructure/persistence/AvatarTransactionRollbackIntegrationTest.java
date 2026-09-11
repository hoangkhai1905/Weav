package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.application.port.out.AvatarCleanupQueue;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.usecase.DeleteAvatarUseCase;
import com.weav.identity.application.usecase.UpdateAvatarUseCase;
import com.weav.identity.application.validation.AvatarImageValidator;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.config.AvatarStorageProperties;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserRepository;
import com.weav.identity.infrastructure.persistence.repository.SpringDataUserSessionRepository;
import com.weav.identity.infrastructure.persistence.repository.UserRepositoryAdapter;
import com.weav.identity.infrastructure.persistence.repository.UserSessionRepositoryAdapter;
import com.weav.identity.infrastructure.storage.S3AvatarStorage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({
        TestcontainersConfiguration.class,
        UserRepositoryAdapter.class,
        UserSessionRepositoryAdapter.class
})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class AvatarTransactionRollbackIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-11T00:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final String ACCESS_KEY = "weavtest";
    private static final String SECRET_KEY = "weavtest-secret";
    private static final String BUCKET = "weav-avatar-rollback-test";

    @Container
    static final GenericContainer<?> minio = new GenericContainer<>(
            DockerImageName.parse("minio/minio:RELEASE.2024-06-04T19-20-08Z"))
            .withExposedPorts(9000)
            .withEnv("MINIO_ROOT_USER", ACCESS_KEY)
            .withEnv("MINIO_ROOT_PASSWORD", SECRET_KEY)
            .withCommand("server", "/data");

    @Autowired
    private UserRepositoryAdapter userRepository;

    @Autowired
    private UserSessionRepositoryAdapter sessionRepository;

    @Autowired
    private SpringDataUserRepository springDataUserRepository;

    @Autowired
    private SpringDataUserSessionRepository springDataSessionRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private S3AvatarStorage storage;
    private RecordingAvatarStorage recordingStorage;
    private SaveProbeUserRepository saveProbe;
    private FailAfterSaveTransactionRunner transactionRunner;
    private UUID userId;
    private UUID sessionId;
    private String oldObjectKey;

    @BeforeAll
    static void createBucket() {
        try (S3Client client = adminClient()) {
            client.createBucket(builder -> builder.bucket(BUCKET));
        }
    }

    @BeforeEach
    void cleanDatabaseAndCreateFixture() throws Exception {
        springDataSessionRepository.deleteAll();
        springDataUserRepository.deleteAll();

        storage = new S3AvatarStorage(storageProperties(), CLOCK);
        recordingStorage = new RecordingAvatarStorage(storage);
        userId = UUID.randomUUID();
        sessionId = UUID.randomUUID();
        oldObjectKey = storage.createObjectKey(userId, "png");
        recordingStorage.put(userId, oldObjectKey, png(), "image/png");

        userRepository.save(new User(
                userId,
                "avatar-rollback-" + userId + "@example.com",
                "password-hash",
                "Avatar rollback",
                oldObjectKey,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW.minusSeconds(120),
                NOW.minusSeconds(60)));
        sessionRepository.save(new UserSession(
                sessionId,
                userId,
                "avatar-rollback-refresh-" + userId,
                "JUnit",
                "127.0.0.1",
                NOW.plus(Duration.ofDays(1)),
                NOW.minusSeconds(30)));

        saveProbe = new SaveProbeUserRepository(userRepository);
        transactionRunner = new FailAfterSaveTransactionRunner(transactionManager, saveProbe);
    }

    @AfterEach
    void closeStorage() {
        if (storage != null) {
            storage.close();
        }
    }

    @Test
    void replacementRollbackPreservesOldReferenceAndObjectAndRemovesNewObject() throws Exception {
        UpdateAvatarUseCase useCase = updateUseCase();
        transactionRunner.failAfterSave();

        assertThrows(IllegalStateException.class,
                () -> useCase.execute(userId, sessionId, png(), "image/png"));

        User persisted = userRepository.findById(userId).orElseThrow();
        assertEquals(oldObjectKey, persisted.getAvatarStorageKey());
        assertTrue(recordingStorage.putKeys.size() == 2);
        String newObjectKey = recordingStorage.putKeys.getLast();
        assertTrue(recordingStorage.deleteKeys.contains(newObjectKey));
        assertThrows(ResourceNotFoundException.class,
                () -> storage.createReadUrl(userId, newObjectKey, Duration.ofMinutes(5)));
        assertEquals(200, fetch(storage.createReadUrl(userId, oldObjectKey, Duration.ofMinutes(5))).statusCode());
    }

    @Test
    void deleteRollbackPreservesReferenceAndObject() throws Exception {
        CurrentIdentityGuard identityGuard = new CurrentIdentityGuard(saveProbe, sessionRepository, CLOCK);
        DeleteAvatarUseCase useCase = new DeleteAvatarUseCase(
                identityGuard,
                saveProbe,
                recordingStorage,
                (user, objectKey) -> { },
                transactionRunner,
                CLOCK);
        transactionRunner.failAfterSave();

        assertThrows(IllegalStateException.class, () -> useCase.execute(userId, sessionId));

        User persisted = userRepository.findById(userId).orElseThrow();
        assertEquals(oldObjectKey, persisted.getAvatarStorageKey());
        assertTrue(recordingStorage.deleteKeys.isEmpty());
        assertEquals(200, fetch(storage.createReadUrl(userId, oldObjectKey, Duration.ofMinutes(5))).statusCode());
    }

    private UpdateAvatarUseCase updateUseCase() {
        CurrentIdentityGuard identityGuard = new CurrentIdentityGuard(saveProbe, sessionRepository, CLOCK);
        AvatarCleanupQueue cleanupQueue = (user, objectKey) -> { };
        return new UpdateAvatarUseCase(
                identityGuard,
                saveProbe,
                recordingStorage,
                cleanupQueue,
                new AvatarImageValidator(),
                transactionRunner,
                CLOCK);
    }

    private static HttpResponse<byte[]> fetch(AvatarStorage.SignedUrl signedUrl) throws Exception {
        return HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(signedUrl.url()).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    private static AvatarStorageProperties storageProperties() {
        AvatarStorageProperties properties = new AvatarStorageProperties();
        properties.setEndpoint("http://" + minio.getHost() + ":" + minio.getMappedPort(9000));
        properties.setRegion("us-east-1");
        properties.setBucket(BUCKET);
        properties.setAccessKey(ACCESS_KEY);
        properties.setSecretKey(SECRET_KEY);
        properties.setPathStyleAccess(true);
        properties.setKeyPrefix("avatars");
        properties.setSignedUrlTtl(Duration.ofMinutes(5));
        return properties;
    }

    private static S3Client adminClient() {
        return S3Client.builder()
                .endpointOverride(URI.create("http://" + minio.getHost() + ":" + minio.getMappedPort(9000)))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build();
    }

    private static byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(image, "png", output));
        return output.toByteArray();
    }

    private static final class RecordingAvatarStorage implements AvatarStorage {

        private final AvatarStorage delegate;
        private final List<String> putKeys = new ArrayList<>();
        private final List<String> deleteKeys = new ArrayList<>();

        private RecordingAvatarStorage(AvatarStorage delegate) {
            this.delegate = delegate;
        }

        @Override
        public String createObjectKey(UUID userId, String extension) {
            return delegate.createObjectKey(userId, extension);
        }

        @Override
        public void put(UUID userId, String objectKey, byte[] content, String contentType) {
            delegate.put(userId, objectKey, content, contentType);
            putKeys.add(objectKey);
        }

        @Override
        public SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime) {
            return delegate.createReadUrl(userId, objectKey, lifetime);
        }

        @Override
        public void delete(UUID userId, String objectKey) {
            deleteKeys.add(objectKey);
            delegate.delete(userId, objectKey);
        }
    }

    private static final class SaveProbeUserRepository implements UserRepository {

        private final UserRepository delegate;
        private final AtomicBoolean saved = new AtomicBoolean();

        private SaveProbeUserRepository(UserRepository delegate) {
            this.delegate = delegate;
        }

        boolean wasSaved() {
            return saved.get();
        }

        void reset() {
            saved.set(false);
        }

        @Override
        public User save(User user) {
            User result = delegate.save(user);
            saved.set(true);
            return result;
        }

        @Override
        public Optional<User> findById(UUID id) {
            return delegate.findById(id);
        }

        @Override
        public Optional<User> findByIdForUpdate(UUID id) {
            return delegate.findByIdForUpdate(id);
        }

        @Override
        public Optional<User> findByEmail(String email) {
            return delegate.findByEmail(email);
        }

        @Override
        public boolean existsByEmail(String email) {
            return delegate.existsByEmail(email);
        }

        @Override
        public com.weav.identity.domain.model.UserPage findPage(
                String search,
                com.weav.identity.domain.valueobject.UserStatus status,
                int page,
                int size) {
            return delegate.findPage(search, status, page, size);
        }
    }

    private static final class FailAfterSaveTransactionRunner implements TransactionRunner {

        private final TransactionTemplate transactionTemplate;
        private final SaveProbeUserRepository saveProbe;
        private final AtomicBoolean armed = new AtomicBoolean();

        private FailAfterSaveTransactionRunner(
                PlatformTransactionManager transactionManager,
                SaveProbeUserRepository saveProbe) {
            this.transactionTemplate = new TransactionTemplate(transactionManager);
            this.saveProbe = saveProbe;
        }

        void failAfterSave() {
            saveProbe.reset();
            armed.set(true);
        }

        @Override
        public <T> T required(Supplier<T> work) {
            return transactionTemplate.execute(status -> {
                T result = work.get();
                if (armed.compareAndSet(true, false) && saveProbe.wasSaved()) {
                    status.setRollbackOnly();
                    throw new IllegalStateException("injected transaction failure after save");
                }
                return result;
            });
        }
    }
}
