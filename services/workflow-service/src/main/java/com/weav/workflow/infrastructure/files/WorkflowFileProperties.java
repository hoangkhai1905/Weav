package com.weav.workflow.infrastructure.files;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.regex.Pattern;

/** Settings of the workflow file store; limits are enforced by the store and by its consumers. */
@ConfigurationProperties(prefix = "weav.workflow.files")
public class WorkflowFileProperties {

    private static final Pattern KEY_PREFIX = Pattern.compile("[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*");

    private String endpoint;
    private String region = "auto";
    private String bucket;
    private String accessKey;
    private String secretKey;
    private boolean pathStyleAccess = true;
    private String keyPrefix = "workflow-files";
    private Duration retention = Duration.ofDays(7);
    private long maxFileBytes = 10L * 1024 * 1024;
    private int maxAttachments = 5;
    private long maxEmailBytes = 20L * 1024 * 1024;

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
    public Duration getRetention() { return retention; }
    public void setRetention(Duration retention) { this.retention = retention; }
    public long getMaxFileBytes() { return maxFileBytes; }
    public void setMaxFileBytes(long maxFileBytes) { this.maxFileBytes = maxFileBytes; }
    public int getMaxAttachments() { return maxAttachments; }
    public void setMaxAttachments(int maxAttachments) { this.maxAttachments = maxAttachments; }
    public long getMaxEmailBytes() { return maxEmailBytes; }
    public void setMaxEmailBytes(long maxEmailBytes) { this.maxEmailBytes = maxEmailBytes; }

    /** Configured only when endpoint, bucket and both keys are set. */
    public boolean isConfigured() {
        return hasText(endpoint) && hasText(bucket) && hasText(accessKey) && hasText(secretKey);
    }

    /** Rejects unusable values at startup (called only when the store is configured). */
    public void validate() {
        if (retention == null || retention.isZero() || retention.isNegative()) {
            throw new IllegalArgumentException("workflow file retention must be positive");
        }
        if (maxFileBytes < 1 || maxEmailBytes < 1 || maxAttachments < 1) {
            throw new IllegalArgumentException("workflow file limits must be positive");
        }
        if (!hasText(region) || keyPrefix == null || !KEY_PREFIX.matcher(keyPrefix).matches()) {
            throw new IllegalArgumentException("workflow file region or key prefix is invalid");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
