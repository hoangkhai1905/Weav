# Identity authentication HTTP contract

This directory publishes the Identity-local contract for core authentication, the M1 profile/session/password-change milestone, the M2 email-verification/password-recovery target, and the bounded M3 Google OAuth web transport. The source of truth for request/response shapes is [openapi.yaml](./openapi.yaml). Publishing an operation here establishes the implementation target; runtime availability still requires the matching Identity implementation, Valkey/SMTP integration, and HTTP verification.

## Endpoint behavior

| Operation | Authentication | Success behavior |
| --- | --- | --- |
| `POST /auth/register` | Public | `201` with `UserResponse`; no session or token is created |
| `POST /auth/login` | Public | `200` with a token pair and public user |
| `POST /auth/refresh` | Opaque refresh token in JSON | `200` with a replacement token pair and public user |
| `POST /auth/logout` | Opaque refresh token in JSON | `204` with no body |
| `GET /users/me` | Access JWT in `Authorization: Bearer ...` | `200` with the public user associated with an active user/session |
| `PATCH /users/me` | Access JWT plus active matching user/session | `200` with the updated public user; only `displayName` is writable |
| `GET /users/me/sessions` | Access JWT plus active matching user/session | `200` with a page of the caller's active sessions |
| `DELETE /users/me/sessions/{sessionId}` | Access JWT plus active matching user/session | `204` for an owned session, including the current or an already-revoked session |
| `DELETE /users/me/sessions` | Access JWT plus active matching user/session | `204` after revoking all existing sessions, including the current session |
| `POST /auth/change-password` | Access JWT, active matching user/session, and current local password | `204` after changing the password and revoking every session |
| `POST /auth/otp/request` | Purpose-dependent: active self/session for `EMAIL_VERIFICATION`; public for `PASSWORD_RESET` | `202` with the same opaque OTP receipt for eligible and non-eligible recovery requests |
| `POST /auth/otp/verify` | Public for `PASSWORD_RESET`; active self/session for `EMAIL_VERIFICATION` | `200` with a purpose-bound verification result; password reset returns an at-most-once reset grant |
| `POST /auth/forgot-password` | Public | `202` with the same opaque receipt whether or not an eligible local account exists |
| `POST /auth/reset-password` | Public, at-most-once reset grant | `204` after password replacement and revocation of all existing sessions |
| `POST /auth/oauth/google/start` | Exact registered Origin | `200` with a registered Google authorization URL, opaque transaction handle, and CSRF value |
| `GET /auth/oauth/google/callback` | Provider redirect plus state/correlation binding | `303` only to the registered return target with an opaque handoff, or a fixed cancellation/provider error |
| `POST /auth/oauth/exchange` | Exact Origin/XSRF; anonymous LOGIN or matching bearer LINK | `200` access-only LOGIN JSON plus HttpOnly refresh cookie, or LINK metadata without a new session/cookie |
| `GET /auth/web/csrf` | Exact registered Origin | `200` with a signed non-secret CSRF value and matching cookie |
| `POST /auth/web/refresh` | Exact Origin/XSRF; refresh cookie only | `200` access-only LOGIN JSON plus one rotated HttpOnly refresh cookie; omit `Authorization` |
| `POST /auth/web/logout` | Exact Origin/XSRF; well-formed refresh cookie only | `204` after idempotent revocation and clearing the same HttpOnly cookie attributes |
| `POST /users/me/oauth/google/link` | Active bearer, current password, exact Origin/XSRF | `200` with the registered Google authorization URL and no account mutation yet |
| `GET /users/me/oauth-accounts` | Active bearer session | `200` with safe self-only provider metadata |
| `DELETE /users/me/oauth-accounts/{accountId}` | Active bearer, current password, exact Origin/XSRF | `204` for an owned account; safe `404`/`409` guards preserve other login methods |

Auth request bodies use `application/json`. Passwords and refresh tokens must never be placed in URLs, query strings, logs, or exception details. Login and refresh responses carry `Cache-Control: no-store`.

Registration always creates `USER` / `ACTIVE`; `emailVerifiedAt` is initially `null`, and login remains allowed before email verification. `role`, `systemRole`, `status`, `passwordHash`, `avatarStorageKey`, IDs, and timestamps are not accepted registration fields. The service rejects unknown JSON properties instead of silently binding privileged fields.

## M3 Google OAuth web transport

The OAuth routes use only registered logical client/return-target IDs and exact configured browser Origins. Unsafe exchange, link, unlink, refresh and logout requests require a signed, bounded `XSRF-TOKEN`/`X-XSRF-TOKEN` double-submit pair. Correlation and refresh cookies are host-only `HttpOnly; Secure; SameSite=Lax` cookies; the refresh value is never returned in JSON. Provider state, nonce, PKCE verifier, handoff proof, and provider tokens are not reflected in error responses or final redirect URLs. Web refresh/logout read only the uniquely-present refresh cookie, reject malformed or duplicate values, and require clients to omit `Authorization`; `/auth/refresh` and `/auth/logout` retain their existing JSON/native contract.

## M2 email verification and recovery rules

`UserResponse.emailVerifiedAt` is nullable and uses a UTC RFC 3339 timestamp. The field is present in the public user shape, including the user nested in token responses. Existing users and newly registered users start with `null`; registration alone is not proof of email ownership.

`POST /auth/otp/request` accepts `purpose=EMAIL_VERIFICATION` without an email member, or `purpose=PASSWORD_RESET` with an email member. Email verification always targets the authenticated user's current stored email; clients cannot select another destination. The email-verification branch requires an ACTIVE user and currently active matching session, but does not require the original requesting session ID to be reused. Verification re-checks that the challenge's email binding still matches that current stored email. Password recovery is public and sends mail only for an ACTIVE local-password account. Disabled, unknown, and OAuth-only accounts receive the same receipt and do not receive mail.

`POST /auth/forgot-password` is only a facade for the `PASSWORD_RESET` branch of `/auth/otp/request`; it has the same rate-limit budget and must not create a second recovery engine.

An OTP is a six-digit value generated with a cryptographically secure random source and expires after 300 seconds. Persisted challenge state stores only a keyed HMAC binding the code to the challenge, purpose, and user; plaintext OTPs never appear in responses, persisted records, logs, or exception details. The transient in-memory delivery job necessarily holds the code only until SMTP submission. A request supersedes the prior challenge and reset grant for the same account and purpose. A challenge permits at most five failed verification attempts and is consumed atomically on success. Concurrent verification of one challenge has at most one successful result.

Every accepted request returns the same opaque `OtpReceipt` shape: `challengeId` (43 unpadded base64url characters), `expiresIn: 300`, and `retryAfter: 60`. Eligible and non-eligible requests use the same challenge-ID length. The receipt is not evidence that an email was delivered. SMTP delivery is asynchronous and bounded; an eligible account gets a mail job, while a non-eligible account follows the same no-op admission path. Queue overload and unavailable Valkey return a sanitized `503` before account lookup. SMTP failure invalidates the associated challenge, while the public recovery response remains generic.

Request throttling is keyed without revealing account existence: a 60-second resend cooldown, at most 5 requests/hour per HMAC account key, at most 20 requests/hour per remote IP, and at most 30 verification attempts/minute per remote IP. OAuth web refresh is bounded to 30 requests/minute per remote IP and web logout to 10 requests/15 minutes per remote IP. Verification still enforces the five-failure-per-challenge limit. Forwarded headers are not trusted until a trusted proxy is configured.

For `PASSWORD_RESET`, successful OTP verification atomically consumes the challenge and returns an opaque 32-byte reset grant with a 300-second lifetime. The grant is hash-only, bound to the purpose/user, the challenge's current-email binding, and a credential fingerprint captured when the challenge was requested, and can be consumed at most once. Both OTP verification and password reset recheck the current credential fingerprint; a changed password invalidates the old grant. Reset consumes the grant before the PostgreSQL mutation; if the database transaction fails or the response is lost after consumption, the grant is not restored and the caller must request a new OTP. A reset rechecks ACTIVE status, the challenge's current-email binding against the user's current stored email, and the current credential fingerprint under the user lock, replaces the password, records `emailVerifiedAt` when still null, and revokes every existing session in the same database transaction.

M2 is a contract target only. It is not runtime-ready until the additive migration, atomic Valkey implementation, SMTP/mail-catcher evidence, real HTTP recovery sequence, concurrency tests, sanitized logs, and full Identity regression all pass.

## M1 profile and session rules

`PATCH /users/me` requires the `displayName` member. JSON null or a blank string clears the display name; a non-blank value is trimmed and may contain at most 120 characters. An empty object and unknown or privileged fields such as `email`, `role`, `systemRole`, `status`, and `avatarStorageKey` are rejected.

Session listing is self-only and returns active sessions ordered by `createdAt` descending and then `id`. Pagination is zero-based, defaults to page 0 with size 20, and accepts sizes from 1 through 100. A session item contains only `id`, `createdAt`, nullable `lastUsedAt`, `expiresAt`, `current`, and nullable `userAgent`; refresh tokens, token hashes, and raw IP addresses are never exposed.

Revoking one session is allowed for the current session. A missing session and another user's session both return `404`; repeating revocation for an owned session returns `204`. Revoking all sessions includes the session authorizing the request. A new login that genuinely completes after revoke-all may create a new session, but revoked sessions are never restored.

Password change uses the same no-trim, no-normalization, character, and UTF-8 byte limits as registration/login passwords. It requires the current local password; a wrong password and an OAuth-only account return the same generic `401`. Password replacement and revocation of all existing sessions are one transaction, so the client must log in again after `204`.

## Email and password rules

Core auth accepts ASCII email identifiers only. Before lookup or storage, Identity removes only boundary U+0020 SPACE characters and applies ASCII case folding using `Locale.ROOT`. Other leading, trailing, or embedded whitespace is rejected. Identity does not perform provider-specific dot removal, plus-address rewriting, Unicode normalization, or automatic rewriting of legacy accounts. The canonicalized value is the uniqueness key, while supported stored spelling may be returned in public responses.

Passwords are not trimmed or normalized. They must contain 8–72 characters and, because BCrypt is retained for this milestone, no more than 72 bytes in UTF-8. Responses never include passwords, password hashes, refresh-token hashes, or persistence entities.

## Token and session semantics

Access tokens are JWTs signed with an explicit `HS256` allowlist. Required claims are:

| Claim | Meaning |
| --- | --- |
| `iss` | `weav-identity` |
| `aud` | contains `weav-api` |
| `sub` | user UUID |
| `sid` | session UUID |
| `system_role` | current Identity system role |
| `token_use` | exactly `access` |
| `iat`, `nbf`, `exp` | required numeric-date claims |

Verifier keys for HMAC are also capable of signing tokens. Distribute the access-token secret only to trusted backend components. Moving to asymmetric signing and JWKS is a later rollout.

Refresh tokens are opaque, unpadded base64url encodings of 32 random bytes. Identity stores only a SHA-256 hash. Refresh rotation is atomic and single-use: a successful refresh replaces the stored hash, keeps the session's absolute expiry, and invalidates the submitted token. At most one concurrent request using the same refresh token may succeed.

Logout is idempotent for any well-formed token, including unknown, expired, and already-revoked tokens, and does not require a valid access token. A malformed request still returns the standard `400` error envelope. `/users/me` requires both a valid access JWT and a matching active user/session, so logout or account disablement takes effect there immediately.

If refresh rotation commits but its response is lost, retrying with the old token fails. Recovery for this core milestone is a fresh login. Clients must not silently retry rotation, and logout with the old token is not claimed to revoke the inaccessible replacement. Token-family history or idempotency support is deferred.

## Errors and throttling

All documented errors use the existing `ApiErrorResponse` envelope:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication failed",
    "details": []
  },
  "timestamp": "2026-09-05T08:30:00Z",
  "status": 401,
  "path": "/auth/login"
}
```

Validation or malformed input returns `400`, invalid credentials/account/session/token or an invalid protected-purpose session returns a generic `401`, a missing or non-owned session target returns `404`, canonical email conflict returns `409`, throttling returns `429` with `Retry-After`, temporarily unavailable Valkey or bounded delivery admission returns a sanitized `503`, and unexpected errors return a sanitized `500`. Wrong password, missing user, OAuth-only user, and disabled account must remain indistinguishable to login and public recovery callers. Wrong current password and OAuth-only account must also remain indistinguishable to password-change callers. Security-filter failures use the same envelope.

The development milestone defines bounded single-instance throttling: 20 login attempts/minute per remote IP, 5 registrations/minute per remote IP, 30 refreshes/minute per remote IP, and 10 login attempts/15 minutes per canonical account key. Forwarded headers are not trusted until a proxy is explicitly configured. Shared multi-replica throttling belongs to the Gateway/Valkey integration gate.

## Transport boundary

This API uses explicit bearer headers and JSON credentials and is directly suitable for native/API clients. Native clients may keep refresh material in Expo SecureStore in the later client milestone.

The M3 OAuth routes define a bounded browser handoff, exact trusted origins, route-specific CSRF protection, and an HttpOnly refresh cookie for the LOGIN exchange plus the cookie-only web refresh/logout routes. They do not authorize broad cookie authentication, Gateway proxy behavior, or mobile changes; those remain later transport work. The deterministic HTTP integration proof does not claim a live browser's Secure-cookie acceptance.
