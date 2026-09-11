package com.weav.identity.infrastructure.storage;

import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.infrastructure.config.AvatarStorageProperties;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
class S3AvatarStorageIntegrationTest {

    private static final String ACCESS_KEY = "weavtest";
    private static final String SECRET_KEY = "weavtest-secret";
    private static final String BUCKET = "weav-avatar-test";
    private static final byte[] CONTENT = new byte[]{
            (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3
    };

    @Container
    static final GenericContainer<?> minio = new GenericContainer<>(
            DockerImageName.parse("minio/minio:RELEASE.2024-06-04T19-20-08Z"))
            .withExposedPorts(9000)
            .withEnv("MINIO_ROOT_USER", ACCESS_KEY)
            .withEnv("MINIO_ROOT_PASSWORD", SECRET_KEY)
            .withCommand("server", "/data");

    @Test
    void uploadsFetchesAndDeletesFromDisposableS3Storage() throws Exception {
        AvatarStorageProperties properties = properties();
        try (S3Client adminClient = client(properties)) {
            adminClient.createBucket(builder -> builder.bucket(BUCKET));
        }

        S3AvatarStorage storage = new S3AvatarStorage(
                properties,
                Clock.fixed(Instant.parse("2026-09-11T00:00:00Z"), ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        UUID otherUserId = UUID.randomUUID();
        String objectKey = storage.createObjectKey(userId, "png");
        try {
            storage.put(userId, objectKey, CONTENT, "image/png");

            AvatarStorage.SignedUrl signedUrl = storage.createReadUrl(
                    userId, objectKey, Duration.ofMinutes(5));
            HttpResponse<byte[]> fetched = HttpClient.newHttpClient().send(
                    HttpRequest.newBuilder(signedUrl.url()).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());

            assertEquals(200, fetched.statusCode());
            assertArrayEquals(CONTENT, fetched.body());
            assertEquals(Instant.parse("2026-09-11T00:05:00Z"), signedUrl.expiresAt());
            assertThrows(IllegalArgumentException.class,
                    () -> storage.createReadUrl(otherUserId, objectKey, Duration.ofMinutes(5)));
            assertThrows(IllegalArgumentException.class,
                    () -> storage.delete(userId, "avatars/" + userId + "/arbitrary.png"));

            storage.delete(userId, objectKey);
            assertThrows(ResourceNotFoundException.class,
                    () -> storage.createReadUrl(userId, objectKey, Duration.ofMinutes(5)));
        } finally {
            storage.close();
        }
    }

    @Test
    void mapsStorageOutageToSanitizedDependencyFailure() {
        AvatarStorageProperties properties = properties();
        properties.setEndpoint("http://127.0.0.1:1");
        S3AvatarStorage storage = new S3AvatarStorage(properties);
        try {
            UUID userId = UUID.randomUUID();
            assertThrows(DependencyUnavailableException.class,
                    () -> storage.createReadUrl(userId,
                            "avatars/" + userId + "/00000000-0000-0000-0000-000000000000.png",
                            Duration.ofMinutes(5)));
        } finally {
            storage.close();
        }
    }

    private static AvatarStorageProperties properties() {
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

    private static S3Client client(AvatarStorageProperties properties) {
        return S3Client.builder()
                .endpointOverride(URI.create(properties.getEndpoint()))
                .region(Region.of(properties.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(properties.getAccessKey(), properties.getSecretKey())))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(properties.isPathStyleAccess())
                        .build())
                .build();
    }
}
