package com.weav.identity.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.nio.charset.StandardCharsets;

@ConfigurationProperties(prefix = "weav.otp")
public class OtpProperties {

    private String hmacSecret;
    private Duration challengeTtl = Duration.ofMinutes(5);
    private Duration grantTtl = Duration.ofMinutes(5);
    private Duration resendCooldown = Duration.ofSeconds(60);
    private int maxChallengesPerAccount = 5;
    private int maxChallengesPerIp = 20;
    private int maxVerifyAttempts = 5;
    private int maxVerifyPerIp = 30;
    private String keyPrefix = "weav:identity:otp";

    public String getHmacSecret() {
        return hmacSecret;
    }

    public void setHmacSecret(String hmacSecret) {
        this.hmacSecret = hmacSecret;
    }

    public Duration getChallengeTtl() {
        return challengeTtl;
    }

    public void setChallengeTtl(Duration challengeTtl) {
        this.challengeTtl = challengeTtl;
    }

    public Duration getGrantTtl() {
        return grantTtl;
    }

    public void setGrantTtl(Duration grantTtl) {
        this.grantTtl = grantTtl;
    }

    public Duration getResendCooldown() {
        return resendCooldown;
    }

    public void setResendCooldown(Duration resendCooldown) {
        this.resendCooldown = resendCooldown;
    }

    public int getMaxChallengesPerAccount() {
        return maxChallengesPerAccount;
    }

    public void setMaxChallengesPerAccount(int maxChallengesPerAccount) {
        this.maxChallengesPerAccount = maxChallengesPerAccount;
    }

    public int getMaxChallengesPerIp() {
        return maxChallengesPerIp;
    }

    public void setMaxChallengesPerIp(int maxChallengesPerIp) {
        this.maxChallengesPerIp = maxChallengesPerIp;
    }

    public int getMaxVerifyAttempts() {
        return maxVerifyAttempts;
    }

    public void setMaxVerifyAttempts(int maxVerifyAttempts) {
        this.maxVerifyAttempts = maxVerifyAttempts;
    }

    public int getMaxVerifyPerIp() {
        return maxVerifyPerIp;
    }

    public void setMaxVerifyPerIp(int maxVerifyPerIp) {
        this.maxVerifyPerIp = maxVerifyPerIp;
    }

    public String getKeyPrefix() {
        return keyPrefix;
    }

    public void setKeyPrefix(String keyPrefix) {
        this.keyPrefix = keyPrefix;
    }

    public boolean isConfigured() {
        return hmacSecret != null && !hmacSecret.isBlank()
                && hmacSecret.getBytes(StandardCharsets.UTF_8).length >= 32;
    }

    public void validate() {
        requirePositive(challengeTtl, "challengeTtl");
        requirePositive(grantTtl, "grantTtl");
        requirePositive(resendCooldown, "resendCooldown");
        requirePositive(maxChallengesPerAccount, "maxChallengesPerAccount");
        requirePositive(maxChallengesPerIp, "maxChallengesPerIp");
        requirePositive(maxVerifyAttempts, "maxVerifyAttempts");
        requirePositive(maxVerifyPerIp, "maxVerifyPerIp");
        if (keyPrefix == null || keyPrefix.isBlank() || keyPrefix.indexOf('{') >= 0
                || keyPrefix.indexOf('}') >= 0 || keyPrefix.indexOf('|') >= 0) {
            throw new IllegalArgumentException("keyPrefix contains unsupported characters");
        }
    }

    private static void requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }

    private static void requirePositive(int value, String name) {
        if (value < 1) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
