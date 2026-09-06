# Identity core authentication HTTP contract

This directory publishes the Identity-local contract for the first authentication milestone. It covers registration, login, refresh rotation, logout, and current-user lookup. The source of truth for request/response shapes is [openapi.yaml](./openapi.yaml).

## Endpoint behavior

| Operation | Authentication | Success behavior |
| --- | --- | --- |
| `POST /auth/register` | Public | `201` with `UserResponse`; no session or token is created |
| `POST /auth/login` | Public | `200` with a token pair and public user |
| `POST /auth/refresh` | Opaque refresh token in JSON | `200` with a replacement token pair and public user |
| `POST /auth/logout` | Opaque refresh token in JSON | `204` with no body |
| `GET /users/me` | Access JWT in `Authorization: Bearer ...` | `200` with the public user associated with an active user/session |

Auth request bodies use `application/json`. Passwords and refresh tokens must never be placed in URLs, query strings, logs, or exception details. Login and refresh responses carry `Cache-Control: no-store`.

Registration always creates `USER` / `ACTIVE`; email ownership is not verified by this milestone. `role`, `systemRole`, `status`, `passwordHash`, `avatarStorageKey`, IDs, and timestamps are not accepted registration fields. The service rejects unknown JSON properties instead of silently binding privileged fields.

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

Validation or malformed input returns `400`, invalid credentials/account/session/token returns a generic `401`, canonical email conflict returns `409`, throttling returns `429` with `Retry-After`, and unexpected errors return a sanitized `500`. Wrong password, missing user, OAuth-only user, and disabled account must remain indistinguishable to login callers. Security-filter failures use the same envelope.

The development milestone defines bounded single-instance throttling: 20 login attempts/minute per remote IP, 5 registrations/minute per remote IP, 30 refreshes/minute per remote IP, and 10 login attempts/15 minutes per canonical account key. Forwarded headers are not trusted until a proxy is explicitly configured. Shared multi-replica throttling belongs to the Gateway/Valkey integration gate.

## Transport boundary

This API uses explicit bearer headers and JSON credentials and is directly suitable for native/API clients. Native clients may keep refresh material in Expo SecureStore in the later client milestone.

This contract does not authorize browser refresh-token storage, cookie authentication, CORS policy, CSRF exemptions beyond the bearer/JSON service boundary, or Gateway proxy behavior. Before browser delivery, define and test a secure refresh-cookie or BFF transport, CSRF protection, explicit trusted origins, and the real Gateway route. No Gateway, web, or mobile change is part of this Identity milestone.
