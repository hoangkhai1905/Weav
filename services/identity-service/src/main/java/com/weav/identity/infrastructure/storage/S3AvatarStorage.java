package com.weav.identity.infrastructure.storage;

import com.weav.identity.application.port.out.AvatarStorage;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.infrastructure.config.AvatarStorageProperties;
import jakarta.annotation.PreDestroy;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

public final class S3AvatarStorage implements AvatarStorage {

    private static final String[] ALLOWED_EXTENSIONS = {"jpg", "png", "webp"};

    private final AvatarStorageProperties properties;
    private final S3Client client;
    private final S3Presigner presigner;
    private final Clock clock;

    public S3AvatarStorage(AvatarStorageProperties properties) {
        this(properties, Clock.systemUTC());
    }

    public S3AvatarStorage(AvatarStorageProperties properties, Clock clock) {
        this.properties = Objects.requireNonNull(properties);
        this.clock = Objects.requireNonNull(clock);
        properties.validateConfigured();
        StaticCredentialsProvider credentials = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(properties.getAccessKey(), properties.getSecretKey()));
        S3Configuration s3Configuration = S3Configuration.builder()
                .pathStyleAccessEnabled(properties.isPathStyleAccess())
                .build();
        URI endpoint = URI.create(properties.getEndpoint());
        this.client = S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.of(properties.getRegion()))
                .credentialsProvider(credentials)
                .serviceConfiguration(s3Configuration)
                .build();
        this.presigner = S3Presigner.builder()
                .endpointOverride(endpoint)
                .region(Region.of(properties.getRegion()))
                .credentialsProvider(credentials)
                .serviceConfiguration(s3Configuration)
                .build();
    }

    @Override
    public String createObjectKey(UUID userId, String extension) {
        Objects.requireNonNull(userId, "userId must not be null");
        String normalizedExtension = normalizeExtension(extension);
        return prefixFor(userId) + UUID.randomUUID() + "." + normalizedExtension;
    }

    @Override
    public void put(UUID userId, String objectKey, byte[] content, String contentType) {
        validateOwnedKey(userId, objectKey);
        try {
            client.putObject(
                    PutObjectRequest.builder()
                            .bucket(properties.getBucket())
                            .key(objectKey)
                            .contentType(contentType)
                            .contentLength((long) content.length)
                            .cacheControl("private, max-age=300")
                            .build(),
                    RequestBody.fromBytes(content));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public SignedUrl createReadUrl(UUID userId, String objectKey, Duration lifetime) {
        validateOwnedKey(userId, objectKey);
        if (lifetime == null || lifetime.isZero() || lifetime.isNegative()
                || lifetime.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException("avatar URL lifetime is invalid");
        }
        try {
            client.headObject(HeadObjectRequest.builder()
                    .bucket(properties.getBucket())
                    .key(objectKey)
                    .build());
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404) {
                throw new ResourceNotFoundException("Avatar not found");
            }
            throw new DependencyUnavailableException();
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
        try {
            GetObjectRequest getObject = GetObjectRequest.builder()
                    .bucket(properties.getBucket())
                    .key(objectKey)
                    .build();
            GetObjectPresignRequest presign = GetObjectPresignRequest.builder()
                    .signatureDuration(lifetime)
                    .getObjectRequest(getObject)
                    .build();
            return new SignedUrl(
                    URI.create(presigner.presignGetObject(presign).url().toString()),
                    clock.instant().plus(lifetime));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public void delete(UUID userId, String objectKey) {
        validateOwnedKey(userId, objectKey);
        try {
            client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(properties.getBucket())
                    .key(objectKey)
                    .build());
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private void validateOwnedKey(UUID userId, String objectKey) {
        Objects.requireNonNull(userId, "userId must not be null");
        String prefix = prefixFor(userId);
        String suffix = objectKey == null || !objectKey.startsWith(prefix)
                ? null
                : objectKey.substring(prefix.length());
        if (suffix == null
                || !suffix.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp)")) {
            throw new IllegalArgumentException("avatar object key is outside the user namespace");
        }
    }

    private String prefixFor(UUID userId) {
        return properties.getKeyPrefix() + "/" + userId + "/";
    }

    private static String normalizeExtension(String extension) {
        String value = Objects.requireNonNull(extension, "extension must not be null").toLowerCase(Locale.ROOT);
        for (String allowed : ALLOWED_EXTENSIONS) {
            if (allowed.equals(value)) {
                return value;
            }
        }
        throw new IllegalArgumentException("avatar extension is not supported");
    }

    @PreDestroy
    public void close() {
        client.close();
        presigner.close();
    }
}
