package com.weav.identity.infrastructure.authstate;

import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.config.OAuthEnabledCondition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Conditional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Valkey adapter for the short-lived OAuth callback and handoff state.
 *
 * <p>Each record is a hash with a Redis TTL. Lua owns compare-before-consume,
 * collision handling, and proof-failure accounting so a failed proof cannot
 * race a valid consumer or mutate a different handoff. Physical deletion is
 * intentional: expired and replayed records are reported as {@code NOT_FOUND}
 * rather than retaining unbounded tombstones.</p>
 */
@Component
@Conditional(OAuthEnabledCondition.class)
public final class ValkeyOAuthTransactionStore implements OAuthTransactionStore {

    private static final String TRANSACTION_PREFIX = "oauth:tx:";
    private static final String HANDOFF_PREFIX = "oauth:handoff:";
    private static final String NULL_VALUE = "~";

    private static final String TRANSACTION_ID = "transactionId";
    private static final String INTENT = "intent";
    private static final String CLIENT_ID = "clientId";
    private static final String RETURN_TARGET_ID = "returnTargetId";
    private static final String STATE_FINGERPRINT = "providerStateFingerprint";
    private static final String NONCE_FINGERPRINT = "nonceFingerprint";
    private static final String PROVIDER_VERIFIER = "providerCodeVerifier";
    private static final String CODE_CHALLENGE = "codeChallenge";
    private static final String USER_ID = "userId";
    private static final String SESSION_ID = "sessionId";
    private static final String CREDENTIAL_FINGERPRINT = "credentialFingerprint";
    private static final String TTL = "ttl";
    private static final String HANDOFF_FINGERPRINT = "handoffCodeFingerprint";
    private static final String PROVIDER = "provider";
    private static final String PROVIDER_SUBJECT = "providerSubject";
    private static final String PROVIDER_EMAIL = "providerEmail";
    private static final String EMAIL_VERIFIED = "emailVerified";
    private static final String HOSTED_DOMAIN = "hostedDomain";
    private static final String ISSUED_AT = "issuedAt";
    private static final String MAX_PROOF_FAILURES = "maxProofFailures";
    private static final String PROOF_FAILURES = "proofFailures";

    private static final DefaultRedisScript<String> START_TRANSACTION_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 1 then
              local pttl = redis.call('PTTL', KEYS[1])
              if not pttl or pttl == -1 then return 'CORRUPT' end
              if pttl < 1 then return 'COLLISION|1' end
              return 'COLLISION|' .. tostring(math.max(1, math.floor(pttl / 1000)))
            end
            redis.call('HSET', KEYS[1],
              'transactionId', ARGV[1],
              'intent', ARGV[2],
              'clientId', ARGV[3],
              'returnTargetId', ARGV[4],
              'providerStateFingerprint', ARGV[5],
              'nonceFingerprint', ARGV[6],
              'providerCodeVerifier', ARGV[7],
              'codeChallenge', ARGV[8],
              'userId', ARGV[9],
              'sessionId', ARGV[10],
              'credentialFingerprint', ARGV[11],
              'ttl', ARGV[12])
            redis.call('PEXPIRE', KEYS[1], ARGV[12])
            return 'CREATED|' .. tostring(math.max(1, math.floor(tonumber(ARGV[12]) / 1000)))
            """, String.class);

    private static final DefaultRedisScript<String> CONSUME_CALLBACK_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 'NOT_FOUND' end
            local pttl = redis.call('PTTL', KEYS[1])
            if not pttl or pttl == -1 then return 'CORRUPT' end
            if pttl < 1 then return 'NOT_FOUND' end
            local values = redis.call('HMGET', KEYS[1],
              'transactionId', 'intent', 'clientId', 'returnTargetId',
              'providerStateFingerprint', 'nonceFingerprint', 'providerCodeVerifier',
              'codeChallenge', 'userId', 'sessionId', 'credentialFingerprint', 'ttl')
            for index = 1, #values do
              if not values[index] then return 'CORRUPT' end
            end
            if values[1] ~= ARGV[1] or values[1] ~= ARGV[2]
               or values[5] ~= ARGV[3] then return 'MISMATCH' end
            redis.call('DEL', KEYS[1])
            return 'CONSUMED|' .. table.concat(values, '|')
            """, String.class);

    private static final DefaultRedisScript<String> ISSUE_HANDOFF_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 1 then
              local pttl = redis.call('PTTL', KEYS[1])
              if not pttl or pttl == -1 then return 'CORRUPT' end
              if pttl < 1 then return 'COLLISION|1' end
              return 'COLLISION|' .. tostring(math.max(1, math.floor(pttl / 1000)))
            end
            redis.call('HSET', KEYS[1],
              'handoffCodeFingerprint', ARGV[1],
              'transactionId', ARGV[2],
              'intent', ARGV[3],
              'clientId', ARGV[4],
              'returnTargetId', ARGV[5],
              'codeChallenge', ARGV[6],
              'provider', ARGV[7],
              'providerSubject', ARGV[8],
              'providerEmail', ARGV[9],
              'emailVerified', ARGV[10],
              'hostedDomain', ARGV[11],
              'issuedAt', ARGV[12],
              'userId', ARGV[13],
              'sessionId', ARGV[14],
              'credentialFingerprint', ARGV[15],
              'maxProofFailures', ARGV[16],
              'proofFailures', '0',
              'ttl', ARGV[17])
            redis.call('PEXPIRE', KEYS[1], ARGV[17])
            return 'CREATED|' .. tostring(math.max(1, math.floor(tonumber(ARGV[17]) / 1000)))
            """, String.class);

    private static final DefaultRedisScript<String> CONSUME_HANDOFF_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 'NOT_FOUND' end
            local pttl = redis.call('PTTL', KEYS[1])
            if not pttl or pttl == -1 then return 'CORRUPT' end
            if pttl < 1 then return 'NOT_FOUND' end
            local values = redis.call('HMGET', KEYS[1],
              'handoffCodeFingerprint', 'transactionId', 'intent', 'clientId',
              'returnTargetId', 'codeChallenge', 'provider', 'providerSubject',
              'providerEmail', 'emailVerified', 'hostedDomain', 'issuedAt',
              'userId', 'sessionId', 'credentialFingerprint', 'maxProofFailures',
              'proofFailures', 'ttl')
            for index = 1, #values do
              if not values[index] then return 'CORRUPT' end
            end
            local maximum = tonumber(values[16])
            local failures = tonumber(values[17])
            local configuredMaximum = tonumber(ARGV[7])
            if not maximum or maximum < 1 or maximum ~= math.floor(maximum)
               or not configuredMaximum or maximum > configuredMaximum
               or not failures or failures < 0 or failures ~= math.floor(failures)
               or failures >= maximum then
              return 'CORRUPT'
            end
            if values[1] ~= ARGV[1] or values[2] ~= ARGV[2]
               or values[3] ~= ARGV[3] or values[4] ~= ARGV[4]
               or values[5] ~= ARGV[5] or values[6] ~= ARGV[6] then
              failures = redis.call('HINCRBY', KEYS[1], 'proofFailures', 1)
              if failures >= maximum then
                redis.call('DEL', KEYS[1])
                return 'TOO_MANY_PROOF_FAILURES'
              end
              return 'MISMATCH'
            end
            redis.call('DEL', KEYS[1])
            return 'CONSUMED|' .. table.concat(values, '|', 1, 16) .. '|' .. values[18]
            """, String.class);

    private final StringRedisTemplate redis;
    private final OAuthConfiguration configuration;

    @Autowired
    public ValkeyOAuthTransactionStore(StringRedisTemplate redis, OAuthConfiguration configuration) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
        this.configuration = Objects.requireNonNull(configuration, "configuration must not be null");
    }

    @Override
    public TransactionReceipt start(Transaction transaction) {
        requireConfigured();
        Objects.requireNonNull(transaction, "transaction must not be null");
        long ttl = boundedMillis(transaction.ttl(), configuration.stateTtl(), "state TTL");
        String result = execute(START_TRANSACTION_SCRIPT,
                List.of(transactionKey(transaction.transactionId())),
                encode(transaction.transactionId()),
                transaction.intent().name(),
                encode(transaction.clientId()),
                encode(transaction.returnTargetId()),
                encode(transaction.providerStateFingerprint()),
                encode(transaction.nonceFingerprint()),
                encode(transaction.providerCodeVerifier().value()),
                encode(transaction.handoffCodeChallenge()),
                encodeNullable(uuidValue(transaction.userId())),
                encodeNullable(uuidValue(transaction.sessionId())),
                encodeNullable(secretValue(transaction.credentialFingerprint())),
                Long.toString(ttl));
        return new TransactionReceipt(parseReceiptAccepted(result), parseReceiptTtl(result));
    }

    @Override
    public CallbackConsumeResult consumeCallback(CallbackBinding binding) {
        requireConfigured();
        Objects.requireNonNull(binding, "binding must not be null");
        String result = execute(CONSUME_CALLBACK_SCRIPT,
                List.of(transactionKey(binding.transactionId())),
                encode(binding.transactionId()),
                encode(binding.correlationTransactionId()),
                encode(binding.providerStateFingerprint()));
        if ("NOT_FOUND".equals(result)) {
            return new CallbackConsumeResult(CallbackStatus.NOT_FOUND, null);
        }
        if ("MISMATCH".equals(result)) {
            return new CallbackConsumeResult(CallbackStatus.MISMATCH, null);
        }
        if ("CORRUPT".equals(result)) {
            throw new DependencyUnavailableException();
        }
        if (result.startsWith("CONSUMED|")) {
            return new CallbackConsumeResult(CallbackStatus.CONSUMED,
                    parseTransaction(result.substring("CONSUMED|".length())));
        }
        throw new DependencyUnavailableException();
    }

    @Override
    public HandoffReceipt issueHandoff(Handoff handoff) {
        requireConfigured();
        Objects.requireNonNull(handoff, "handoff must not be null");
        if (handoff.maxProofFailures() > configuration.maxHandoffProofFailures()) {
            throw new IllegalArgumentException("handoff proof failure limit exceeds configured ceiling");
        }
        long ttl = boundedMillis(handoff.ttl(), configuration.handoffTtl(), "handoff TTL");
        OAuthProviderClient.ProviderIdentity identity = handoff.providerIdentity();
        String result = execute(ISSUE_HANDOFF_SCRIPT,
                List.of(handoffKey(handoff.handoffCodeFingerprint())),
                encode(handoff.handoffCodeFingerprint()),
                encode(handoff.transactionId()),
                handoff.intent().name(),
                encode(handoff.clientId()),
                encode(handoff.returnTargetId()),
                encode(handoff.codeChallenge()),
                encode(identity.provider().name()),
                encode(identity.providerSubject()),
                encodeNullable(identity.providerEmail()),
                identity.emailVerified() ? "1" : "0",
                encodeNullable(identity.hostedDomain()),
                encode(identity.issuedAt().toString()),
                encodeNullable(uuidValue(handoff.userId())),
                encodeNullable(uuidValue(handoff.sessionId())),
                encodeNullable(secretValue(handoff.credentialFingerprint())),
                Integer.toString(handoff.maxProofFailures()),
                Long.toString(ttl));
        return new HandoffReceipt(parseReceiptAccepted(result), parseReceiptTtl(result));
    }

    @Override
    public HandoffConsumeResult consumeHandoff(HandoffBinding binding) {
        requireConfigured();
        Objects.requireNonNull(binding, "binding must not be null");
        String result = execute(CONSUME_HANDOFF_SCRIPT,
                List.of(handoffKey(binding.handoffCodeFingerprint())),
                encode(binding.handoffCodeFingerprint()),
                encode(binding.transactionId()),
                binding.intent().name(),
                encode(binding.clientId()),
                encode(binding.returnTargetId()),
                encode(binding.codeChallenge()),
                Integer.toString(configuration.maxHandoffProofFailures()));
        if ("NOT_FOUND".equals(result)) {
            return new HandoffConsumeResult(HandoffStatus.NOT_FOUND, null);
        }
        if ("MISMATCH".equals(result)) {
            return new HandoffConsumeResult(HandoffStatus.MISMATCH, null);
        }
        if ("TOO_MANY_PROOF_FAILURES".equals(result)) {
            return new HandoffConsumeResult(HandoffStatus.TOO_MANY_PROOF_FAILURES, null);
        }
        if ("CORRUPT".equals(result)) {
            throw new DependencyUnavailableException();
        }
        if (result.startsWith("CONSUMED|")) {
            return new HandoffConsumeResult(HandoffStatus.CONSUMED,
                    parseHandoff(result.substring("CONSUMED|".length())));
        }
        throw new DependencyUnavailableException();
    }

    private void requireConfigured() {
        if (!configuration.enabled()) {
            throw new DependencyUnavailableException();
        }
    }

    private <T> T execute(DefaultRedisScript<T> script, List<String> keys, String... args) {
        try {
            T result = redis.execute(script, keys, (Object[]) args);
            if (result == null) {
                throw new DependencyUnavailableException();
            }
            return result;
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private static Transaction parseTransaction(String payload) {
        String[] fields = fields(payload, 12);
        try {
            return new Transaction(
                    decode(fields[0]),
                    Intent.valueOf(fields[1]),
                    decode(fields[2]),
                    decode(fields[3]),
                    decode(fields[4]),
                    decode(fields[5]),
                    new OAuthSecret(decode(fields[6])),
                    decode(fields[7]),
                    parseUuid(fields[8]),
                    parseUuid(fields[9]),
                    parseSecret(fields[10]),
                    Duration.ofMillis(parsePositiveLong(fields[11], "transaction TTL")));
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private static Handoff parseHandoff(String payload) {
        String[] fields = fields(payload, 17);
        try {
            OAuthProvider provider = OAuthProvider.valueOf(decode(fields[6]));
            boolean emailVerified = switch (fields[9]) {
                case "1" -> true;
                case "0" -> false;
                default -> throw new IllegalArgumentException("invalid email verification flag");
            };
            OAuthProviderClient.ProviderIdentity identity = new OAuthProviderClient.ProviderIdentity(
                    provider,
                    decode(fields[7]),
                    decodeNullable(fields[8]),
                    emailVerified,
                    decodeNullable(fields[10]),
                    Instant.parse(decode(fields[11])));
            return new Handoff(
                    decode(fields[0]),
                    decode(fields[1]),
                    Intent.valueOf(fields[2]),
                    decode(fields[3]),
                    decode(fields[4]),
                    decode(fields[5]),
                    identity,
                    parseUuid(fields[12]),
                    parseUuid(fields[13]),
                    parseSecret(fields[14]),
                    Duration.ofMillis(parsePositiveLong(fields[16], "handoff TTL")),
                    Integer.parseInt(fields[15]));
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
    }

    private static String[] fields(String payload, int expected) {
        if (payload == null) {
            throw new DependencyUnavailableException();
        }
        String[] fields = payload.split("\\|", -1);
        if (fields.length != expected) {
            throw new DependencyUnavailableException();
        }
        return fields;
    }

    private static boolean parseReceiptAccepted(String result) {
        String[] fields = fields(result, 2);
        if (!"CREATED".equals(fields[0]) && !"COLLISION".equals(fields[0])) {
            throw new DependencyUnavailableException();
        }
        return "CREATED".equals(fields[0]);
    }

    private static long parseReceiptTtl(String result) {
        String[] fields = fields(result, 2);
        try {
            long ttl = Long.parseLong(fields[1]);
            if (ttl < 1) {
                throw new DependencyUnavailableException();
            }
            return ttl;
        } catch (RuntimeException exception) {
            if (exception instanceof DependencyUnavailableException dependencyUnavailableException) {
                throw dependencyUnavailableException;
            }
            throw new DependencyUnavailableException();
        }
    }

    private static long parsePositiveLong(String value, String name) {
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 1) {
                throw new IllegalArgumentException(name + " must be positive");
            }
            return parsed;
        } catch (RuntimeException exception) {
            if (exception instanceof DependencyUnavailableException dependencyUnavailableException) {
                throw dependencyUnavailableException;
            }
            throw new DependencyUnavailableException();
        }
    }

    private static long boundedMillis(Duration requested, Duration maximum, String name) {
        if (requested == null || requested.isZero() || requested.isNegative()
                || maximum == null || requested.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(name + " must be positive and within the configured bound");
        }
        final long millis;
        try {
            millis = requested.toMillis();
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException(name + " is too large", exception);
        }
        if (millis < 1) {
            throw new IllegalArgumentException(name + " must be at least one millisecond");
        }
        return millis;
    }

    private static String transactionKey(String transactionId) {
        return TRANSACTION_PREFIX + transactionId;
    }

    private static String handoffKey(String handoffCodeFingerprint) {
        return HANDOFF_PREFIX + handoffCodeFingerprint;
    }

    private static String uuidValue(UUID value) {
        return value == null ? null : value.toString();
    }

    private static String secretValue(OAuthSecret value) {
        return value == null ? null : value.value();
    }

    private static String encodeNullable(String value) {
        return value == null ? NULL_VALUE : encode(value);
    }

    private static String encode(String value) {
        Objects.requireNonNull(value, "value must not be null");
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String decodeNullable(String value) {
        return NULL_VALUE.equals(value) ? null : decode(value);
    }

    private static String decode(String value) {
        if (value == null || NULL_VALUE.equals(value)) {
            throw new IllegalArgumentException("required value missing");
        }
        return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
    }

    private static UUID parseUuid(String value) {
        String decoded = decodeNullable(value);
        return decoded == null ? null : UUID.fromString(decoded);
    }

    private static OAuthSecret parseSecret(String value) {
        String decoded = decodeNullable(value);
        return decoded == null ? null : new OAuthSecret(decoded);
    }
}
