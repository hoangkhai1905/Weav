# Identity Service

> Status: V1 core implemented (auth, sessions, OTP recovery, Google OAuth web transport, admin user control, avatar, internal directory, security-notification outbox); Gateway/client integration and durable rate limiting are Partial. Owner: TBD (T's work logs cover Identity; the API Gateway is owned by the partner). Last verified: 2026-09-30 against `dev`.

## Purpose and scope

Identity owns user accounts and authentication for Weav: registration, password login, access/refresh tokens, sessions, email OTP (verification and password recovery), optional Google OAuth (login and link), profile and avatar, the system role (`USER` / `ADMIN`), account status (`ACTIVE` / `DISABLED`), and admin user management. It also serves a private user-directory lookup for other services and records security-notification events in a transactional outbox.

Not responsible for: workspaces, membership, workspace roles/permissions, connections and credentials (Workspace Service), workflows, Telegram linking (Bot), notification delivery (Notification Service), edge routing/rate limiting for public traffic (API Gateway). Identity has no notion of workspace scope.

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC001 | Sign in | Implemented | `POST /auth/login` (password) and Google login via `/auth/oauth/*` ([AuthController](../../../services/identity-service/src/main/java/com/weav/identity/presentation/http/AuthController.java), [OAuthController](../../../services/identity-service/src/main/java/com/weav/identity/presentation/http/OAuthController.java)). Google is optional (off unless configured). |
| UC002 | Forgot password | Implemented | `POST /auth/forgot-password`, `/auth/otp/request` + `/auth/otp/verify` (purpose `PASSWORD_RESET`), `POST /auth/reset-password` with an at-most-once grant. OTP by email only; no reset link. Depends on SMTP being configured. |
| UC003 | Register | Implemented | `POST /auth/register`; always `USER`/`ACTIVE`, `emailVerifiedAt` null, login allowed before verification. |
| UC004 | Change password | Implemented | `POST /auth/change-password`; requires current password, revokes every session. |
| UC025 | List users (System Admin) | Implemented | `GET /admin/users`, `GET /admin/users/{userId}` ([AdminUserController](../../../services/identity-service/src/main/java/com/weav/identity/presentation/http/AdminUserController.java)). |
| UC026 | Lock/unlock accounts | Implemented | `PATCH /admin/users/{userId}/status` (`ACTIVE`/`DISABLED`); disabling revokes all target sessions. |

Supporting capabilities beyond the thesis UC list (Implemented): profile (`GET/PATCH /users/me`), session list/revoke, email verification via OTP, Google link/unlink, avatar upload/read/delete, internal directory.

## Business rules

| Rule | How Identity enforces it |
| --- | --- |
| BR01 | Passwords are BCrypt-hashed; access JWT (HS256) carries user id (`sub`), session id (`sid`), `system_role`. Protected routes call the `CurrentIdentityGuard` to re-check the current DB user (active) and matching active session, so a stale JWT role or a revoked/disabled account is rejected with `401`. Workspace-scope checks belong to Workspace/Workflow, not here. |
| BR02-BR09 | Not enforced here. |

Component-specific rules (from code and the [auth contract README](../../../packages/contracts/http/auth/README.md)):

- Email is canonicalised (`lower(btrim(email))`, unique index `uk_users_canonical_email`); max 320 chars.
- Password 8-72 characters and at most 72 UTF-8 bytes (BCrypt limit) ([AuthInputPolicy](../../../services/identity-service/src/main/java/com/weav/identity/application/validation/AuthInputPolicy.java)); display name max 120.
- JSON with unknown properties is rejected (`spring.jackson.deserialization.fail-on-unknown-properties=true`), so privileged fields (`role`, `status`) cannot be mass-assigned.
- Refresh tokens are opaque, stored hashed, rotated on refresh; change/reset password and admin disable revoke all sessions.
- Admin status changes reject any `ADMIN` target (including the actor) with `409`; the admin role is read from the DB, not the JWT.
- One OAuth account per (user, provider) (V4) and per (provider, provider user id); unlinking the last login method is refused.
- Recovery endpoints return the same opaque receipt whether or not an eligible local account exists (anti-enumeration).

## Domain model and data

Database `identity-db` on Neon, schema `identity` (`DB_SCHEMA`, default `identity`; Flyway creates it). Hibernate `ddl-auto=validate`. Migrations in [db/migration](../../../services/identity-service/src/main/resources/db/migration):

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id` UUID PK, `email` (unique, plus canonical unique index V2), `password_hash` (nullable for OAuth-only), `display_name`, `avatar_storage_key`, `system_role`, `status`, `email_verified_at` (V3), timestamps | Roles `USER`/`ADMIN`; status `ACTIVE`/`DISABLED`. |
| `user_sessions` | `id` UUID PK, `user_id` FK (cascade), `refresh_token_hash` unique, `user_agent`, `ip_address`, `expires_at`, `revoked_at`, `last_used_at`, `created_at` | Index on `user_id`. |
| `oauth_accounts` | `id`, `user_id` FK (cascade), `provider` (only `GOOGLE`), `provider_user_id`, `provider_email`, timestamps | Unique (provider, provider_user_id) and (user_id, provider, V4). |
| `notification_outbox` | `event_id` PK, `event_type`, `payload` JSONB, `created_at`, `published_at`, `attempts`, `next_attempt_at`, `last_failure_code` (V5) | Partial index on unpublished rows. Additive; do not drop on rollback ([notes](../../../services/identity-service/notification-outbox.md)). |

Short-lived state lives in Valkey (not Postgres): OTP challenges/grants, OAuth transactions and handoffs ([authstate](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/authstate/)). Avatars are objects in S3-compatible storage (Cloudflare R2), only the key is stored in `users`. Architecture: clean layers (`presentation`, `application`, `domain`, `infrastructure`) guarded by an ArchUnit test.

## API

Machine-readable contract: [packages/contracts/http/auth/openapi.yaml](../../../packages/contracts/http/auth/openapi.yaml) (+ [README](../../../packages/contracts/http/auth/README.md)). Routes are Identity-local; the Gateway maps public prefixes. Error bodies use `ApiErrorResponse`; typical errors are `400` validation, `401` bad/absent credentials or revoked session, `403` non-admin, `404`, `409` conflict, `429` rate limit, `503` dependency down.

### Public API (via Gateway)

| Method, path | Auth | Purpose |
| --- | --- | --- |
| `POST /auth/register` | Public | Create account (201, no session). |
| `POST /auth/login` | Public | Token pair + user (`no-store`). |
| `POST /auth/refresh`, `POST /auth/logout` | Refresh token in JSON | Rotate / revoke (native clients). |
| `POST /auth/web/refresh`, `POST /auth/web/logout`; `GET /auth/web/csrf` | Origin + XSRF double-submit, HttpOnly refresh cookie | Web session transport. |
| `POST /auth/change-password` | Bearer + current password | 204, revoke all sessions. |
| `POST /auth/forgot-password`, `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/reset-password` | Public for `PASSWORD_RESET`; bearer for `EMAIL_VERIFICATION` | OTP recovery and email verification. |
| `POST /auth/oauth/google/start`, `GET /auth/oauth/google/callback`, `POST /auth/oauth/exchange` | Registered Origin/XSRF, state binding | Google login/link handoff. Absent when OAuth disabled. |
| `POST /users/me/oauth/google/link`, `GET /users/me/oauth-accounts`, `DELETE /users/me/oauth-accounts/{accountId}` | Bearer (+ password, Origin/XSRF for mutations) | Manage linked Google account. |
| `GET/PATCH /users/me` | Bearer | Profile; only `displayName` writable. |
| `GET /users/me/sessions`, `DELETE /users/me/sessions/{sessionId}`, `DELETE /users/me/sessions` | Bearer | List / revoke sessions. |
| `PUT/GET/DELETE /users/me/avatar` | Bearer | Upload (multipart), signed URL (about 5 min), delete. |
| `GET /admin/users`, `GET /admin/users/{userId}`, `PATCH /admin/users/{userId}/status` | Bearer, DB role `ADMIN` | UC025/UC026. List: `page`, `size` 1-100, search up to 120 chars, status filter. |
| `GET /actuator/health[/**]` | Public | Liveness/readiness (`db` in readiness). |

### Internal API (service-to-service)

| Caller | Method, path | Auth | Purpose |
| --- | --- | --- | --- |
| Workspace Service ([IdentityDirectoryHttpClient](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java)) | `POST /internal/directory/users/by-email`, `/match`, `/search`, `/batch` | Header key checked by [InternalServiceKeyFilter](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/security/InternalServiceKeyFilter.java) against `IDENTITY_INTERNAL_SERVICE_KEY` (constant-time compare; missing/unconfigured key gives `401`) | Resolve users for membership UIs; batch and search id lists capped at 500, search text at 120. |

## Events and messaging

Published (RabbitMQ, exchange `NOTIFICATION_EXCHANGE`, default `weav.events`; routing key = event type; Notification v2 envelope per [notifications-v2.md](../../../packages/contracts/http/notifications-v2.md) and [event-v2.schema.json](../../../packages/contracts/events/notification/event-v2.schema.json)):

| Routing key | When | Recipient / payload |
| --- | --- | --- |
| `identity.password_changed` | Password change | Affected user, actor = user, empty `data`. |
| `identity.password_reset` | Password reset | Affected user, null actor. |
| `identity.google_linked`, `identity.google_unlinked` | Explicit link/unlink | Affected user, actor = user. |

Delivery is a transactional outbox (`notification_outbox`) drained by [IdentityNotificationOutboxPublisher](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/messaging/notification/IdentityNotificationOutboxPublisher.java) with publisher confirms + mandatory returns; retries reuse the same event id. Consumed: None. Routine login and Google login emit no events.

## Dependencies

| Dependency | Direction | Use |
| --- | --- | --- |
| Neon PostgreSQL (`identity-db`) | Identity to DB | All persistent state. |
| Valkey | Identity to cache | OTP and OAuth transient state (`VALKEY_URL`). |
| RabbitMQ | Identity to broker | Outbox publication only; not required for Identity to serve or start. |
| SMTP server | Identity to mail | OTP emails via bounded async dispatcher. |
| Google OIDC | Identity to provider | Optional login/link. |
| Cloudflare R2 / S3-compatible | Identity to storage | Avatars; `UnavailableAvatarStorage` is used when unconfigured. |
| API Gateway | Caller | Public auth/profile/admin routes (`IDENTITY_SERVICE_URL`). |
| Workspace Service | Caller | Internal directory. |
| Other services | Verify Identity-issued access JWTs | Shared HS256 secret, issuer `weav-identity`, audience `weav-api`. |

## Security

- Access JWT: HS256, `JWT_ACCESS_SECRET` (at least 32 bytes), issuer/audience/expiry/clock-skew validated; `sub` user id, `sid` session id, `token_use=access`. Refresh tokens are opaque random values, stored as hashes, signed/derived with `JWT_REFRESH_SECRET`.
- Method security enabled; everything not listed as public in [SecurityConfig](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/security/SecurityConfig.java) requires a valid bearer; sessions are stateless; CSRF is disabled globally and re-implemented as a signed double-submit token only for the cookie-based OAuth/web routes; CORS limited to the configured OAuth web origin.
- `/internal/directory/**` is `permitAll` at the Spring level but guarded by the service-key filter; it must never be exposed through the Gateway.
- Secrets (`JWT_*`, `OTP_HMAC_SECRET` at least 32 bytes, `IDENTITY_INTERNAL_SERVICE_KEY`, DB, SMTP, Google, R2 keys) come from environment only. Passwords, tokens, OAuth state/verifiers must not appear in logs, URLs, or error bodies.
- Avatar upload: JPEG/PNG/WebP only, at most 2 MiB, at most 4096 px per side; magic-byte + decoder check and re-encode to strip metadata; object keys server-generated under `avatars/{userId}/`. Multipart hard limits 4 MB file / 5 MB request.
- Rate limits (per remote IP unless noted, in-memory): register 5/min, login 20/min, login per account 10/15 min, refresh 30/min, OAuth start 10/15 min, callback 20/min, exchange 30/min, link-start 10/15 min IP and 5/15 min session, unlink 10/15 min IP and 5/15 min session, CSRF 30/min, web refresh 30/min, web logout 10/15 min ([AuthRateLimiter](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/security/AuthRateLimiter.java)). OTP limits are Valkey-backed (below).

## Configuration

Names and defaults from [application.properties](../../../services/identity-service/src/main/resources/application.properties); no secret values. Compose service `identity-service` maps host 8081 to container 8080 ([compose.yml](../../../compose.yml)).

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | port 5432, name `postgres` | Neon connection (compose maps from `IDENTITY_DB_*`). |
| `DB_SSL_MODE`, `DB_SCHEMA` | `require`, `identity` | TLS mode, schema. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | none (required) | Token secrets. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `weav-identity`, `weav-api` | Claims. |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `JWT_CLOCK_SKEW` | `15m`, `7d`, `30s` | Lifetimes. |
| `VALKEY_URL` | none | Valkey connection. |
| `OTP_HMAC_SECRET` | none (required) | HMAC key for OTP fingerprints. |
| OTP policy (`weav.otp.*`) | challenge/grant TTL 5 min, resend cooldown 60 s, 5 challenges/account/h, 20/IP, 5 verify attempts, 30 verify/IP/min | Not env-exposed in properties; code defaults. |
| `IDENTITY_INTERNAL_SERVICE_KEY` | none | Key for `/internal/directory/**`. |
| `GOOGLE_OAUTH_ENABLED` | blank (auto-on if client id/secret set) | Toggle. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | redirect `http://localhost:8081/auth/oauth/google/callback` | Google client. |
| `OAUTH_WEB_RETURN_TARGET_URI`, `OAUTH_WEB_ALLOWED_ORIGIN` | `http://localhost:5173/auth/callback`, `http://localhost:5173` | Web return target and allowed Origin. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS` | blank, 25 | Mail server. |
| `SMTP_AUTH_ENABLED`, `SMTP_STARTTLS_ENABLED`, `SMTP_STARTTLS_REQUIRED`, `SMTP_SSL_ENABLED` | all `false` | Mail transport. |
| `SMTP_CONNECTION_TIMEOUT`, `SMTP_READ_TIMEOUT`, `SMTP_WRITE_TIMEOUT` | `3s`, `5s`, `5s` | Timeouts. |
| `SMTP_QUEUE_CAPACITY`, `SMTP_CORE_POOL_SIZE`, `SMTP_MAX_POOL_SIZE` | 100, 1, 2 | Mail dispatcher bounds. |
| `AVATAR_S3_ENDPOINT`, `AVATAR_S3_BUCKET`, `AVATAR_S3_ACCESS_KEY_ID`, `AVATAR_S3_SECRET_ACCESS_KEY` | blank | Object storage. |
| `AVATAR_S3_REGION`, `AVATAR_S3_PATH_STYLE_ACCESS`, `AVATAR_S3_KEY_PREFIX`, `AVATAR_S3_SIGNED_URL_TTL` | `auto`, `true`, `avatars`, `5m` | Storage tuning. |
| `AVATAR_S3_CLEANUP_QUEUE_CAPACITY`, `AVATAR_S3_CLEANUP_INTERVAL_MS` | 1000, 30000 | Orphan cleanup. |
| `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USERNAME`, `RABBITMQ_PASSWORD`, `RABBITMQ_VHOST`, `RABBITMQ_SSL_ENABLED`, `RABBITMQ_CONNECTION_TIMEOUT` | localhost, 5672, guest, `/`, false, 3s | Broker. |
| `NOTIFICATION_EXCHANGE` | `weav.events` | Outbox exchange (documented in notification-outbox.md). |
| `IDENTITY_NOTIFICATION_OUTBOX_PUBLISHER_ENABLED`, `_BATCH_SIZE`, `_POLL_INTERVAL`, `_INITIAL_DELAY`, `_CONFIRM_TIMEOUT`, `_MAX_RETRY_DELAY` | true, 25, 1000 ms, 1000 ms, PT5S, PT60S | Outbox publisher. |

## Non-functional requirements

- DB pool: Hikari max 3, min idle 0, connect timeout 10 s, max lifetime 5 min (Neon-friendly); Postgres time zone UTC.
- Health: `/actuator/health` with liveness and readiness probes (`readiness` includes `db`); only `health,info` exposed; no details shown.
- Idempotency: logout, session revoke, web logout are idempotent; outbox events carry a stable event id; reset grant and OAuth handoff are single-use.
- Mail is asynchronous through a bounded queue with short SMTP timeouts, so request latency does not depend on SMTP.
- Outbox: batch 1-250, poll 50-60,000 ms, confirm timeout up to 30 s, retry delay capped at 60 s; broker outage never blocks a password/account mutation.
- Logging: sanitized structured events (admin status audit with actor, target, action, result, correlation id); no credentials or payloads in logs.
- Login and refresh responses are `Cache-Control: no-store`.

## Status and known gaps

- Partial: IP/account rate limiter is in-memory per instance (resets on restart, not shared across replicas); Valkey is used only for OTP/OAuth state.
- Partial: avatar orphan cleanup is a bounded best-effort in-memory queue; tasks can be lost when full or on restart.
- Partial: password reset is OTP only; the thesis mentions "OTP/link" for UC002.
- Partial: user-facing verification is optional; login is allowed before email verification (no enforcement point in code).
- Partial: Google OAuth is a web transport only; mobile/native Google sign-in flow is not in this service.
- Planned/none: no account self-deletion, no MFA, no asymmetric JWT/JWKS (shared HS256 secret distributed to verifying services).
- Known environment-only test failures: Avatar integration tests x3 (MinIO image unpullable).

## Testing

From `services/identity-service`:

- `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (Windows JVM inherits `Asia/Saigon`, which Postgres Testcontainers reject; shell `TZ` does not help).
- Notable suites under [src/test](../../../services/identity-service/src/test/java/com/weav/identity): `IdentityCleanArchitectureTest` (layering), security/rate-limit/JWT tests, OTP and OAuth policy tests, controller/HTTP tests, Postgres/RabbitMQ Testcontainers integration tests, `S3AvatarStorageIntegrationTest`.
- Last full result (2026-09-30, `dev`): 324 tests, 3 environment-only errors (Avatar integration tests, MinIO `RELEASE.2024-06-04T19-20-08Z` image no longer pullable). Anything else is a regression.
- Testcontainers need Docker; stop containers and remove images afterwards.

## Open questions

1. **Spec/README location.** The task references a service README, but `services/identity-service` has none (only `HELP.md` and `notification-outbox.md`). Suggested: treat this spec plus the contract README as the service docs.
2. **UC002 "OTP or link".** Thesis says OTP/link by email; code implements OTP only. Suggested: keep OTP-only for V1 and update the thesis wording.
3. **Rate limiting placement.** Identity keeps an in-memory limiter while the Gateway also rate-limits at the edge. Suggested: keep both for V1; move Identity limits to Valkey if it is ever run with more than one replica.
4. **Notion/thesis "Redis" and `identity_schema`.** Code uses Valkey and schema `identity` in database `identity-db`. Suggested: follow code (as in the 2026-09-05 identity design doc).
5. **Env var naming drift.** `.env.example` also lists `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI/FRONTEND_RETURN_URL/STATE_TTL` and `REDIS_URL`, while Identity reads `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_WEB_RETURN_TARGET_URI`, `VALKEY_URL`, and the OAuth TTLs are not env-mapped. Suggested: reconcile `.env.example` with `application.properties` (the Gateway may use the `GOOGLE_OAUTH_*` names).
6. **Email verification enforcement.** Login is allowed before verification; does any V1 feature (for example workspace invitations) require a verified email? Suggested: no for V1.
7. **`/internal/directory/**` exposure.** The Gateway must not route it; confirm the Gateway allow-list excludes it. Suggested: add a Gateway test (handoff to partner).
8. **Owner.** Identity owner is not stated in the docs. Suggested: T (work logs under `docs/work_logs/T/`).

## References

- Code: [services/identity-service](../../../services/identity-service), [pom.xml](../../../services/identity-service/pom.xml) (Spring Boot 4.1.0, Java 25), [application.properties](../../../services/identity-service/src/main/resources/application.properties), [migrations](../../../services/identity-service/src/main/resources/db/migration).
- Docs: [notification-outbox.md](../../../services/identity-service/notification-outbox.md), [identity core auth design](../../superpowers/specs/2026-09-05-identity-core-auth-design.md), [identity readiness log](../../work_logs/K/identity-core-auth-readiness.md).
- Contracts: [auth OpenAPI](../../../packages/contracts/http/auth/openapi.yaml), [auth README](../../../packages/contracts/http/auth/README.md), [notifications-v2](../../../packages/contracts/http/notifications-v2.md), [event-v2 schema](../../../packages/contracts/events/notification/event-v2.schema.json).
- Related: [../README.md](../README.md), [../../rulebook.md](../../rulebook.md), Workspace [IdentityDirectoryHttpClient](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java).
