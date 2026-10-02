# Weav Backend Review — 2026-10-01

**Scope:** `services/identity-service`, `workspace-service`, `workflow-service` (Spring Boot); `api-gateway`, `notification-service`, `bot-service`, `ai-service` (NestJS); the seams between them (HTTP, RabbitMQ, Compose, shared packages). **Out of scope:** `services/ocr-service`, the gateway OCR proxy, and the OCR compose overlays (excluded at the user's request).

**Method:** Six specialist reviewers ran in parallel, all read-only: three Java reviewers, two TypeScript reviewers, and one architect. Every High finding and several Medium ones were then re-checked by hand against the source (marked ✔ below). No code was changed, no tests were run, and no containers were started.

**Ownership:** `api-gateway`, `notification-service` and OCR belong to the partner. Gateway fixes below are written as **handoffs**, per `CLAUDE.md`.

**Severity legend:** Critical = exploitable now or loses data under normal use; High = realistic duplicate or corrupted state, a security gap, or an outage under ordinary retries or load; Medium = needs a specific condition or a misconfiguration; Low = hygiene.

> **Verdict:** No Critical findings. The core is well engineered. It uses transactional outboxes, `SKIP LOCKED` claims, lease-fenced executions, row-lock serialisation, SSRF pinning, constant-time secret checks, and has no SQL injection surface. The real risk is concentrated at the **edges**:
> - ingress requests (webhooks, manual runs, publish) that are not idempotent;
> - crash recovery that re-runs side-effecting nodes;
> - client-IP loss that turns per-IP rate limits into global limits;
> - remote calls held inside DB transactions on a Hikari pool of 3.

---

## Top 10 (fix in this order)

| # | ID | Sev | Title | Owner |
|---|---|---|---|---|
| 1 | WF-1 / X-1 / GW-1 | High | Manual runs and webhooks have no idempotency key, so a retry creates a duplicate execution | you + gateway handoff |
| 2 | WF-2 (+WF-7) | High | Crash recovery re-runs HTTP/Gmail/Sheets nodes blindly | you |
| 3 | WF-3 | High | Publish is not idempotent; a double-click rotates the webhook secret and kills the first one | you |
| 4 | ID-2 / GW-2 | High | Client IP is lost at the gateway, so the identity login limit (20/min) becomes platform-wide | you + gateway handoff |
| 5 | X-2 / WS-2 / WS-3 / WF-10 / ID-4 / ID-8 | High | Remote HTTP and Valkey calls inside DB transactions, Hikari pool = 3 | you |
| 6 | WF-4 | High | Webhook rate limiter is one global counter consumed before auth; anyone can starve every tenant | you |
| 7 | NT-1 / X-4 | High | One poison event blocks the notification queue forever | partner |
| 8 | ID-1 | High | Refresh rotation has no reuse detection, and a lost response locks the user out | you |
| 9 | WS-6 | Medium→High | Google connect flow is not bound to the browser and has no PKCE, so a victim's mailbox can be attached to an attacker's connection | you |
| 10 | WS-1 | Medium | `user_status=DISABLED` tokens are accepted by workspace-service | you |

---

## 1. Bugs & Logic Errors

### [WF-5] Retry classification is wrong: transient HTTP failures are never retried ✔
- **Severity:** Medium
- **Location:** [ExecutionRunner.java:548-562](../../services/workflow-service/src/main/java/com/weav/workflow/application/execution/ExecutionRunner.java), [RetryPolicy.java:10-32](../../services/workflow-service/src/main/java/com/weav/workflow/domain/execution/RetryPolicy.java)
```java
Integer status = httpStatus(failure.code());          // "HTTP_RATE_LIMITED" -> substring "RATE_LIMITED" -> NumberFormatException -> null
return retryPolicy.canRetry(attemptsConsumed, failure.retryable()
        && retryPolicy.retryable(failure.code(), status));
// TRANSIENT_CODES = NETWORK_ERROR, TIMEOUT, WORKER_INTERRUPTED, AI_*   (no HTTP_TIMEOUT, HTTP_RATE_LIMITED, HTTP_DEPENDENCY_UNAVAILABLE)
```
- **Why:** Executors emit `HTTP_TIMEOUT`, `HTTP_RATE_LIMITED` and `HTTP_DEPENDENCY_UNAVAILABLE` with `retryable=true`. None of these is in `TRANSIENT_CODES`, and `httpStatus()` never yields a number from them. The "retry 429/5xx" branch is therefore dead code, and one provider blip fails the whole run.
- **Fix:** Do this **together with WF-2**, because turning retries on without idempotency keys creates duplicate side effects.
```java
// RetryPolicy
private static final Set<String> TRANSIENT_CODES = Set.of(
        "NETWORK_ERROR", "TIMEOUT", "WORKER_INTERRUPTED",
        "HTTP_TIMEOUT", "HTTP_RATE_LIMITED", "HTTP_DEPENDENCY_UNAVAILABLE",
        "AI_BUSY", "AI_PROVIDER_UNAVAILABLE", "AI_TIMEOUT");

// ExecutionRunner.shouldRetry — only retry side-effecting nodes when they carry an idempotency key (see WF-2)
private boolean shouldRetry(NodeExecutor.Failure failure, int attemptsConsumed, PreparedNode node) {
    boolean safe = !NodeCatalog.sideEffecting(node.type()) || node.sendsIdempotencyKey();
    return safe && retryPolicy.canRetry(attemptsConsumed,
            failure.retryable() && retryPolicy.retryable(failure.code(), null));
}
```

### [WF-9] A poison execution is re-queued by recovery forever; the DLQ has no consumer
- **Severity:** Medium (PLAUSIBLE)
- **Location:** `workflow-service/.../infrastructure/messaging/ExecutionJobListener.java:98`, `.../persistence/repository/ExecutionStateAdapter.java:330`
- **Why:** A run-level exception (not a node failure) releases the lease and leaves the run `RUNNING` with `lease_until IS NULL`. `enqueueRecoverable` then picks it up again every cooldown. Nothing counts these recoveries, so the loop never ends.
- **Fix:**
```sql
ALTER TABLE workflow_executions ADD COLUMN recovery_count INT NOT NULL DEFAULT 0;
```
```java
// claim(): when claiming a RUNNING row -> recovery_count = recovery_count + 1
// if recovery_count > 5 -> mark FAILED with code RECOVERY_EXHAUSTED, write the terminal outbox event, ack.
```

### [WF-8] Draft save is last-write-wins
- **Severity:** Medium
- **Location:** `workflow-service/.../application/service/WorkflowDraftService.java:109`
- **Why:** The row lock serialises writers but does not detect stale writes. With a second tab open, one save silently overwrites the other's draft, including its connection references.
- **Fix:**
```sql
ALTER TABLE workflows ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
```
```java
// SaveWorkflowDraftRequest: long expectedRevision   (or If-Match: "<revision>")
if (locked.getRevision() != request.expectedRevision()) throw new DraftChangedException(); // 409
locked.updateDraft(...); locked.incrementRevision();
```

### [WF-11] One execution per pod; all `@Scheduled` jobs share one thread
- **Severity:** Medium
- **Location:** `workflow-service/.../infrastructure/messaging/ExecutionWorkerRabbitConfiguration.java:51`; `application.properties` (no `spring.task.scheduling.pool.size`)
- **Why:**
  - `prefetch=1` with default concurrency, and `runner.run` blocks the listener until the run ends. A 30 s HTTP call, or a retry wait (`retryWait...join()`, WF-6), stalls every queued run on the pod.
  - The schedule scanner, the recovery scanner and both outbox publishers share one scheduler thread. A 5 s broker confirm wait can delay cron firing.
- **Fix:**
```properties
spring.task.scheduling.pool.size=4
```
```java
factory.setConcurrentConsumers(2);
factory.setMaxConcurrentConsumers(4);   // size together with the Hikari pool (see 5.1)
```

### [WF-12] Missing outbox index for the recovery probe; no retention anywhere
- **Severity:** Medium
- **Location:** `workflow-service/.../ExecutionStateAdapter.java:347`, `V1__create_workflow_entities.sql:221`; the same retention gap applies to identity `user_sessions` (ID-10) and every service's `notification_outbox`.
- **Fix:**
```sql
CREATE INDEX idx_outbox_aggregate ON outbox_events (aggregate_type, aggregate_id, event_type, created_at DESC);
-- scheduled purges (one leader via SKIP LOCKED or pg_try_advisory_lock):
DELETE FROM outbox_events       WHERE status = 'PUBLISHED' AND published_at < now() - interval '7 days';
DELETE FROM notification_outbox WHERE published_at < now() - interval '14 days';
DELETE FROM user_sessions       WHERE COALESCE(revoked_at, expires_at) < now() - interval '30 days';  -- identity
CREATE INDEX idx_user_sessions_active ON user_sessions (user_id, expires_at) WHERE revoked_at IS NULL; -- identity
```

### [X-3] `.env.example` points workspace-service at a RabbitMQ on `localhost` ✔
- **Severity:** Medium (latent: the current local `.env` does **not** set it, verified without printing values)
- **Location:** `compose.dev.yml:171`, `.env.example:192`
```yaml
RABBITMQ_HOST: ${RABBITMQ_HOST:-rabbitmq}   # workspace only; identity/workflow/notification hard-code "rabbitmq"
```
- **Why:** Anyone who copies `.env.example` gets `localhost` inside the container. Workspace deliberately starts without the broker, so its outbox then grows silently and no `workspace.*` or `connection.*` notifications are ever delivered.
- **Fix:** `RABBITMQ_HOST: rabbitmq` and `RABBITMQ_PORT: 5672` in `compose.dev.yml:171-172`, matching the other services. Also standardise the setting names `RABBITMQ_TLS_ENABLED`/`RABBITMQ_SSL_ENABLED` and `RABBITMQ_VHOST` across services (X-13).

### [ID-7] Avatar decode can use about 130 MB per request; the cleanup queue is in memory
- **Severity:** Medium
- **Location:** `identity-service/.../application/validation/AvatarImageValidator.java:135`, `AvatarCleanupReconciler.java:27`
- **Fix:**
```java
int w = reader.getWidth(0), h = reader.getHeight(0);
if ((long) w * h > 1_048_576L) throw new InvalidAvatarException("dimensions");   // check before reader.read(0)
```
  Also add a per-user upload limit, and persist pending cleanup work in an `avatar_cleanup` table written in the same transaction as the key swap.

### [NT-4] v1 and v2 notification read states diverge (PLAUSIBLE, partner)
- **Severity:** Medium
- **Location:** `notification-service/src/infrastructure/prisma.repository.ts:168` vs `prisma.inbox.repository.ts:249`
- **Why:** v1 mark-read writes `notification_deliveries.read_at`, while v2 writes `notification_inbox.read_at`. A client that uses both APIs sees inconsistent unread counts.
- **Fix:** Deprecate the v1 mutations, or write through to the inbox row via `inbox_id`.

### Lower-severity bugs
| ID | Sev | Location | Issue → fix |
|---|---|---|---|
| WF-6 | Low | `RetryPolicy.java:33`, `ExecutionRunner.java:163` | Fixed 1 s/2 s backoff with no jitter, and the listener thread is parked during the wait. Add jitter, and resume through `next_attempt_at` plus recovery instead of `join()`. |
| WF-15 | Low | `WorkflowTriggerAdapter.java:205` | Uses `Instant.now()` instead of the injected clock. "At most one catch-up run" is undocumented. |
| WS-9 | Low | `ListConnectionsUseCase.java:46` | N+1 credential query, and the list is unbounded. Use `findAllByConnectionIdIn(ids)`. |
| WS-12 | Low | `CompleteConnectionOAuthUseCase.java:122` | A reloaded callback shows "failed" after a success. The UI should re-fetch the connection status. |
| ID-9 | Low | `SpringDataUserRepository.java:32` | Leading-wildcard LIKE with `%`/`_` unescaped. Escape them, and add a `pg_trgm` GIN index. |
| NT-7 | Low | `rabbit.consumer.ts:129` | Backoff counter is reset only on success. Reset it when consuming resumes. |
| GW-7 | Low | `api-gateway/src/main.ts:4` | No shutdown hooks, and bootstrap is uncaught. Add `app.enableShutdownHooks(); bootstrap().catch(...)`. |
| AI-6 | Low | `ai-service/src/main.ts:20` | JWKS load failure is swallowed without a log line. Log the error class. |

---

## 2. Security Vulnerabilities

No SQL/JPQL injection was found: queries bind parameters, and dynamic schema names are regex-validated. No IDOR was found: every query is scoped by workspace or user, and non-members get 404. No XSS surface was found: the APIs are JSON only. No unsafe deserialisation was found: there is no polymorphic Jackson typing and no SpEL or script engine. The findings below are the real gaps.

### [ID-2 / GW-2] Real client IP is lost, so per-IP auth limits become global limits ✔
- **Severity:** High (availability; also weakens brute-force protection)
- **Location:** `identity-service/.../infrastructure/security/AuthRateLimitFilter.java:39`; identity `application.properties` (no `forward-headers-strategy`); `api-gateway/src/create-app.ts:19`; the gateway proxies forward only `authorization`, correlation ids, `traceparent` and `user-agent` (no `X-Forwarded-For`), e.g. `workspace-proxy.service.ts:109-122`.
```java
rateLimiter.requireAllowed(scope, request.getRemoteAddr());   // == gateway container IP for every user
```
- **Why:** Behind the gateway, every login comes from one IP, so `LOGIN_IP` (20/min) caps logins for the **whole platform**, and OTP per-IP quotas become global too. `user_sessions.ip_address` records the gateway IP. The gateway's own limiter has the same problem behind any load balancer (`trustProxy:false`).
- **Fix:**
```ts
// GATEWAY HANDOFF — create-app.ts + every proxy's header map
new FastifyAdapter({ trustProxy: config.TRUST_PROXY_HOPS ?? false });     // 1 when behind exactly one LB
headers['x-forwarded-for'] = request.ip;   // overwrite; never append the client-supplied value
// gateway-throttler.guard.ts getTracker:
return principal?.sub ? `sub:${principal.sub}` : `ip:${request.ip}`;
```
```properties
# identity-service application.properties — trust XFF only from the gateway network
server.forward-headers-strategy=native
server.tomcat.remoteip.internal-proxies=172\\.(1[6-9]|2[0-9]|3[0-1])\\.\\d{1,3}\\.\\d{1,3}
```
  Only do this **after** X-6 (identity must not be reachable directly), or clients can spoof XFF.

### [WS-6] Google "connect" OAuth flow is not bound to the initiating browser, and has no PKCE
- **Severity:** Medium (High if workflows can exfiltrate Gmail or Sheets data)
- **Location:** `workspace-service/.../presentation/http/GoogleOAuthCallbackController.java:418`, `infrastructure/provider/google/GoogleOAuthProvider.java:81-97`
- **Why:** An attacker who is a workspace member starts `/oauth/authorize` and sends the resulting Google URL to a victim. The victim consents, and the victim's refresh token is stored on the **attacker's** connection. State is single-use, but it is not tied to the user agent.
- **Fix:**
```java
// authorize: generate nonce + PKCE verifier, store sha256(nonce) and verifier in the pending state
String nonce = randomUrlSafe(32), verifier = randomUrlSafe(64);
pending = pending.withNonceHash(sha256(nonce)).withCodeVerifier(verifier);
response.addHeader("Set-Cookie", "weav_oauth_nonce=" + nonce
        + "; Path=/oauth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax");
url += "&code_challenge=" + base64Url(sha256(verifier)) + "&code_challenge_method=S256";

// callback
if (!MessageDigest.isEqual(sha256(cookieNonce), consumed.nonceHash())) return failure(STATE_INVALID);
tokenRequest.put("code_verifier", consumed.codeVerifier());
```

### [ID-1] Refresh token: no reuse detection, and a lost response locks the user out ✔
- **Severity:** High
- **Location:** `identity-service/.../application/usecase/RefreshSessionUseCase.java:59-68`
```java
UserSession session = sessionRepository.findByRefreshTokenHashForUpdate(submittedHash)...orElseThrow(401);
session.rotateRefreshToken(replacement.hash(), now);   // previous hash is overwritten
```
- **Why:** A stolen old token just gets a 401: the theft goes undetected and the session is not revoked. If the response carrying the new token is lost, which is common on mobile, the client's retry with the old token gets a 401 and the user is logged out.
- **Fix:**
```sql
ALTER TABLE user_sessions ADD COLUMN previous_refresh_token_hash VARCHAR(255), ADD COLUMN rotated_at TIMESTAMPTZ;
CREATE UNIQUE INDEX ux_user_sessions_prev_hash ON user_sessions (previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;
```
```java
Optional<UserSession> current = sessionRepository.findByRefreshTokenHashForUpdate(submittedHash);
if (current.isEmpty()) {
    UserSession prior = sessionRepository.findByPreviousRefreshTokenHashForUpdate(submittedHash)
            .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
    if (prior.getRotatedAt().isAfter(now.minusSeconds(10))) {
        // Idempotent retry inside the grace window. Either keep the last issued refresh token
        // encrypted for ~10 s and return it, or answer 409 RETRY_WITH_LATEST so the client re-reads storage.
        return reissueFor(prior, now);
    }
    prior.revoke(now);                                   // reuse detected: kill the session
    sessionRepository.save(prior);
    throw new UnauthorizedException(AUTHENTICATION_FAILED);
}
// rotateRefreshToken: previousHash = currentHash; currentHash = newHash; rotatedAt = now;
```

### [WS-1] Workspace accepts tokens of DISABLED users ✔
- **Severity:** Medium
- **Location:** `workspace-service/.../infrastructure/security/JwtAccessTokenValidator.java:29,67`. No other check exists in the service (verified by grep).
```java
private static final Set<String> USER_STATUSES = Set.of("ACTIVE", "DISABLED");
```
- **Fix:**
```java
&& "ACTIVE".equals(token.getClaimAsString(USER_STATUS_CLAIM));
```
  Check that workflow-service's validator does the same.

### [WF-4] Webhook rate limiter: one global in-memory counter, consumed before authentication ✔
- **Severity:** High
- **Location:** `workflow-service/.../application/trigger/WebhookTriggerService.java:42`, `WebhookIngressRateLimiter.java:51`
```java
if (!rateLimiter.tryAcquire()) { throw new WebhookRateLimitExceededException(); }   // before key lookup / secret check
```
- **Why:** About 100 unauthenticated requests per second with random keys exhaust the 6000/min budget, and every tenant's webhooks then get 429. The limit is also per JVM.
- **Fix:**
```java
if (!ipLimiter.tryAcquire(clientIp)) throw new WebhookRateLimitExceededException();             // cheap pre-auth, per IP
WorkflowTrigger trigger = lookupAndVerify(endpointKey, suppliedSecret);                          // existing constant-time path
if (!endpointLimiter.tryAcquire(trigger.getId())) throw new WebhookRateLimitExceededException(); // per endpoint, e.g. 120/min
// both limiters: Valkey INCR+EXPIRE (VALKEY_URL is already in compose but unused by workflow)
```

### [X-7 / WS-14] One static, unscoped key unlocks every decrypted credential
- **Severity:** Medium
- **Location:** `workflow-service/.../infrastructure/workspace/WorkspaceClient.java:37,133,196`; `workspace-service/.../security/InternalServiceKeyFilter.java:160-171`; `SecurityConfig.java:44` (`/internal/workspaces/**` is `permitAll`, and the filter is the sole guard)
- **Why:** `POST /internal/.../resolve` returns plaintext OAuth tokens and API keys for **any** workspace to anyone holding `WEAV_INTERNAL_SERVICE_KEY`. The key has no minimum length, no scope, no expiry and no caller identity. Combined with X-6 (ports bound to `0.0.0.0`), that key is the only thing protecting every stored credential.
- **Fix:** Reuse the RS256 service-JWT pattern that already exists for workflow→ai.
```java
// workflow: WorkspaceClient
String jwt = serviceJwtSigner.sign("weav-workflow", "weav-workspace",
        Map.of("scope", "connection:resolve", "workspace_id", workspaceId.toString(),
               "connection_id", connectionId.toString()), clock.instant());   // 60 s lifetime
request.header(HttpHeaders.AUTHORIZATION, "Bearer " + jwt);
// workspace: verify with the workflow JWKS; require scope + matching path ids.
// Interim: InternalServiceKeyProperties.isConfigured() -> serviceKey != null && serviceKey.length() >= 32
```

### [X-6] Services, the broker and its management UI listen on all interfaces with guest/guest defaults
- **Severity:** Medium (dev stack)
- **Location:** `compose.dev.yml:12-13,121-122,211-212,350-351`, `compose.yml:5-10`
- **Fix:** Bind to loopback, as `compose.workflow-smoke.yml` already does.
```yaml
ports: ["127.0.0.1:8082:8080"]                  # every service + 5672/15672
RABBITMQ_DEFAULT_USER: ${RABBITMQ_USERNAME:?set RABBITMQ_USERNAME}
```

### [ID-6 / GW-3 / WS-15 / X-8] HS256 shared secret in five services; revocation is not honoured downstream
- **Severity:** Medium
- **Location:** `identity-service/.../JwtAccessTokenIssuer.java:59`, `api-gateway/src/auth/access-token.service.ts:161`, `workspace-service/.../SecurityConfig.java:95-105`, `compose.dev.yml:135-136,225-226`
- **Why:**
  - Any compromised verifier (gateway, workspace, workflow, notification) can mint `system_role=ADMIN` tokens.
  - Disabled users, password changes and revoked sessions stay valid for up to 15 minutes everywhere except identity.
  - `JWT_REFRESH_SECRET` is passed to workspace and workflow but never read, and identity itself never uses it either: refresh tokens are SHA-256 hashed, which contradicts the spec.
- **Fix:** Now: delete `JWT_REFRESH_SECRET` from the workspace and workflow compose blocks and their properties. Next: identity signs RS256/EdDSA with a `kid` and serves `/.well-known/jwks.json`; Java services use `NimbusJwtDecoder.withJwkSetUri(...)`; gateway and notification use `createRemoteJWKSet` (handoff).

### [X-9] All services share one full-permission broker user, so events can be spoofed
- **Severity:** Medium
- **Fix:** Give each service its own RabbitMQ user, restricted with topic permissions, and have the consumer check `message.properties.userId` against the `producer` field.
```bash
rabbitmqctl set_topic_permissions identity weav.events "^identity\." ""
```
```java
rabbitTemplate.setBeforePublishPostProcessors(m -> { m.getMessageProperties().setUserId("identity"); return m; });
```

### [ID-3] Rate-limiter map can be filled with attacker-chosen keys, causing a global lockout ✔
- **Severity:** Medium
- **Location:** `identity-service/.../infrastructure/security/AuthRateLimiter.java:51-53`
```java
if (counters.size() >= maxEntries) { return Decision.blocked(...); }   // every NEW key blocked once full
```
- **Why:** Roughly 10k distinct fake emails fill the map, after which every new caller gets 429 for up to 15 minutes. `removeIf` runs in O(n) under a global lock on every call. The account scope also counts successful logins.
- **Fix:** Move the counters to Valkey (`INCR` plus `EXPIRE` in one Lua call, as `OtpChallengeStore` already does), and count only **failed** logins for `LOGIN_ACCOUNT`.

### Other security findings
| ID | Sev | Location | Issue → fix |
|---|---|---|---|
| ID-5 | Medium | `RegisterUserUseCase.java:46` | Register returns 409 for a known email, which enables enumeration. Return a generic 202 and send an "already registered" email, or document the accepted risk. |
| WS-7 | Medium | `AesGcmCredentialCrypto.java:66-85` | No key ring and no AAD, so rotating the key bricks every credential. Use `Map<version,key>`, `cipher.updateAAD(connectionId)`, and re-encrypt lazily. |
| WS-10 | Medium | `RedisWorkspaceAuthorizationCache.java:166` | Failed cache eviction is swallowed, so a removed member keeps access for up to the 5-minute TTL. Retry eviction through the outbox, or version-stamp entries. |
| WS-5 | Medium | `StartConnectionOAuthUseCase.java:73` | "Reconnect" disables a live connection before consent, and the owner bypasses the in-use check. Keep it ACTIVE until the callback swaps the credential. |
| AI-3 | Medium | `ai-service/.../generation-result.ts:13` | Generated graph: edges are not checked against node ids, there is no trigger-count or acyclicity rule, and config size and URLs are unbounded. Add a `superRefine`, and confirm that workflow re-validates on save. |
| WF-14 | Low | `WebhookTriggerService.java:57` | Static header secret with no HMAC or replay window, and every hit takes `PESSIMISTIC_WRITE` on the workflow. Add an optional HMAC mode, use `FOR SHARE`, and set a lock timeout. |
| ID-11 | Low | `AuthRateLimitFilter.java:64` | `/auth/reset-password` and `/auth/logout` are not in the HTTP limiter. Add them. |
| GW-6 | Low | `api-gateway/src/create-app.ts:17` | No helmet, implicit body limit, no request timeout (handoff). |
| NT-5 | Low | `notification-service/src/config/settings.ts:25` | Broker credentials default to guest/guest. Require them without defaults. |
| AI-8 | Low | `ai.controller.ts:42` | Config state is revealed before auth (503 vs 400 vs 401). |
| BOT-1 | Low | `bot-service/src/app.controller.ts` | Scaffold only. It needs auth, a health route and shutdown hooks before it is wired in. |

---

## 3. Strict Idempotency Check (CRITICAL)

### 3.1 State-changing endpoint and job matrix

Legend: ✅ idempotent · ⚠️ safe but a retry returns a different status (409/404/401) · ❌ duplicates or corrupts state on retry.

| Service | Endpoint / job | Verdict | Mechanism / gap |
|---|---|---|---|
| workflow | `POST /workspaces/{ws}/workflows/{id}/executions` (manual run) | ❌ | No key, so every retry queues a new run (WF-1) |
| workflow | `POST /webhooks/{endpointKey}` | ❌ | No delivery-id dedup (WF-1) |
| workflow | `POST /workspaces/{ws}/workflows/{id}/publish` | ❌ | New version plus **new webhook secret** on every call (WF-3) |
| workflow | `POST /workspaces/{ws}/workflows` (create) | ❌ | No key and no unique name, so a duplicate workflow and a `workflow.created` event |
| workflow | `PUT .../draft` | ⚠️ | Same body gives the same state, but last-write-wins (WF-8) |
| workflow | `POST .../pause`, `.../resume` | ✅ | Row lock; the event is emitted only when the status changes |
| workflow | Schedule scanner | ✅ | Row locks plus `uq_workflow_executions_trigger_schedule (trigger_id, scheduled_at)` |
| workflow | Execution worker `workflow.executions.v1` | ✅ run / ❌ side effects | Lease-fenced claim, but nodes are re-run on recovery (WF-2, WF-7) |
| workflow | Execution and notification outboxes | ✅ at-least-once | `SKIP LOCKED` plus fenced token, `messageId=eventId`; retries never end (WF-13) |
| workflow → ai | `AiClient` call | ❌ cost | A new random `requestId` per call, so every engine retry is billed again (AI-1, X-15) |
| workspace | `POST /workspaces` | ❌ unnamed / ⚠️ named | Unnamed retries create "My workspace N+1" (WS-8) |
| workspace | `POST .../members`, `POST .../connections` | ⚠️ | Unique constraints, so a retry gets 409 instead of the original 201 |
| workspace | `PATCH`/`DELETE` members and connections, `PUT .../credential`, `.../disable` | ✅/⚠️ | Absolute values under the workspace lock; a DELETE retry gets 404 |
| workspace | `POST .../oauth/authorize` | ❌ | Disables the connection and mints a new state on every call (WS-5) |
| workspace | `GET /oauth/google/callback` | ✅ | Atomic Lua GET+DEL single-use state |
| workspace | `POST /internal/.../resolve` | ⚠️ | Concurrent callers each refresh at Google; no single-flight (WS-4) |
| workspace | `POST /internal/.../auth-failure` | ⚠️ | A stale report can invalidate a freshly refreshed credential (WS-11) |
| workspace | Notification outbox job | ✅ at-least-once | `SKIP LOCKED`; retries never end (WS-13) |
| identity | `POST /auth/refresh` | ❌ | A lost response locks the client out (ID-1) |
| identity | `POST /auth/register`, `/otp/verify`, `/reset-password`, `/change-password` | ⚠️ | Unique index, single-use consume and hash snapshot, so a retry gets 409/400/401 |
| identity | `POST /auth/login` | ⚠️ | A new session per call by design; a retry leaves an orphan session |
| identity | `PUT /users/me/avatar` | ⚠️ | State converges, but each retry uploads an S3 object that may be orphaned (ID-7) |
| identity | `PATCH /users/me`, `DELETE sessions`, `PATCH /admin/users/{id}/status`, `/auth/logout` | ✅ | Row locks; conditional updates |
| notification | AMQP consumer | ✅ DB / ❌ poison | Advisory lock, unique `(source_event_id,user_id)`, ack after commit; poison messages loop forever (NT-1) |
| notification | Delivery worker (Telegram/Expo) | ⚠️ | At-least-once push; a crash after the provider accepts causes a re-send (NT-3) |
| notification | `PATCH :id/read`, `POST read-all` | ✅ | `WHERE read_at IS NULL` |
| gateway | All POST proxies | ❌ | Drops `Idempotency-Key`; CORS does not allow it; returns 503 on timeout even if the upstream committed (GW-1) |
| ai | `POST /v1/:operation` | ⚠️ | No state is written, but there is no in-flight or result dedup (AI-1) |

### [WF-1 / X-1 / GW-1] Execution admission has no idempotency key ✔
- **Severity:** High
- **Location:** `workflow-service/.../presentation/http/WorkflowExecutionController.java:41`, `WebhookController.java:26`, `infrastructure/persistence/repository/WorkflowExecutionRepositoryAdapter.java:158`; `api-gateway/src/workflow/workflow.module.ts:135-170`. `grep -ri idempotency` finds no executable code in workflow or the gateway.
- **Failure scenario:** A user clicks "Run". Workflow's access check to workspace takes up to 8 s and admission commits at about 14 s. The gateway aborts at 15 s, and the client sees a 503 and retries. Two runs then execute and two emails are sent. A provider redelivering a webhook (GitHub, Stripe or Telegram retry on timeout) does the same.
- **Fix:** Use the Idempotent Receiver pattern. Its building blocks are already there: the workflow row lock taken during admission, and the `scheduledExecution()` "return existing" path.
```sql
-- V6__execution_idempotency.sql
ALTER TABLE workflow_executions
  ADD COLUMN idempotency_key VARCHAR(128),
  ADD COLUMN request_hash    CHAR(64);
CREATE UNIQUE INDEX uq_workflow_executions_idem
  ON workflow_executions (workflow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```
```java
// WorkflowExecutionController / WebhookController
@RequestHeader(value = "Idempotency-Key", required = false)
@Pattern(regexp = "[A-Za-z0-9._:-]{8,128}") String idempotencyKey,
// webhook: fall back to well-known provider delivery headers
String key = firstNonBlank(idempotencyKey,
        headers.getFirst("X-GitHub-Delivery"), headers.getFirst("X-Webhook-Delivery-Id"));

// WorkflowExecutionRepositoryAdapter — inside the existing workflow-row lock, before persistAdmission(...)
if (command.idempotencyKey() != null) {
    Optional<WorkflowExecutionJpaEntity> existing =
            executionRepo.findByWorkflowIdAndIdempotencyKey(workflow.getId(), command.idempotencyKey());
    if (existing.isPresent()) {
        if (!existing.get().getRequestHash().equals(command.requestHash())) {
            throw new IdempotencyKeyReusedException();   // 422: same key, different body
        }
        return Admission.existing(existing.get());       // same 202 body as the first call
    }
}
// persistAdmission stores idempotency_key + sha256(canonical input JSON).
// The unique index is the backstop: on DataIntegrityViolationException, re-read and return the existing row.
```
```ts
// GATEWAY HANDOFF — create-app.ts allowedHeaders += 'Idempotency-Key'; in every POST proxy:
const key = getRequestHeader(request.headers, 'idempotency-key');
if (key && /^[A-Za-z0-9._:-]{8,128}$/.test(key)) headers['idempotency-key'] = key;
// on upstream timeout for non-GET: return 504 UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN (not 503) so clients retry with the same key.
```
  The web and mobile clients generate one UUID per user action and reuse it on retry. Apply the same pattern to `POST /workflows` (create) and `POST /workspaces` (WS-8), with a `(user_id, idem_key)` table there.

### [WF-2 (+WF-7)] Crash recovery re-executes side-effecting nodes ✔
- **Severity:** High
- **Location:** `workflow-service/.../persistence/repository/ExecutionStateAdapter.java:536-546`, `application/execution/ExecutionRunner.java:140,293`
```sql
UPDATE nodes SET status = CASE WHEN attempt_count BETWEEN 1 AND 2 THEN 'WAITING' ELSE 'FAILED' END, ...
WHERE execution_id = ? AND status = 'RUNNING'
```
- **Failure scenario:** The worker commits the node as RUNNING and sends a Gmail message or an HTTP POST. The pod is then killed or loses its lease (GC pause, or heartbeat starvation from 5.1) before it records the result. The next claimer marks the node WAITING and sends the message again, up to 3 times. `GmailClient` deliberately marks "may have reached Google" failures as non-retryable, but this path bypasses that protection. After a lease loss, in-flight futures are not cancelled either (WF-7), so two workers can run the same node concurrently.
- **Fix:**
```java
// 1) Stable provider idempotency key — HttpRequestNodeExecutor.execute, for POST/PUT/PATCH/DELETE:
request.header("Idempotency-Key", runtime.executionId() + ":" + node.id());   // same value on every attempt

// 2) Side-effecting nodes become OUTCOME_UNKNOWN instead of being retried blindly.
//    Persist the flag at admission: ALTER TABLE <node_table> ADD COLUMN side_effecting BOOLEAN NOT NULL DEFAULT false;
UPDATE %s SET status = CASE
        WHEN side_effecting AND NOT retry_on_interrupt THEN 'FAILED'
        WHEN attempt_count BETWEEN 1 AND 2 THEN 'WAITING' ELSE 'FAILED' END,
    error = CASE WHEN side_effecting AND NOT retry_on_interrupt
                 THEN CAST('{"code":"OUTCOME_UNKNOWN"}' AS jsonb) ELSE CAST(? AS jsonb) END, ...

// 3) WF-7 — ExecutionRunner, when leaseLost flips:
running.keySet().forEach(f -> f.cancel(true));
// and keep lease-duration > max node timeout (65 s AI) + 2 × heartbeat interval.
```

### [WF-3] Publish is not idempotent and rotates webhook credentials ✔
- **Severity:** High
- **Location:** `workflow-service/.../application/service/WorkflowPublicationService.java:119`, `:336`
```java
int versionNumber = versions.nextNumber(workflowId);              // always a new version
WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();  // always a new endpoint key + secret
```
- **Failure scenario:** A double-click, or a retry after a timeout, creates v2 and then v3. The user copied the secret from v2's response, which is shown once (`no-store`), but `replaceCurrent` already disabled that trigger. Every external sender now gets 401.
- **Fix:**
```java
// after lockByWorkspaceAndId(...) and samePublishSnapshot(...)
WorkflowVersion current = locked.getActiveVersionId() == null ? null : versions.get(locked.getActiveVersionId());
if (locked.getStatus() == WorkflowStatus.PUBLISHED && current != null
        && current.definitionEquals(beforeAuthorization.getDraftDefinition())) {
    return Publication.unchanged(locked, current);     // 200, no new version, no secret in body
}
// when building triggers for the new version: reuse endpoint_key + secret_hash of the previous version's
// webhook trigger with the same node id; mint a secret only via an explicit
// POST .../triggers/{nodeId}/rotate-secret endpoint.
```

### [NT-1 / X-4 / NT-2 / X-5] Notification consumer: unbounded poison loop, and the DLQ loses the payload ✔ (partner)
- **Severity:** High (NT-1), Medium (NT-2)
- **Location:** `notification-service/src/infrastructure/rabbit.consumer.ts:84-90,131-165`
```ts
} else {
  // Closing the connection requeues the unacked message; reconnect backoff prevents a hot loop.
  throw new Error('Event persistence unavailable');
}
```
- **Failure scenario:** Any persistent error outside `SyntaxError`, `ZodError` and the conflict error closes the connection and requeues the message, for example a Prisma data error or an invalid date. With `prefetch(1)` on a classic queue with no delivery limit, that event blocks **all** notifications forever, and readiness flaps. Malformed events reach the DLQ only as `{code, occurredAt}`, so they cannot be replayed.
- **Fix:** Use a quorum queue with a delivery limit. The existing queue's arguments cannot be changed in place (`PRECONDITION_FAILED`), so declare a new queue name and drain the old one.
```ts
await channel.assertQueue('notification-service.execution-events.v2', {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum',
    'x-delivery-limit': 10,
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': s.NOTIFICATION_DLQ,
  },
});
// classified (non-transient) errors: dead-letter the ORIGINAL message (x-death headers kept)
channel.nack(message, false, false);
// transient errors: nack(message, false, true) instead of closing the connection;
// the broker increments x-delivery-count and dead-letters after 10.
```

### Other idempotency findings
| ID | Sev | Fix |
|---|---|---|
| AI-1 | Medium | Send a **stable** `requestId = executionId:nodeId:attempt` from `AiClient` instead of `UUID.randomUUID()`. In ai-service, keep an in-flight map plus a 5-minute result LRU keyed by `${workspaceId}:${requestId}`. |
| WS-4 | Medium | Single-flight Google refresh: `SELECT ... FROM credentials WHERE connection_id=? FOR UPDATE` in a short transaction, re-check `expiresAt`, and refresh only if it is still expired (per connection, not the workspace lock). |
| NT-3 | Medium | Persist "provider accepted" before any retry. Use Expo collapse ids. Document Telegram as at-least-once. |
| WS-8 | Low | `workspace_idempotency(user_id, idem_key, workspace_id, PRIMARY KEY(user_id, idem_key))`. |
| WS-11 | Low | Include `credentialId` in the auth-failure report, and ignore it if it does not match the current credential. |
| WF-13 / WS-13 / X-14 | Low | Outbox retries never end. Add a `FAILED`/`dead_at` state after N attempts, an error log, and an `outbox_pending` gauge. |
| NT-6 | Low | A re-emitted event with more recipients is ignored. Use `createMany({ skipDuplicates: true })` for the missing `(user_id, event_id)` pairs. |

---

## 4. System Design Characteristics

### What is already achieved

| Characteristic | Evidence |
|---|---|
| **Reliability** | Transactional outbox in all three Java producers, with an insert that refuses to run outside a transaction, publisher confirms and `mandatory` (`JdbcNotificationOutboxAdapter.append`, `IdentityNotificationOutboxPublisher`, `WorkflowNotificationOutboxPublisher`). Execution admission writes the run, the nodes and the outbox row in one transaction (`WorkflowExecutionRepositoryAdapter.java:111-189`). Idempotent inbox in notification (advisory lock plus unique keys, ack after commit). |
| **Scalability** | Stateless services (JWT, `SessionCreationPolicy.STATELESS`, `open-in-view=false`). `FOR UPDATE SKIP LOCKED` claims and lease-fenced execution ownership with `lease_token` let workers scale out safely. Schedule double-fire is prevented by a unique index. |
| **Correctness under concurrency** | Consistent lock ordering (identity locks the user then the session, and admin locks actor and target in UUID order). A workspace-row lock serialises membership and connection mutations, so the last owner cannot be removed. Partial unique indexes back every invariant. |
| **Security** | SSRF defence in both HTTP providers: DNS pinning, private/metadata/IPv4-mapped ranges blocked, redirects off, size caps. Constant-time secret comparisons. AES-256-GCM with random nonces. Secrets are never returned to clients and are redacted in `toString`. Strict JWT claim validation. OAuth state is single-use via Lua. The gateway uses a route allow-list, UUID-validated path segments and a response-header allow-list. ai-service uses RS256 service JWTs with request binding. |
| **Maintainability** | Hexagonal layering (use cases, ports, adapters, `TransactionRunner`). Shared packages contain only contracts (rule respected). Versioned event schema (`schemaVersion: 2`). Central exception handlers with no stack traces. |
| **Performance** | Bounded request and response sizes and timeouts on every outbound client. Pagination capped at 100. Partial indexes on outbox due rows. |
| **Testability** | Use cases sit behind ports. Testcontainers integration tests. Consumer-driven runtime tests start the compiled notification consumer. JSON-schema contract tests (`DefinitionJsonCodecTest`, `notification-event.spec.ts`). |

### What needs improvement

| Characteristic | Problem | Evidence |
|---|---|---|
| **Availability** | A Hikari pool of 3 combined with network I/O inside transactions: three slow workspace or Google calls starve every request, scanner, outbox and lease heartbeat. | X-2 / WF-10: `WorkflowDraftService.java:83`, `WorkflowPublicationService.java:98`; WS-2: `TestConnectionUseCase.java:119-139` ✔; WS-3: `AddMemberUseCase.java:61`; ID-8: `VerifyOtpUseCase.java:77`; ID-4: outbox holds a connection during the broker confirm. `maximum-pool-size=3` in all three services. |
| **Availability** | Synchronous workspace↔workflow cycle with no circuit breaker and no cache. Deep readiness checks cascade. | X-12 (`WorkspaceClient.java:67`, `ConnectionUsageProtection.java:58`), X-10 (`health.service.ts:117`), workflow readiness includes `rabbit` |
| **Scalability** | Rate limits and quotas are per-JVM, in memory. Valkey is configured but unused by workflow and the gateway. | ID-3, WF-4, GW-2, AI-2, X-11 |
| **Throughput** | Single listener thread per pod, single scheduler thread. | WF-11 |
| **Data lifecycle** | No retention for outbox, executions, logs or sessions; a missing outbox index. | WF-12, ID-10 |
| **Observability** | No metrics or tracing (no Micrometer, OTel or Prometheus anywhere). AI calls break correlation. No DLQ or outbox-lag alerts. | X-15 (`AiClient.java:86`), WF-9, X-14 |
| **Security posture** | Symmetric JWT in five services; one static internal key; a shared broker user; ports on `0.0.0.0`. | ID-6, X-7, X-9, X-6 |
| **Ops** | Dev-only images: root user, full JDK, floating tags, no `restart:` and no memory limits; healthchecks only on identity and ai. | X-16 |

---

## 5. Architectural & Logic Improvements

### 5.1 Keep remote I/O out of transactions (SRP, Unit-of-Work scoping) — fixes X-2, WS-2, WS-3, WF-10, ID-4, ID-8
Apply the "check remotely, then lock and write briefly" shape everywhere. `CompleteConnectionOAuthUseCase.executePending` already uses it.
```java
// WorkflowDraftService — before
@Transactional
public Workflow save(...) {
    workspaceAuthorization.require(workspaceId, actorId, "WORKFLOW_EDIT");        // HTTP
    for (UUID c : newReferences) workspaceConnections.authorizeAttachment(...);    // N × HTTP
    ...lock + write...
}

// after
public Workflow save(UUID workspaceId, UUID workflowId, UUID actorId, SaveDraft cmd) {
    workspaceAuthorization.require(workspaceId, actorId, "WORKFLOW_EDIT");          // no tx, no DB connection held
    Set<UUID> refs = definitionCodec.connectionReferences(cmd.definition());
    workspaceConnections.authorizeAttachments(workspaceId, refs, actorId);          // ONE batch call (new internal endpoint)
    return tx.execute(status -> {                                                    // TransactionTemplate, short
        Workflow locked = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId).orElseThrow(...);
        if (locked.getRevision() != cmd.expectedRevision()) throw new DraftChangedException();   // WF-8
        locked.updateDraft(...);
        return workflowRepository.save(locked);
    });
}
```
The same shape applies to `TestConnectionUseCase` (WS-2): decrypt in a short transaction, call `provider.test` with no transaction open, then re-lock and write the result only if `updatedAt` is unchanged. It also applies to `AddMemberUseCase` (WS-3: resolve the email via Identity first) and `VerifyOtpUseCase` (ID-8). Then raise `maximum-pool-size` to 6–10 using Neon's pooled endpoint, and size the Rabbit consumers and the scheduler pool against that number.

### 5.2 Decorator caching and a Circuit Breaker on cross-service ports — X-12
```java
@Bean
WorkspaceAccessPort workspaceAccess(WorkspaceClient http) {
    Cache<AccessKey, Access> cache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofSeconds(30)).maximumSize(10_000).build();
    return (ws, user) -> cache.get(new AccessKey(ws, user), k -> http.getAccess(ws, user));
}
// resilience4j: @CircuitBreaker(name = "workspace") on WorkspaceClient, WorkflowConnectionUsageClient, AiClient
// slidingWindowSize=20, failureRateThreshold=50, waitDurationInOpenState=10s -> fail fast with 503 + Retry-After
```
Keep the 30 s TTL lower than, or equal to, the workspace authorization cache TTL so the revocation window does not grow.

### 5.3 Event-carried state transfer instead of a synchronous cycle (Dependency Inversion between bounded contexts)
Workspace already has an outbox. It should publish `connection.deleted` and `connection.disabled`. Workflow consumes them into its `connectionReferences` projection and marks affected drafts or versions invalid. That removes the workspace→workflow `usage` call and closes the delete race that the code admits it has (`ConnectionUsageProtection` comment).

### 5.4 Zero-trust service identity (least privilege)
1. Identity signs access tokens with RS256 or EdDSA and a `kid`, and serves a JWKS. Every verifier switches to a JWKS-based decoder. Remove `JWT_REFRESH_SECRET` from workspace and workflow now.
2. The internal workflow→workspace call uses scoped, 60 s service JWTs. The `ServiceJwtSigner` and JWKS already exist for ai.
3. Each service gets its own RabbitMQ user with topic permissions, and consumers verify `userId` against `producer`.
4. Bind compose ports to `127.0.0.1`, and add a gateway `/webhooks/:key` route (handoff) so workflow does not need to be exposed.

### 5.5 Make shared state actually shared
Move every in-memory limiter and queue to Valkey, which already runs:
- identity `AuthRateLimiter`;
- workflow `WebhookIngressRateLimiter` and `GenerationRateLimiter`;
- gateway throttler (`ThrottlerStorageRedisService`, handoff);
- ai-service per-workspace budget;
- identity `AvatarCleanupReconciler`, which should use a DB table instead.

One small Lua `INCR`+`EXPIRE` helper per stack is enough.
```lua
-- KEYS[1]=bucket ARGV[1]=window_s ARGV[2]=limit
local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n <= tonumber(ARGV[2]) and 1 or 0
```

### 5.6 Dead Letter Channel everywhere, with a terminal state
- Notification: quorum queue with `x-delivery-limit` (above).
- Workflow executions: a `recovery_count` cap (WF-9).
- All outboxes: `FAILED` after N attempts, plus a gauge.
- Every DLQ gets either a consumer that alerts or at least a metric.

### 5.7 Observability
- Add `micrometer-registry-prometheus` and `micrometer-tracing-bridge-otel` to the Java services, and `@opentelemetry/sdk-node` to the NestJS services. The `traceparent` header is already forwarded but never consumed.
- Propagate the execution's stored `correlation_id` to ai-service.
- Put `eventId` in notification logs.
- Minimum dashboards: Hikari pending threads, outbox lag, DLQ depth, lease losses, 429 rate by scope.

### 5.8 Ops and compose hardening
- Every service gets `restart: unless-stopped`, `mem_limit`, and an actuator or `/health` healthcheck.
- Use the hard-coded `rabbitmq` host for workspace (X-3).
- Standardise the `RABBITMQ_*` names (X-13).
- For anything beyond dev, use multi-stage Dockerfiles with a `-jre` base and `USER 10001`.

---

## Suggested fix plan

| Batch | Items | Why first |
|---|---|---|
| **1 — quick wins (≤1 day)** | WS-1 one-liner; X-3 compose host; drop unused `JWT_REFRESH_SECRET` (X-8); bind ports to 127.0.0.1 (X-6); internal key min length (WS-14); WF-6 jitter | Tiny diffs, real risk reduction |
| **2 — idempotency core** | WF-1 (+ gateway handoff GW-1), WF-3, WF-2 + WF-5 + WF-7 together, AI-1 stable requestId | The duplicate-side-effect class of bugs; this is the thesis's core promise |
| **3 — availability** | 5.1 transaction refactor across workflow/workspace/identity, then a pool of 6–10; WF-11 consumers and scheduler pool; WF-4 per-endpoint webhook limiter | Removes the pool-starvation outage mode |
| **4 — auth hardening** | ID-1 refresh grace and reuse detection; ID-2 client IP (with gateway handoff); ID-3 Valkey limiter; WS-6 OAuth nonce and PKCE | Security items with user-visible impact |
| **5 — platform** | RS256 + JWKS; service JWT for `resolve`; per-service broker users; retention jobs; metrics | Larger cross-service changes; plan each with a spec |
| **Partner handoffs** | NT-1/NT-2 quorum queue; GW-1 Idempotency-Key; GW-2 trustProxy, XFF and per-sub limits; GW-6/7 helmet and shutdown hooks; gateway webhook route (X-17) | Owned by the partner per `CLAUDE.md` |

## Verification notes
- Re-checked by hand against source: WF-1, WF-2, WF-3, WF-4, WF-5, WS-1, WS-2, ID-1, ID-2 (upgraded from PLAUSIBLE: the gateway forwards no XFF), ID-3, NT-1, GW-1, X-3 (downgraded: the local `.env` is not affected).
- PLAUSIBLE items that still need a reproduction test: WF-7 (lease loss during a long call), WF-9 (run-level poison), NT-4 (v1 and v2 used together), WS-11, AI-3 (whether workflow re-validates generated graphs).
- Fix snippets are written against the real class and method names, but helper names such as `Publication.unchanged`, `findByPreviousRefreshTokenHashForUpdate` and `authorizeAttachments` are new and must be added. Follow `CLAUDE.md`: run GitNexus `impact` before editing each symbol.
- Not covered: `services/ocr-service`, the gateway OCR proxy (GW-4/GW-5 were raised by a reviewer but are excluded per scope), and the web and mobile apps.
