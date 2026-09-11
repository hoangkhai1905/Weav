package com.weav.identity.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

@ConfigurationProperties(prefix = "weav.avatar.storage")
public class AvatarStorageProperties {

    private String endpoint;
    private String region = "auto";
    private String bucket;
    private String accessKey;
    private String secretKey;
    private boolean pathStyleAccess = true;
    private String keyPrefix = "avatars";
    private Duration signedUrlTtl = Duration.ofMinutes(5);
    private int cleanupQueueCapacity = 1000;

    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public String getRegion() { return region; }
    public void setRegion(String region) { this.region = region; }
    public String getBucket() { return bucket; }
    public void setBucket(String bucket) { this.bucket = bucket; }
    public String getAccessKey() { return accessKey; }
    public void setAccessKey(String accessKey) { this.accessKey = accessKey; }
    public String getSecretKey() { return secretKey; }
    public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
    public boolean isPathStyleAccess() { return pathStyleAccess; }
    public void setPathStyleAccess(boolean pathStyleAccess) { this.pathStyleAccess = pathStyleAccess; }
    public String getKeyPrefix() { return keyPrefix; }
    public void setKeyPrefix(String keyPrefix) { this.keyPrefix = keyPrefix; }
    public Duration getSignedUrlTtl() { return signedUrlTtl; }
    public void setSignedUrlTtl(Duration signedUrlTtl) { this.signedUrlTtl = signedUrlTtl; }
    public int getCleanupQueueCapacity() { return cleanupQueueCapacity; }
    public void setCleanupQueueCapacity(int cleanupQueueCapacity) { this.cleanupQueueCapacity = cleanupQueueCapacity; }

    public boolean isConfigured() {
        return hasText(endpoint) && hasText(region) && hasText(bucket)
                && hasText(accessKey) && hasText(secretKey);
    }

    public void validateConfigured() {
        if (!isConfigured()) {
            throw new IllegalArgumentException("avatar storage is not fully configured");
        }
        URI parsed = URI.create(endpoint);
        if (parsed.getScheme() == null || parsed.getHost() == null
                || parsed.getRawQuery() != null || parsed.getRawFragment() != null) {
            throw new IllegalArgumentException("avatar storage endpoint is invalid");
        }
        if (signedUrlTtl == null || signedUrlTtl.isNegative() || signedUrlTtl.isZero()
                || signedUrlTtl.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException("signedUrlTtl must be between 1 second and 15 minutes");
        }
        if (keyPrefix == null || keyPrefix.isBlank() || keyPrefix.startsWith("/")
                || keyPrefix.endsWith("/") || keyPrefix.contains("..")
                || !keyPrefix.matches("[A-Za-z0-9/_-]{1,80}")) {
            throw new IllegalArgumentException("keyPrefix is invalid");
        }
        if (cleanupQueueCapacity < 1 || cleanupQueueCapacity > 100_000) {
            throw new IllegalArgumentException("cleanupQueueCapacity is invalid");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
