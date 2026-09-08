package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OtpChallengeStore;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.infrastructure.config.OtpProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Valkey adapter for OTP state. Global opaque-token indexes are intentionally
 * separate-slot hints; account-slot Lua scripts remain authoritative for
 * generation, supersession and one-use consumption.
 */
@Component
public final class ValkeyOtpChallengeStore implements OtpChallengeStore {

    private static final DefaultRedisScript<String> ISSUE_SCRIPT = new DefaultRedisScript<>("""
            local previousChallenge = redis.call('HGET', KEYS[1], ARGV[1]) or ''
            local previousId = ''
            if previousChallenge ~= '' then
              previousId = redis.call('HGET', previousChallenge, 'id') or ''
              redis.call('DEL', previousChallenge)
            end
            local previousGrantToken = ''
            if ARGV[1] == 'PASSWORD_RESET' then
              local previousGrant = redis.call('HGET', KEYS[1], 'grant:PASSWORD_RESET') or ''
              if previousGrant ~= '' then
                previousGrantToken = redis.call('HGET', previousGrant, 'token') or ''
                redis.call('DEL', previousGrant)
                redis.call('HDEL', KEYS[1], 'grant:PASSWORD_RESET', 'generation:PASSWORD_RESET')
              end
            end
            redis.call('HSET', KEYS[2], 'id', ARGV[2], 'purpose', ARGV[1], 'account', ARGV[3],
              'user', ARGV[4], 'code', ARGV[5], 'credential', ARGV[6], 'attempts', '0')
            redis.call('EXPIRE', KEYS[2], ARGV[7])
            redis.call('HSET', KEYS[1], ARGV[1], KEYS[2], 'generation:' .. ARGV[1], ARGV[2])
            local retainedPurpose = 'EMAIL_VERIFICATION'
            if ARGV[1] == 'EMAIL_VERIFICATION' then retainedPurpose = 'PASSWORD_RESET' end
            local retainedTtl = 0
            local retainedChallenge = redis.call('HGET', KEYS[1], retainedPurpose) or ''
            if retainedChallenge ~= '' then
              retainedTtl = tonumber(redis.call('TTL', retainedChallenge) or '0') or 0
            end
            local retainedGrant = redis.call('HGET', KEYS[1], 'grant:PASSWORD_RESET') or ''
            if retainedGrant ~= '' then
              local grantTtl = tonumber(redis.call('TTL', retainedGrant) or '0') or 0
              if grantTtl > retainedTtl then retainedTtl = grantTtl end
            end
            local activeTtl = tonumber(redis.call('TTL', KEYS[1]) or '-1') or -1
            local desiredTtl = tonumber(ARGV[7]) or 0
            if retainedTtl > desiredTtl then desiredTtl = retainedTtl end
            if activeTtl < desiredTtl then redis.call('EXPIRE', KEYS[1], desiredTtl) end
            return previousId .. '|' .. previousGrantToken
            """, String.class);

    private static final DefaultRedisScript<String> VERIFY_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 'EXPIRED' end
            local purpose = redis.call('HGET', KEYS[1], 'purpose') or ''
            if purpose ~= ARGV[2] then return 'MISMATCH' end
            if redis.call('HGET', KEYS[1], 'account') ~= ARGV[1] then return 'MISMATCH' end
            if redis.call('HGET', KEYS[2], purpose) ~= KEYS[1]
               or redis.call('HGET', KEYS[2], 'generation:' .. purpose) ~= ARGV[3] then return 'SUPERSEDED' end
            local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
            local maximum = tonumber(ARGV[5])
            if attempts >= maximum then return 'TOO_MANY_ATTEMPTS' end
            if redis.call('HGET', KEYS[1], 'code') ~= ARGV[4] then
              attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
              if attempts >= maximum then return 'TOO_MANY_ATTEMPTS' end
              return 'WRONG_CODE|' .. tostring(maximum - attempts)
            end
            local user = redis.call('HGET', KEYS[1], 'user') or ''
            local credential = redis.call('HGET', KEYS[1], 'credential') or ''
            redis.call('DEL', KEYS[1])
            redis.call('HDEL', KEYS[2], purpose, 'generation:' .. purpose)
            local oldGrantToken = ''
            if purpose == 'PASSWORD_RESET' then
              local oldGrant = redis.call('HGET', KEYS[2], 'grant:PASSWORD_RESET') or ''
              if oldGrant ~= '' then
                oldGrantToken = redis.call('HGET', oldGrant, 'token') or ''
                redis.call('DEL', oldGrant)
              end
              redis.call('HSET', KEYS[3], 'purpose', purpose, 'account', ARGV[1],
                'user', user, 'credential', credential, 'token', ARGV[6], 'generation', ARGV[3])
              redis.call('EXPIRE', KEYS[3], ARGV[7])
              redis.call('HSET', KEYS[2], 'grant:PASSWORD_RESET', KEYS[3],
                'generation:PASSWORD_RESET', ARGV[3])
              local retainedTtl = 0
              local emailChallenge = redis.call('HGET', KEYS[2], 'EMAIL_VERIFICATION') or ''
              if emailChallenge ~= '' then
                retainedTtl = tonumber(redis.call('TTL', emailChallenge) or '0') or 0
              end
              local activeTtl = tonumber(redis.call('TTL', KEYS[2]) or '-1') or -1
              local desiredTtl = tonumber(ARGV[7]) or 0
              if retainedTtl > desiredTtl then desiredTtl = retainedTtl end
              if activeTtl < desiredTtl then redis.call('EXPIRE', KEYS[2], desiredTtl) end
            end
            return 'VERIFIED|' .. purpose .. '|' .. user .. '|' .. credential .. '|' .. oldGrantToken
            """, String.class);

    private static final DefaultRedisScript<String> CONSUME_GRANT_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 'MISSING' end
            if redis.call('HGET', KEYS[2], 'grant:PASSWORD_RESET') ~= KEYS[1]
               or redis.call('HGET', KEYS[2], 'generation:PASSWORD_RESET') ~= redis.call('HGET', KEYS[1], 'generation') then return 'MISSING' end
            if redis.call('HGET', KEYS[1], 'purpose') ~= 'PASSWORD_RESET'
               or redis.call('HGET', KEYS[1], 'account') ~= ARGV[1]
               or redis.call('HGET', KEYS[1], 'token') ~= ARGV[2] then return 'MISMATCH' end
            local user = redis.call('HGET', KEYS[1], 'user') or ''
            local credential = redis.call('HGET', KEYS[1], 'credential') or ''
            redis.call('DEL', KEYS[1])
            redis.call('HDEL', KEYS[2], 'grant:PASSWORD_RESET', 'generation:PASSWORD_RESET')
            return 'CONSUMED|PASSWORD_RESET|' .. user .. '|' .. credential
            """, String.class);

    private static final DefaultRedisScript<String> INVALIDATE_SCRIPT = new DefaultRedisScript<>("""
            local purpose = redis.call('HGET', KEYS[2], 'purpose') or ''
            local id = redis.call('HGET', KEYS[2], 'id') or ''
            if purpose ~= '' and redis.call('HGET', KEYS[1], purpose) == KEYS[2]
               and redis.call('HGET', KEYS[1], 'generation:' .. purpose) == id then
              redis.call('HDEL', KEYS[1], purpose, 'generation:' .. purpose)
            end
            redis.call('DEL', KEYS[2])
            return 'OK'
            """, String.class);

    private static final DefaultRedisScript<String> INVALIDATE_PURPOSE_SCRIPT = new DefaultRedisScript<>("""
            local previousChallenge = redis.call('HGET', KEYS[1], ARGV[1]) or ''
            local previousId = ''
            if previousChallenge ~= '' then
              previousId = redis.call('HGET', previousChallenge, 'id') or ''
              redis.call('DEL', previousChallenge)
            end
            local previousGrantToken = ''
            if ARGV[1] == 'PASSWORD_RESET' then
              local previousGrant = redis.call('HGET', KEYS[1], 'grant:PASSWORD_RESET') or ''
              if previousGrant ~= '' then
                previousGrantToken = redis.call('HGET', previousGrant, 'token') or ''
                redis.call('DEL', previousGrant)
              end
              redis.call('HDEL', KEYS[1], 'PASSWORD_RESET', 'generation:PASSWORD_RESET',
                'grant:PASSWORD_RESET')
            else
              redis.call('HDEL', KEYS[1], ARGV[1], 'generation:' .. ARGV[1])
            end
            return previousId .. '|' .. previousGrantToken
            """, String.class);

    private static final DefaultRedisScript<String> RESERVE_SCRIPT = new DefaultRedisScript<>("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
            local ttl = redis.call('TTL', KEYS[1])
            if count > tonumber(ARGV[1]) then return 'DENIED|' .. tostring(ttl) end
            return 'ALLOWED|' .. tostring(ttl)
            """, String.class);

    private final StringRedisTemplate redis;
    private final OtpProperties properties;
    private final KeyedFingerprint fingerprint;
    private final SecureRandom random;

    @Autowired
    public ValkeyOtpChallengeStore(StringRedisTemplate redis, OtpProperties properties, KeyedFingerprint fingerprint) {
        this(redis, properties, fingerprint, new SecureRandom());
    }

    ValkeyOtpChallengeStore(StringRedisTemplate redis, OtpProperties properties,
                            KeyedFingerprint fingerprint, SecureRandom random) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint must not be null");
        this.random = Objects.requireNonNull(random, "random must not be null");
    }

    @Override
    public String newChallengeId() {
        requireConfigured();
        byte[] value = new byte[32];
        random.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    @Override
    public ChallengeReceipt issue(Challenge challenge) {
        requireConfigured();
        requireAccountKey(challenge.accountFingerprint());
        requireScriptValue(challenge.challengeId(), "challengeId");
        requireScriptValue(challenge.userId(), "userId");
        requireScriptValue(challenge.codeFingerprint(), "codeFingerprint");
        if (challenge.credentialFingerprint() != null) {
            requireScriptValue(challenge.credentialFingerprint(), "credentialFingerprint");
        }
        long ttl = seconds(challenge.ttl());
        String active = activeKey(challenge.accountFingerprint());
        String key = challengeKey(challenge.accountFingerprint(), challenge.challengeId());
        String previous = execute(ISSUE_SCRIPT, List.of(active, key), challenge.purpose().name(),
                challenge.challengeId(), challenge.accountFingerprint(), challenge.userId(), challenge.codeFingerprint(),
                valueOrEmpty(challenge.credentialFingerprint()), Long.toString(ttl));
        cleanupOldIndexes(previous);
        setIndex(challengeIndex(challenge.challengeId()), challenge.accountFingerprint() + "|" + challenge.purpose().name(), ttl);
        return new ChallengeReceipt(true, previous != null && !"|".equals(previous), ttl);
    }

    @Override
    public ChallengeMetadata lookup(String challengeId) {
        requireConfigured();
        String indexed = readIndex(challengeIndex(challengeId));
        if (indexed == null) return null;
        IndexValue index = parseIndex(indexed);
        try {
            Map<Object, Object> values = redis.opsForHash().entries(challengeKey(index.account(), challengeId));
            if (values.isEmpty() || !challengeId.equals(values.get("id"))) return null;
            if (!index.purpose().name().equals(values.get("purpose"))) return null;
            String user = String.valueOf(values.get("user"));
            String credential = emptyToNull(String.valueOf(values.getOrDefault("credential", "")));
            return new ChallengeMetadata(challengeId, index.account(), index.purpose(), user, credential);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public VerificationResult verify(VerificationAttempt attempt) {
        requireConfigured();
        String indexed = readIndex(challengeIndex(attempt.challengeId()));
        if (indexed == null) return new VerificationResult(Status.EXPIRED, 0);
        IndexValue index = parseIndex(indexed);
        String account = index.account();
        String challengeKey = challengeKey(account, attempt.challengeId());
        String activeKey = activeKey(account);
        String grantToken = index.purpose() == Purpose.PASSWORD_RESET ? randomToken() : "";
        String tokenFingerprint = grantToken.isEmpty() ? "" : fingerprint.fingerprint("reset-grant", grantToken);
        String grantKey = grantToken.isEmpty() ? challengeKey + ":no-grant" : grantKey(account, tokenFingerprint);
        String value = execute(VERIFY_SCRIPT, List.of(challengeKey, activeKey, grantKey), account,
                index.purpose().name(), attempt.challengeId(), attempt.codeFingerprint(),
                Integer.toString(attempt.maxAttempts()), tokenFingerprint,
                grantToken.isEmpty() ? "1" : Long.toString(seconds(attempt.grantTtl())));
        VerificationResult result = parseVerification(value);
        if (result.verified()) {
            deleteIndex(challengeIndex(attempt.challengeId()));
            String[] fields = value.split("\\|", -1);
            if (fields.length == 5 && !fields[4].isBlank()) deleteIndex(grantIndex(fields[4]));
            if (index.purpose() == Purpose.PASSWORD_RESET) {
                setIndex(grantIndex(tokenFingerprint), account, seconds(attempt.grantTtl()));
                result = new VerificationResult(result.status(), result.purpose(), result.userId(),
                        result.credentialFingerprint(), grantToken, result.retryAfterSeconds());
            }
        }
        return result;
    }

    @Override
    public GrantConsumptionResult consumeGrant(String grantToken) {
        if (grantToken == null || grantToken.isBlank()) return new GrantConsumptionResult(false, null, null, null, null);
        requireConfigured();
        String tokenFingerprint = fingerprint.fingerprint("reset-grant", grantToken);
        String account = readIndex(grantIndex(tokenFingerprint));
        if (account == null) return new GrantConsumptionResult(false, null, null, null, null);
        if (!isSafeAccountKey(account)) throw new DependencyUnavailableException();
        String result = execute(CONSUME_GRANT_SCRIPT,
                List.of(grantKey(account, tokenFingerprint), activeKey(account)), account, tokenFingerprint);
        String[] fields = result.split("\\|", -1);
        if (fields.length == 4 && "CONSUMED".equals(fields[0])) {
            deleteIndex(grantIndex(tokenFingerprint));
            return new GrantConsumptionResult(true, account, Purpose.valueOf(fields[1]), fields[2], emptyToNull(fields[3]));
        }
        if ("MISSING".equals(fields[0]) || "MISMATCH".equals(fields[0])) {
            return new GrantConsumptionResult(false, null, null, null, null);
        }
        throw new DependencyUnavailableException();
    }

    @Override
    public void invalidate(Challenge challenge) {
        requireConfigured();
        execute(INVALIDATE_SCRIPT, List.of(activeKey(challenge.accountFingerprint()),
                challengeKey(challenge.accountFingerprint(), challenge.challengeId())));
        deleteIndex(challengeIndex(challenge.challengeId()));
    }

    @Override
    public void invalidatePurpose(String accountFingerprint, Purpose purpose) {
        requireConfigured();
        if (accountFingerprint == null || accountFingerprint.isBlank() || purpose == null) {
            throw new IllegalArgumentException("accountFingerprint and purpose are required");
        }
        requireAccountKey(accountFingerprint);
        String previous = execute(INVALIDATE_PURPOSE_SCRIPT,
                List.of(activeKey(accountFingerprint)), purpose.name());
        cleanupOldIndexes(previous);
    }

    @Override
    public AdmissionResult reserve(String scope, String key, int limit, Duration window) {
        requireConfigured();
        if (scope == null || scope.isBlank() || key == null || key.isBlank() || key.contains("{") || key.contains("}")
                || limit < 1 || window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("invalid admission parameters");
        }
        String value = execute(RESERVE_SCRIPT, List.of(properties.getKeyPrefix() + ":rate:{" + key + "}:" + scope),
                Integer.toString(limit), Long.toString(seconds(window)));
        String[] fields = value.split("\\|", -1);
        if (fields.length != 2) throw new DependencyUnavailableException();
        return new AdmissionResult("ALLOWED".equals(fields[0]), Math.max(0, parseLong(fields[1])));
    }

    private void cleanupOldIndexes(String previous) {
        if (previous == null) return;
        String[] fields = previous.split("\\|", -1);
        if (fields.length == 2) {
            if (!fields[0].isBlank()) deleteIndex(challengeIndex(fields[0]));
            if (!fields[1].isBlank()) deleteIndex(grantIndex(fields[1]));
        }
    }

    private VerificationResult parseVerification(String value) {
        String[] fields = value == null ? new String[0] : value.split("\\|", -1);
        if (fields.length == 5 && "VERIFIED".equals(fields[0])) {
            return new VerificationResult(Status.VERIFIED, Purpose.valueOf(fields[1]), fields[2],
                    emptyToNull(fields[3]), null, 0);
        }
        if (fields.length == 2 && "WRONG_CODE".equals(fields[0])) {
            return new VerificationResult(Status.WRONG_CODE,  parseLong(fields[1]));
        }
        return switch (fields.length == 0 ? "" : fields[0]) {
            case "EXPIRED" -> new VerificationResult(Status.EXPIRED, 0);
            case "SUPERSEDED" -> new VerificationResult(Status.SUPERSEDED, 0);
            case "TOO_MANY_ATTEMPTS" -> new VerificationResult(Status.TOO_MANY_ATTEMPTS, 0);
            case "MISMATCH" -> new VerificationResult(Status.MISMATCH, 0);
            default -> throw new DependencyUnavailableException();
        };
    }

    private void requireConfigured() {
        properties.validate();
        if (!properties.isConfigured()) throw new DependencyUnavailableException();
    }

    private <T> T execute(DefaultRedisScript<T> script, List<String> keys, String... args) {
        try {
            T result = redis.execute(script, keys, (Object[]) args);
            if (result == null) throw new DependencyUnavailableException();
            return result;
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private String readIndex(String key) {
        try {
            return redis.opsForValue().get(key);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private void setIndex(String key, String value, long ttl) {
        try {
            redis.opsForValue().set(key, value, Duration.ofSeconds(ttl));
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private void deleteIndex(String key) {
        try {
            redis.delete(key);
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private String randomToken() {
        byte[] value = new byte[32];
        random.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private String activeKey(String account) { return properties.getKeyPrefix() + ":active:{" + account + "}"; }
    private String challengeKey(String account, String id) { return properties.getKeyPrefix() + ":challenge:{" + account + "}:" + id; }
    private String grantKey(String account, String token) { return properties.getKeyPrefix() + ":grant:{" + account + "}:" + token; }
    private String challengeIndex(String id) { return properties.getKeyPrefix() + ":challenge-index:" + id; }
    private String grantIndex(String token) { return properties.getKeyPrefix() + ":grant-index:" + token; }

    private static IndexValue parseIndex(String value) {
        String[] fields = value.split("\\|", -1);
        if (fields.length != 2 || fields[0].isBlank()) throw new DependencyUnavailableException();
        if (!isSafeAccountKey(fields[0])) throw new DependencyUnavailableException();
        try { return new IndexValue(fields[0], Purpose.valueOf(fields[1])); }
        catch (IllegalArgumentException exception) { throw new DependencyUnavailableException(); }
    }

    private static long seconds(Duration value) {
        if (value == null || value.isZero() || value.isNegative() || value.getSeconds() < 1) {
            throw new IllegalArgumentException("duration must be at least one second");
        }
        return value.getSeconds();
    }

    private static long parseLong(String value) {
        try { return Long.parseLong(value); } catch (NumberFormatException exception) { throw new DependencyUnavailableException(); }
    }

    private static String valueOrEmpty(String value) { return value == null ? "" : value; }
    private static String emptyToNull(String value) { return value == null || value.isEmpty() ? null : value; }

    private static void requireAccountKey(String value) {
        if (!isSafeAccountKey(value)) throw new IllegalArgumentException("accountFingerprint contains unsupported characters");
    }

    private static boolean isSafeAccountKey(String value) {
        return value != null && !value.isBlank() && value.indexOf('{') < 0
                && value.indexOf('}') < 0 && value.indexOf('|') < 0;
    }

    private static void requireScriptValue(String value, String name) {
        if (value == null || value.isBlank() || value.indexOf('|') >= 0
                || value.indexOf('{') >= 0 || value.indexOf('}') >= 0) {
            throw new IllegalArgumentException(name + " contains unsupported characters");
        }
    }

    private record IndexValue(String account, Purpose purpose) { }
}
