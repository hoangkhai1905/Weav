# Identity M3 Task7 — Google OIDC và web handoff design

> **Trạng thái:** chỉ thiết kế/chuẩn bị contract; chưa triển khai endpoint, dependency, migration hoặc OpenAPI.
>
> **Phạm vi đã được mở:** web-first. Identity phát refresh cookie `HttpOnly`/`Secure` và access token ngắn hạn trong response/memory; native, Gateway/BFF và mobile deferred tới M6.
>
> **Cảnh báo contract:** các route, schema và cookie dưới đây là bản thiết kế để review. Không coi chúng là runtime capability và không thêm chúng vào `packages/contracts/http/auth/openapi.yaml` trước khi có implementation + acceptance tương ứng.

## 1. Mục tiêu, giới hạn và nguồn sự thật

Task7 sẽ bổ sung Google OIDC login và explicit link/unlink trên nền OAuth persistence của Task6, nhưng chỉ sau khi contract này được root review. Thiết kế phải giữ các invariants đã được chốt ở plan `2026-09-06-identity-remaining-endpoints.md`:

- Google là provider duy nhất trong M3; scope chỉ `openid email profile`. Không xin Gmail/Sheets/offline credentials và không lưu Google access/refresh token vào `oauth_accounts`.
- Khóa identity là `(GOOGLE, sub)`, không phải email. V1 unique `(provider, provider_user_id)` và V4 unique `(user_id, provider)` được giữ nguyên.
- Authorization-code flow có state, nonce, provider PKCE S256 và redirect allowlist. Provider verifier của backend tách khỏi handoff verifier của client.
- Callback chỉ tạo one-use handoff; không đặt Weav access token hoặc refresh token vào URL. Handoff consume lỗi là thất bại cuối cùng, không retry mù.
- Existing local email không tự merge/link. Người dùng phải local-login/recovery rồi explicit link bằng current password.
- Mọi mutation protected dùng user-first lock và recheck session/status. Subject race hoặc ownership conflict không xóa/merge row.

Đối chiếu source hiện tại trước khi viết thiết kế:

- `SecurityConfig` đang dùng stateless bearer resource-server và `.csrf(AbstractHttpConfigurer::disable)`; đây là gap cần sửa trong slice transport, không được mở rộng thành cookie auth cho toàn bộ API.
- `/auth/refresh` và `/auth/logout` hiện nhận opaque refresh token trong JSON; `TokenPairResult`/`TokenResponse` luôn chứa refresh token. Contract web mới phải là route riêng hoặc selector được review, không phá JSON/native contract.
- `LoginUseCase`, `RefreshSessionUseCase` và `LogoutUseCase` lock user trước session mutation. `CurrentIdentityGuard.requireActiveSessionForLockedUser` là primitive phải được dùng lại cho link/unlink.
- `OtpChallengeStore`/`ValkeyOtpChallengeStore` đã có pattern atomic consume, TTL, supersede và fingerprint. OAuth store sẽ theo pattern đó, nhưng namespace/record/TTL riêng.
- `User` chưa có credential-version field. Credential fingerprint cho reauth sẽ dùng `KeyedFingerprint` trên password hash snapshot theo pattern `OtpFingerprintPolicy.credential`; không log hoặc lưu password/hash plaintext ngoài dữ liệu hiện hữu.
- `services/identity-service/pom.xml` hiện có OAuth2 resource-server nhưng chưa có OAuth2 Client starter. Dependency và Spring wiring là implementation gate, không được thêm trong session thiết kế này.
- `apps/web` hiện chưa có auth callback route; browser smoke dưới đây là backend/provider acceptance, không phải bằng chứng M6 SPA/Gateway đã hoàn thiện.

## 2. Quyết định transport và registered clients

### 2.1 Chỉ nhận logical IDs, không nhận URL tùy ý

Identity không redirect tới URI lấy trực tiếp từ query/body. Request chỉ được nhận:

```text
clientId       = web
returnTargetId = web
```

Server map cặp này sang một registered-client record gồm provider client registration, callback URI, return URI và allowed origins. Mỗi lookup phải exact-match cả logical ID lẫn URI cấu hình; không wildcard, không nối chuỗi từ input và không tin `Host`/`X-Forwarded-*` cho redirect nếu trusted proxy chưa được cấu hình.

Local proposed values (chưa phải production URL, có thể override bằng config):

```text
provider callback: http://localhost:8081/auth/oauth/google/callback
web return target: http://localhost:5173/auth/callback
web origin:        http://localhost:5173
```

Google yêu cầu `redirect_uri` khớp tuyệt đối với URI đã đăng ký, gồm scheme, case và trailing slash. Production không được dùng các local default; client ID, secret và allowlist phải đến từ secret/config store, không ghi vào repo hoặc log.

Đề xuất tên cấu hình (chỉ là names, không ghi giá trị bí mật):

```text
weav.oauth.google.client-id
weav.oauth.google.client-secret       # secret store only
weav.oauth.google.issuer-uri          # https://accounts.google.com
weav.oauth.google.redirect-uri
weav.oauth.state-ttl                  # exact default: 10m
weav.oauth.handoff-ttl                # exact default: 60s
weav.oauth.csrf-ttl                   # exact default: 10m
weav.oauth.provider-timeout           # exact default: 5s per provider request
weav.oauth.max-handoff-proof-failures # exact default: 5 per handoff
weav.oauth.web.return-target-uri
weav.oauth.web.allowed-origins
weav.oauth.web.cookie-secure          # mandatory true in M3; false is rejected
weav.oauth.web.cookie-same-site       # Lax
weav.oauth.web.refresh-cookie-path   # exact: /auth
weav.oauth.web.correlation-cookie-path # exact: /auth
weav.oauth.web.csrf-cookie-path      # exact: /
weav.oauth.google.allowed-hosted-domains  # optional product access restriction; not required for Google authority
```

No production client ID, secret, domain, Gateway prefix or public callback is invented here.

### 2.2 Cookie policy

Cookies are host-only (no `Domain`). The refresh/correlation cookies are limited to `/auth`; the non-secret CSRF cookie intentionally uses `/` so it is sent on `/users/me/oauth/google/link` and `/users/me/oauth-accounts/*` as well:

| Cookie | Value | Attributes | Purpose |
| --- | --- | --- | --- |
| `__Secure-weav_oauth_tx` | opaque transaction handle | `HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600` | binds provider callback to the browser transaction; never contains provider state or user ID |
| `__Secure-weav_refresh` | opaque rotated refresh token | `HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=<refresh lifetime>` | web refresh only; hash is persisted, raw value never enters JS/JSON |
| `XSRF-TOKEN` | random/signed CSRF value | `Secure; SameSite=Lax; Path=/` (not HttpOnly) | double-submit token for unsafe `/auth` and `/users/me/oauth-*` routes; the value is also returned by the start/CSRF response so a separately-hosted web origin need not read an Identity-host cookie |

The `__Secure-` prefix requires `Secure`. `SameSite=Lax` is deliberate: browser-to-Identity requests are same-site for the registered web origin, while the provider callback is a top-level GET. `/auth` keeps refresh and correlation cookies away from `/users`, `/actuator` and unrelated routes; the XSRF cookie is not an authentication credential and therefore uses `/`. Do not use `Domain` or `SameSite=None` for this M3 web transport.

The proposed HTTP localhost URIs are useful for Google’s local redirect registration, but Secure-cookie behavior is browser-specific for localhost. The deterministic acceptance strategy is local HTTPS with a local certificate; alternatively, a selected browser’s documented localhost behavior may be tested and recorded by observing both `Set-Cookie` attributes and a subsequent cookie-bearing request. If that browser does not persist/send the Secure cookie on HTTP, mark only the cookie gate pending; do not silently change the production default to `cookie-secure=false`.

### 2.3 Exact protocol bounds and rate limits

These are finite implementation defaults, not unbounded suggestions. They must be configuration properties with the following initial values:

| Item | Exact bound/default | Enforcement |
| --- | --- | --- |
| state transaction TTL | `10m` | Valkey expiry; one callback consume |
| handoff proof TTL | `60s` | Valkey expiry; one exchange consume |
| CSRF token TTL | `10m` | Valkey/cookie expiry; rebootstrap through `/auth/web/csrf` |
| provider HTTP timeout | `5s` per discovery/JWK/token request | bounded client timeout; no unbounded callback wait |
| state/nonce/transaction/handoff/CSRF token | exactly `43` unpadded base64url characters (32 random bytes) | reject any other length/charset |
| client handoff `codeChallenge` | exactly `43` unpadded base64url characters | only `S256` accepted |
| provider/client `codeVerifier` | `43..128` RFC 7636 unreserved ASCII characters (`A-Z a-z 0-9 - . _ ~`) | reject `plain`, padding, whitespace and other bytes |
| callback provider `code` | `1..2048` ASCII characters after URL decoding | reject larger/malformed query value |
| provider `sub` | `1..255` case-sensitive ASCII characters | preserve exact subject; no lowercasing |
| provider email | existing Identity policy: `1..254` ASCII characters after canonicalization | nullable on metadata; never use as provider identity |
| logical `clientId`/`returnTargetId` | `1..32` ASCII characters; only registered `web` is accepted in M3 | reject unknown IDs and arbitrary URI values |
| current password | existing policy: `8..72` characters and at most `72` UTF-8 bytes | reuse `AuthInputPolicy`; no trim |
| linked-account metadata list | maximum `20` rows per response | M3 currently permits at most one Google row per user via V4 |
| failed handoff proof attempts | `5` per handoff, then invalidate that handoff only | atomic counter; a wrong proof never deletes an unrelated valid handoff |
| start admission | `10 / 15m / remote IP` | remote IP is not trusted from forwarded headers by default |
| callback admission | `20 / 1m / remote IP` | applies before provider exchange |
| exchange admission | `30 / 1m / remote IP` | applies before handoff lookup |
| link-start admission | `5 / 15m / active session` and `10 / 15m / remote IP` | no account/provider enumeration |
| unlink admission | `5 / 15m / authenticated session` and `10 / 15m / remote IP` | throttle before current-password verification; preserve the account on `429` |
| CSRF bootstrap admission | `30 / 1m / remote IP` | fixed generic `429` with `Retry-After` |

Refresh-cookie `Max-Age` equals the existing finite `weav.jwt.refresh-expires-in` value (current default `7d`); OAuth does not create a second refresh lifetime. Rate-limit counters use keyed transient state and return the existing `RATE_LIMITED` envelope with `Retry-After`.

## 3. Draft routes and schemas (not live)

These are the exact routes proposed for implementation. They remain out of OpenAPI until the implementation slice is reviewed and tested.

### 3.1 Start login

```text
POST /auth/oauth/google/start
```

Request:

```json
{
  "clientId": "web",
  "returnTargetId": "web",
  "codeChallenge": "<exactly 43 unpadded base64url characters>",
  "codeChallengeMethod": "S256"
}
```

Response `200` (no-store):

```json
{
  "transactionId": "<opaque non-secret handle>",
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "csrfToken": "<non-secret double-submit value>"
}
```

The browser generates a high-entropy handoff `code_verifier` of `43..128` RFC 7636 unreserved ASCII characters, derives `codeChallenge = BASE64URL(SHA256(ASCII(code_verifier)))` (therefore exactly 43 unpadded base64url characters), and retains the verifier in `sessionStorage` keyed by the returned transaction ID until exchange. Only the browser holds this raw client verifier; it is submitted once at exchange and is never retained in backend transaction state. The backend separately generates a provider PKCE verifier with the same RFC bounds and sends only its derived S256 challenge to Google. These two verifiers/challenges are never reused or compared across purposes. One active flow per tab is the minimum acceptance; the server still binds every code to its transaction. The response URL is generated from the registered provider config and contains server-generated state, nonce and provider PKCE challenge; the request never supplies those values.

This route is public but must require exact `Origin` and a valid registered client/return target. Because it does not authenticate with an ambient cookie, its pre-auth CSRF policy is `Origin + client handoff PKCE`, not a blanket CSRF exemption for all routes. It sets the HttpOnly transaction cookie and CSRF cookie for the subsequent exchange.

The Google provider client ID/secret is server-only configuration and is distinct from both the backend provider PKCE verifier and the browser handoff verifier. The client secret is used only by the backend token request and is never put in `authorizationUrl`, JSON, cookies, logs, exception details or any `toString`/debug DTO. Provider/client PKCE verifiers, raw state/nonce and credential fingerprints are likewise transient server state; request/response DTOs expose only the bounded logical IDs, challenge, transaction handle, authorization URL and non-secret CSRF value.

### 3.2 Provider callback and handoff redirect

```text
GET /auth/oauth/google/callback?code=<provider-code>&state=<provider-state>
```

Google’s authorization server redirects the browser to this route. The route accepts only the registered provider callback parameters; it does not trust an HTTP caller based on source. The callback atomically compares the supplied state to the server transaction and to `__Secure-weav_oauth_tx`, consumes the state transaction once, exchanges the provider code with the backend-held provider verifier, validates the OIDC ID token, and creates a short-lived handoff record containing the minimal validated provider identity. The identity is carried server-side to the final exchange; no provider token is stored or returned, and LOGIN/LINK database mutation still occurs only after handoff consumption and the final user/session lock checks.

Success is a `303` to the registered web return URI only:

```text
http://localhost:5173/auth/callback?handoff_code=<opaque>&transaction_id=<opaque>
```

`handoff_code` is random, one-use and 60 seconds by default. `transaction_id` is only a lookup key for the browser’s in-memory/sessionStorage verifier; it is not an authorization credential. The provider `code`, provider `state`, Weav access token, Weav refresh token, email, subject and error description never appear in this application return URL. The Identity callback clears the correlation cookie after the provider result is finalized.

Provider denial returns a `303` to the same registered return URI with only a fixed generic value such as `oauth_error=cancelled` and the opaque transaction ID, but only after a valid state/correlation-cookie binding has been atomically checked and consumed. Timeout, malformed response, invalid signature/issuer/audience/nonce/expiry and provider unavailability map to `oauth_error=failed` or `oauth_error=provider_unavailable`; raw provider fields are not reflected. If the state or correlation cookie cannot be resolved, do not redirect and return a generic `400`; an attacker-controlled URI is never used. A sanitized correlation ID may be logged; no code/token/claim is logged.

### 3.3 Handoff exchange and web session cookie

```text
POST /auth/oauth/exchange
```

Request:

```json
{
  "clientId": "web",
  "returnTargetId": "web",
  "transactionId": "<opaque>",
  "handoffCode": "<opaque>",
  "codeVerifier": "<43-128 RFC 7636 unreserved ASCII characters>"
}
```

Successful LOGIN response `200` (no-store) uses an explicit discriminator:

```json
{
  "outcome": "LOGIN",
  "accessToken": "<short-lived JWT>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "...", "email": "...", "emailVerifiedAt": null }
}
```

The LOGIN response deliberately has no `refreshToken` or `refreshExpiresAt` member. It creates exactly one normal Identity session and sets `__Secure-weav_refresh` with the exact attributes in §2.2. A later web refresh rotates the existing session's refresh token; it does not create a second session. The browser keeps only the access token in memory, sends it as a bearer token for API calls, and immediately removes `handoff_code`/`transaction_id` from the address bar with `history.replaceState`.

LINK exchange uses the same request but returns a different, access-free discriminator and never sets or rotates a session cookie:

```json
{
  "outcome": "LINKED",
  "oauthAccount": {
    "id": "...",
    "provider": "GOOGLE",
    "providerEmail": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

`providerUserId`, password, credential fingerprint, access token and refresh token are not returned. LINK success is `200`; it keeps the initiating bearer session and does not mint a new session or cookie.

Exchange requires exact `Origin`, registered IDs, matching transaction and `S256(codeVerifier) == stored codeChallenge`, plus `X-XSRF-TOKEN` equal to the server-issued `XSRF-TOKEN` cookie/value. The store atomically validates the requested handoff’s code fingerprint, transaction ID, intent, client ID, return target and S256 proof before deleting that same handoff; a wrong binding/proof increments only that handoff’s bounded failure counter and cannot consume another valid handoff. Once consumed, no account/session mutation occurs until the relevant database transaction acquires the user lock and rechecks status/session/credential binding. Missing, expired, mismatched or already-consumed handoffs return `401 OAUTH_HANDOFF_INVALID` and never issue a cookie. If the database transaction fails after consumption, the browser starts a new Google flow; the handoff is not restored.

The request shape intentionally has no client-controlled `intent` member. Until a transport controller is added, the coordinator exposes separate trusted `exchangeLogin` and `exchangeLink` entry points. The future same-endpoint HTTP dispatcher uses one explicit convention: a LOGIN exchange is sent without an `Authorization` header, while a LINK exchange carries the currently authenticated bearer and invokes LINK with the identity resolved by the security context. A browser that starts LOGIN while already signed in must deliberately suppress its ambient bearer attachment for this request. Bearer presence only chooses the already-defined coordinator entry point; it is never sufficient to authorize linking, because the consumed handoff intent, initiating user/session IDs and current credential fingerprint must still match. The dispatcher must not probe both entry points: a wrong-intent consume is a bounded proof failure and must not be used as intent discovery.

When the validated Google subject has a local email account but is not linked, exchange returns `409` with generic `ACCOUNT_LINK_REQUIRED` and no user/email enumeration. It does not create an OAuth row or session. A linked or newly-created user receives the access-only response above.

### 3.4 CSRF token and separate web refresh/logout routes

The direct cross-origin web client must not depend on reading a host-only Identity cookie. The start response above returns the XSRF value in the response body after setting the matching cookie. After a page reload, the client may call:

```text
GET /auth/web/csrf
```

with the exact registered `Origin` and `credentials: include`; it returns `200 { "csrfToken": "<non-secret>" }` and sets/refreshes `XSRF-TOKEN`. This is a safe token bootstrap route, not an authentication or session-proof route. The client keeps the value in memory and sends it as `X-XSRF-TOKEN` on the unsafe cookie routes below. A later BFF may make this same-origin, but must not make the refresh cookie readable by JavaScript.

To preserve the existing JSON/native contract exactly, the web cookie transport uses separate routes:

```text
POST /auth/web/refresh
POST /auth/web/logout
```

Both require `Origin` exact-match, `XSRF-TOKEN` cookie plus matching `X-XSRF-TOKEN` header, and the HttpOnly refresh cookie. Refresh uses the existing user-first/session-first rotation semantics, returns the same access-only shape as exchange, rotates the cookie and never returns the replacement refresh value in JSON. Logout is idempotent for a validly formatted cookie, revokes its session under the existing user-first lock and clears the cookie with the same name/path/attributes. Missing or malformed CSRF/origin fails closed and does not mutate a session.

The existing `POST /auth/refresh` and `POST /auth/logout` continue to require their current JSON `refreshToken` body and remain suitable for native/core clients. No route may silently accept both ambient cookie and JSON refresh credentials without a reviewed transport selector.

### 3.5 Explicit link and unlink

Start link from an authenticated local session:

```text
POST /users/me/oauth/google/link
```

Request:

```json
{
  "currentPassword": "<local password>",
  "clientId": "web",
  "returnTargetId": "web",
  "codeChallenge": "<S256 challenge>",
  "codeChallengeMethod": "S256"
}
```

The response is `200` with the same `{transactionId, authorizationUrl, csrfToken}` shape as login. The endpoint requires a bearer access token, active matching session, exact Origin/CSRF policy and current local password. The transaction stores user ID, session ID and the credential fingerprint captured after password verification. The link callback rechecks the active user/session and credential fingerprint before issuing a handoff; the exchange rechecks them again under the user lock after atomically consuming the matching LINK handoff and before inserting the account. A password change, reset, logout/revoke, disable or session mismatch produces generic `401 UNAUTHORIZED`, no OAuth mutation and no new session/cookie. The correlation cookie is set by this `/users` response with `Path=/auth`, so the browser sends it when Google redirects to the `/auth/oauth/google/callback` route; the XSRF cookie uses `Path=/` and is sent to both routes.

Read linked-account metadata with the existing self-only route:

```text
GET /users/me/oauth-accounts
```

Response `200` is a bounded list of safe metadata only (`providerEmail` may be null):

```json
[
  {
    "id": "...",
    "provider": "GOOGLE",
    "providerEmail": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

It never returns `providerUserId`/`sub`, provider tokens, refresh material or password data.

Unlink keeps the approved route and uses a validated JSON body:

```text
DELETE /users/me/oauth-accounts/{accountId}
```

Request `{ "currentPassword": "<local password>" }`; response `204`. After authenticating the active session and acquiring the user-first lock, evaluate the last-usable-login-method guard before rejecting a missing or invalid local password. Thus an OAuth-only account whose removal would leave no login method receives `409 OAUTH_LAST_LOGIN_METHOD` (without password enumeration); only when the guard passes does the local-password path require and validate `currentPassword`. The operation returns a safe `404` for a missing/non-owned account and otherwise leaves the current local session active. Successful link/unlink does not mint an extra session or return a refresh token; a new Google login creates one normal session using the existing session/token issuance rules.

## 4. Valkey transaction state and replay rules

Add an application output port (name to be finalized during implementation) equivalent to `OAuthTransactionStore`; it must not expose Redis/Spring types. Records are opaque and namespaced separately from OTP state:

```text
oauth:tx:<transaction-id>
oauth:handoff:<handoff-fingerprint>
```

The transaction record contains only the minimum protocol binding:

```text
intent = LOGIN | LINK
clientId, returnTargetId
providerStateFingerprint
nonceFingerprint
providerCodeVerifier        # transient server-only value, never logged
handoffCodeChallenge        # S256 challenge only
userId, sessionId            # LINK only; never client supplied
credentialFingerprint        # LINK only
status = OPEN | CALLBACK_CONSUMED | FAILED
```

The handoff record contains transaction/intent, the local LINK binding when applicable, the client challenge and a required `providerIdentity` value, with TTL 60 seconds. `providerIdentity` is the immutable validated tuple `{provider, providerSubject, providerEmail?, emailVerified, hostedDomain?}` returned by the provider port; `providerSubject` is 1..255 printable ASCII and the value contains no provider access/refresh credentials. A separate `consumeHandoff` operation must atomically validate the requested handoff’s fingerprint, transaction ID, intent, `clientId`, `returnTargetId` and S256 verifier binding before deleting that same key; concurrent exchanges have exactly one consumer. A key that does not exist or whose code fingerprint is unknown is not allowed to affect any other key. A known handoff with a wrong transaction/client/target/verifier increments only its own failure counter; after five failures that same handoff is invalidated. Until then, the valid handoff remains available to the correct binding. The Valkey adapter must persist and return this provider identity in both LOGIN and LINK consumed outcomes before the final exchange mutation.

State callback consumption is also atomic and one-use: compare state fingerprint, transaction cookie handle, registered provider/client binding and `OPEN` status in one Valkey operation, then mark/consume only the matched transaction. A mismatched state or cookie does not consume a valid transaction and cannot produce a redirect. A provider cancellation or provider failure consumes the correctly bound state before returning the fixed safe error redirect, so an attacker cannot retry the same transaction with a different code. TTL tests use deterministic clock/TTL inspection rather than sleeps.

Use domain-separated keyed fingerprints for state, nonce, handoff code and credential binding. Raw state, nonce and provider `code_challenge` legitimately appear in the generated Google authorization URL; provider `code` and `state` legitimately arrive in the inbound callback query. They must never be logged, copied into the final application return URL, included in exception details or written to test output. The provider verifier exists only in the backend transaction and token request. The short-lived handoff code is intentionally placed in the registered application return URL, then removed by the browser immediately after exchange.

## 5. Provider validation and account policy

### 5.1 Spring/Google integration boundary

Use Spring Security OAuth2 Client/OIDC primitives for client registration, authorization request construction, code exchange and signed ID-token/JWK validation; do not hand-roll JWT signature/JWK parsing. The custom Identity routes may use the supported Spring resolver/client components behind `GoogleOidcAdapter`, but must retain the server-side handoff and transaction binding above. Spring’s documented defaults are `/oauth2/authorization/{registrationId}` and `/login/oauth2/code/*`; if those are not used, the custom authorization/redirection base URIs and `ClientRegistration.redirectUri` must be configured together. The proposed `/auth/oauth/google/*` routes therefore require an explicit adapter/controller integration test rather than an assumption that Spring defaults will intercept them.

Validated ID-token properties:

1. Signature and algorithm are accepted only through the configured Google discovery/JWK metadata.
2. `iss` matches the configured issuer; accept Google’s documented legacy `accounts.google.com` spelling only as an equivalent issuer, never an arbitrary issuer.
3. `aud` contains the registered Google client ID; when `aud` has multiple values, `azp` is mandatory and must match the registered client ID. A single-audience token may omit `azp`, but any supplied `azp` must match the registered client ID; missing or invalid `azp` is rejected for multi-audience tokens.
4. `exp` is in the future within the configured clock skew, `iat` is sane, and the ID-token `nonce` matches the one-use transaction nonce.
5. `sub` is nonblank and case-sensitive; it is the only provider identity key.
6. `email_verified` and email presence are evaluated by the policy below. `picture` is display-only and never copied to `avatarStorageKey`.

The adapter must not request `access_type=offline` and must not persist Google tokens. Provider HTTP timeout, non-2xx token response, malformed claims, JWK failure and discovery failure become sanitized dependency/provider errors with no account mutation.

### 5.2 Email authority

- Existing linked `(GOOGLE, sub)` login does not overwrite the local email or `emailVerifiedAt`; a valid subject may continue even if the provider omits email on a later token.
- A new unlinked Google account requires a nonblank email and `email_verified=true`; missing/false email verification fails without creating a user.
- A Google email is an authority for local `emailVerifiedAt` when the signed token has `email_verified=true` and either the canonical address is `@gmail.com` or a valid Google Workspace/Cloud organization `hd` claim is present. An optional `allowed-hosted-domains` list is a separate product access restriction: when configured it must exact-match `hd`; when absent it does not negate Google’s signed `hd`-based authority.
- A verified third-party Google email may create a user with `emailVerifiedAt=null`; it must use the existing OTP path. It never silently verifies a local email.
- Explicit link may set a previously-null local `emailVerifiedAt` only when the provider email is authoritative and canonicalized provider email exactly equals the locked user email. A different provider email never rewrites or verifies the local address.
- No Workspace domain is invented or required as a release gate in this plan. Product-specific hosted-domain restriction is optional configuration and must not be conflated with validating Google’s signed `hd` claim.

### 5.3 Login, link and race outcomes

| Situation | Result | Persistence/session guarantee |
| --- | --- | --- |
| Subject already linked to active user | normal Google login | lock/re-read user, create one normal session; no email overwrite |
| Subject already linked to disabled user | generic authentication failure | no session/token/cookie |
| Subject unknown, provider email has no local user | create `USER/ACTIVE`, `passwordHash=null`, OAuth row and session in one DB transaction | all IDs/timestamps generated once; V1/V4 uniqueness remains authoritative |
| Subject unknown, canonical email belongs to local user | `ACCOUNT_LINK_REQUIRED` handoff result | no auto-link, no OAuth row, no session |
| Subject belongs to another user during link | `409` conflict | preserve both users/rows; no reassignment |
| Same subject link races | one DB winner; loser maps unique conflict to safe `409`/already-linked result | no delete/merge; reload only after rollback-safe boundary |
| New Google login races local registration | canonical-email/provider-sub constraints decide; loser becomes conflict/link-required | no blind merge or row removal |
| Link after password/session change, logout/revoke or disable | generic auth/intent failure | no OAuth row or session mutation |
| Unlink sole OAuth method/no local password | `409` | existing OAuth account/session untouched |

User-first lock protocol for link/unlink and any existing-user login mutation:

1. Resolve provider subject with the unique repository lookup; never trust a client user ID.
2. Acquire `UserRepository.findByIdForUpdate` for the candidate/intent user before re-reading mutable user/session state.
3. Recheck `ACTIVE`, session ownership/activity and (for link/unlink) `credentialFingerprint = HMAC(namespace, passwordHash)`. Use `CurrentIdentityGuard.requireActiveSessionForLockedUser` while the lock is held.
4. Re-read provider ownership under the same transaction, perform the bounded mutation, then issue/revoke session material only after the database state is valid.
5. Map unique-constraint races to safe conflict outcomes. Do not catch a failed insert and delete/merge an existing account.

For a new user there is no existing user lock; create user, OAuth row and session in one transaction and let canonical-email/provider-sub constraints reject races. Any retry must be a fresh application decision after rollback, not a replay of consumed provider/handoff state.

## 6. Web CSRF, Origin and CORS contract

The current global CSRF disable cannot remain the web transport policy. The implementation must introduce route-specific enforcement:

- `POST /auth/oauth/google/start`: exact registered `Origin` and handoff PKCE challenge; no ambient authentication cookie is accepted. No arbitrary return URI.
- Provider callback: top-level GET; no CSRF token, but state + HttpOnly transaction cookie + provider PKCE + nonce are mandatory.
- `GET /auth/web/csrf` may bootstrap/rehydrate a non-secret XSRF value for a separately-hosted web origin; it does not authenticate or mutate a session. `POST /auth/oauth/exchange`, `/auth/web/refresh`, `/auth/web/logout` and link/unlink require exact allowed `Origin`, `XSRF-TOKEN`/`X-XSRF-TOKEN` double-submit match and registered logical client. Missing Origin is rejected for browser cookie routes; provider callback is the only navigation exception.
- Existing bearer/JSON core routes retain their current explicit transport and behavior; do not start accepting refresh cookies there merely because a cookie exists.
- CORS allows only configured web origins, exact methods/headers and `Access-Control-Allow-Credentials: true`; never `*` with credentials. Preflight must be handled before authentication filters as required by Spring Security’s CORS integration.
- Error responses are the existing sanitized envelope with `Cache-Control: no-store` where tokens or handoff outcomes are involved. No provider detail, password, token, cookie or raw redirect is reflected.

The implementation can use Spring’s `CookieCsrfTokenRepository`/equivalent route matcher for the XSRF cookie and a dedicated `Origin` policy component. It must test both missing/incorrect token and missing/incorrect origin. Do not claim that SameSite alone replaces CSRF protection.

### 6.1 Exact status/error mapping

All JSON failures keep the existing `ApiErrorResponse` outer shape:

```json
{
  "error": { "code": "...", "message": "...", "details": [] },
  "timestamp": "...",
  "status": 409,
  "path": "/..."
}
```

OAuth adds stable domain error codes inside the existing envelope; it does not add a second response format or expose claims/secrets:

| Situation | HTTP | `error.code` | Public message/redirect behavior |
| --- | ---: | --- | --- |
| malformed body, wrong length/charset, unsupported method | 400 | `VALIDATION_ERROR` | existing validation message; field details contain no secret values |
| unknown logical client/return target or arbitrary redirect | 400 | `INVALID_OAUTH_CLIENT` | generic JSON; never redirect |
| callback state/correlation/nonce/provider-protocol failure with no valid safe redirect | 400 | `OAUTH_CALLBACK_INVALID` | generic JSON; no attacker-controlled redirect |
| missing/wrong Origin or XSRF cookie/header | 403 | `FORBIDDEN` | existing generic forbidden message |
| missing/expired/consumed handoff, wrong code verifier or binding | 401 | `OAUTH_HANDOFF_INVALID` | generic authentication failure; no cookie/session |
| link intent session/password fingerprint no longer valid | 401 | `UNAUTHORIZED` | generic authentication failure; no OAuth mutation |
| disabled user or inactive/revoked session at login/link exchange | 401 | `UNAUTHORIZED` | generic authentication failure; no token/cookie |
| validated subject belongs to another user or unique race | 409 | `OAUTH_ACCOUNT_CONFLICT` | generic conflict; preserve all rows |
| same user already has the provider account | 409 | `OAUTH_ALREADY_LINKED` | generic conflict; no second row/session |
| local email exists but provider subject is unlinked | 409 | `ACCOUNT_LINK_REQUIRED` | generic message only; no email/user enumeration |
| unlink would remove the last usable login method | 409 | `OAUTH_LAST_LOGIN_METHOD` | generic conflict; account/session unchanged |
| bounded start/callback/exchange/link/CSRF admission exceeded | 429 | `RATE_LIMITED` | existing envelope plus exact `Retry-After` seconds |
| Valkey, discovery/JWK or provider token dependency unavailable | 503 | `DEPENDENCY_UNAVAILABLE` | callback with a valid state uses fixed `oauth_error=provider_unavailable`; no raw provider detail |

Successful outcomes are exact: `GET /auth/web/csrf` and `GET /users/me/oauth-accounts` return `200`; LOGIN and LINK exchange return `200` with the discriminator schemas in §3.3; unlink and web logout return `204`; cancellation is a safe `303` only after a valid state/correlation binding. The envelope’s `timestamp`/`path` remain generated by the existing handler and must not carry provider values.

## 7. Bounded implementation slices and ownership

No slice below is authorized by this design document alone; root review opens one slice at a time. Existing symbols require fresh GitNexus upstream impact immediately before editing. UNKNOWN remains unresolved and must be corroborated by targeted source inspection; HIGH/CRITICAL must be reported before edits.

| Slice | Worker-owned files | Root/shared review ownership | Acceptance gate |
| --- | --- | --- | --- |
| A. Contract/config ports | new OAuth application DTOs, `OAuthTransactionStore` port, provider adapter port, `OAuthProperties` and registered-client value objects | `pom.xml`, `IdentityApplicationConfig`, public contract/OpenAPI | exact IDs/allowlists; no secret values; architecture test |
| B. Provider + Valkey state | `infrastructure/security/oauth/GoogleOidcAdapter.java`, `ValkeyOAuthTransactionStore.java` and focused tests | Redis client/dependency choice and config wiring | real provider-stub code/nonce/PKCE validation; Valkey atomic one-use/TTL |
| C. Account use cases | `CompleteGoogleLoginUseCase.java`, `LinkGoogleAccountUseCase.java`, `UnlinkOAuthAccountUseCase.java` and unit/concurrency tests | shared session/token issuance extraction if needed | Postgres user-first locks, subject/email races, session/link/unlink outcomes |
| D. HTTP web transport | `presentation/http/OAuthController.java`, `OAuthAccountController.java`, request/response DTOs, `GoogleOAuthHttpIntegrationTest.java` | `SecurityConfig`, CORS/CSRF wiring, existing `AuthController` only if additive | real HTTP with Postgres + Valkey + provider stub; cookie/Origin/CSRF/no-token-URL assertions |
| E. Real provider gate | no committed credentials or `.env` changes; temporary local browser harness only | user-provided Google test client registration and review | system-browser Google callback → handoff → exchange → `/users/me` → web refresh/logout |

Avoid modifying `User`, core auth DTOs or existing JSON routes unless a focused impact review proves a shared extraction is necessary. If a common session issuer is extracted, preserve the current `TokenPairResult` semantics and test all core auth regressions before merging the OAuth slice.

## 8. Test and acceptance design

### 8.1 Deterministic provider-stub tests

`GoogleOAuthHttpIntegrationTest` should use Testcontainers PostgreSQL plus Valkey and a local provider stub (JDK HTTP server or an already-approved test dependency; do not install a new dependency just for this design). The stub must issue controlled authorization responses and signed ID tokens/JWK metadata without using real credentials.

Required focused assertions:

- start rejects unknown `clientId`, `returnTargetId`, origin, challenge method/length/charset and arbitrary redirect; the handoff challenge is exactly 43 unpadded base64url characters; emitted Google URL contains `state`, `nonce`, provider S256 challenge and only `openid email profile`.
- callback rejects unknown/mismatched/reused state, missing/mismatched browser transaction cookie, provider cancellation, timeout, invalid issuer/audience/azp/signature/nonce/exp and missing-email new-user response; no row/session/cookie is created on failure.
- provider subject exact case is preserved; an existing subject can log in without provider-email overwrite.
- new authoritative Gmail/Workspace `hd` user gets `emailVerifiedAt`; an optional configured hosted-domain restriction is tested separately; verified third-party email remains null; different-email link never verifies local email; matching authoritative link may verify it.
- existing local email returns generic `ACCOUNT_LINK_REQUIRED`, creates no OAuth row/session, and does not disclose the local email in redirect or response.
- handoff exchange atomically validates matching transaction/intent/client/return target and S256 verifier before consuming only that same handoff; wrong binding/proof does not consume an unrelated valid handoff, and the fifth wrong proof invalidates only the attempted handoff. Two concurrent consumes have one success.
- LOGIN exchange returns `outcome=LOGIN`, access/user only and one refresh cookie; LINK exchange returns `outcome=LINKED` metadata only and no session/cookie. `Location`, body, logs and exception strings contain no refresh token, provider token, provider code, email enumeration or raw cookie.
- web refresh rotates exactly one cookie/session under concurrent requests; web logout is idempotent and clears the same cookie attributes. Existing JSON `/auth/refresh` and `/auth/logout` tests remain green.
- link start returns `{transactionId, authorizationUrl, csrfToken}` and requires current password/active matching session; callback and exchange both recheck the session/fingerprint. Password change, session revoke/logout or disable between callback/exchange fails without OAuth mutation. Subject ownership races produce one winner and safe conflict; no account reassignment.
- `GET /users/me/oauth-accounts` exposes only safe metadata; `DELETE /users/me/oauth-accounts/{accountId}` requires validated current password and refuses removal of the last login method; successful unlink keeps the current authenticated session and does not mint a session.
- origin/CSRF/CORS matrix covers missing/wrong origin, XSRF `Path=/` delivery to both `/auth` and `/users/me/oauth-*`, missing/wrong XSRF header, wildcard-origin rejection and preflight. Bearer core routes remain unaffected.

Valkey-specific tests should inspect TTL and use atomic synchronization/barriers, not sleeps. PostgreSQL tests must verify canonical email and both provider-sub/user-provider constraints under concurrent operations. No Neon mutation belongs in this slice.

### 8.2 Real Google system-browser smoke

This is a narrow backend/provider gate, not a claim that the Vite app, Gateway or M6 client is complete:

1. Configure a Google test web client in the local secret store with the exact callback URI currently selected. Do not paste or record the client secret.
2. Run Identity and a temporary local callback page/harness at the registered web return target. For the Secure-cookie gate, use local HTTPS overrides for both Identity and return origins; if using the proposed HTTP defaults, record that only provider callback/handoff/access was verified.
3. Use a real system browser account to start Google login, approve or deny, observe the callback’s handoff-only redirect, exchange once, call `/users/me` with the in-memory access token, refresh through the cookie route, then logout and verify the cookie/session is unusable.
4. Record only sanitized statuses, route names, cookie attribute names and pass/fail. Never save provider codes, ID tokens, access/refresh tokens, cookies, email addresses or screenshots containing them.
5. If registration, credentials, TLS or a test account is unavailable, mark the provider gate **pending**, not passed. Provider-stub tests do not substitute for this gate.

Complete Playwright/Vite auth route verification, Gateway prefixes/trusted proxy behavior and mobile/native SecureStore/deep-link acceptance remain M6.

## 9. Review gates and genuine blockers

Before Task7 implementation, root must review the remaining gates and preserve this selected transport decision:

- use separate `/auth/web/refresh` and `/auth/web/logout` routes, preserving the published JSON contract;
- whether local smoke uses HTTPS overrides or a documented verified localhost-browser behavior to make `Secure` cookies verifiable while keeping the proposed HTTP callback/return defaults available for Google registration;
- the configured Google test client ID/secret location and exact callback/return/origin allowlists (values remain outside repo/chat);
- optional product-specific Google Workspace hosted-domain restrictions, kept distinct from validating the signed `hd` claim;
- the Spring OAuth2 Client adapter approach and any dependency/version change after impact review;
- the final error envelope/status mapping for provider cancellation, account-link-required and consumed-handoff failures.

Current blockers are configuration/review gates, not source failures:

1. No Google test client registration or credentials are available in this worktree; real provider acceptance is pending. This does not block the bounded Slice A port/config design.
2. The exact local browser method for proving `Secure` cookie persistence is pending: use local TLS as the deterministic path, or record verified localhost behavior for the selected browser. This is a real-smoke gate, not a Slice A blocker.
3. `apps/web` has no auth callback route, and Gateway/native transport is intentionally deferred to M6; do not claim end-to-end client integration from Identity tests.
4. OAuth2 Client dependency and custom Spring callback wiring are not present; implementation must add them only after this contract and impact review.

## 10. Verified primary references

- [Google OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference) — canonical `iss`, stable case-sensitive `sub`, `aud`, `exp`, `nonce`, `email_verified` and `hd` claims; email is not a stable primary key.
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) — confidential server flow, exact redirect URI matching, state/CSRF checking, local redirect registration and redirect-away from pages containing provider codes.
- [Spring Security authorization grant support](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html) — authorization-code client, PKCE conditions and URI template/redirect configuration.
- [Spring Security OAuth2 Login advanced configuration](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/advanced.html) — documented default/custom authorization and redirection base URIs and the requirement that `ClientRegistration.redirectUri` match.
- [Spring Security CSRF reference](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html) — route CSRF processing, cookie/header repository option and failure behavior.
- [Spring Security CORS integration](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html) — CORS before security preflight and explicit configuration source/allowed origins.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — ID-token signature/nonce validation and replay protection requirements.
- [RFC 7636 PKCE](https://datatracker.ietf.org/doc/html/rfc7636) — verifier entropy/length and mandatory S256 transformation.

## 11. Handoff checklist

- [ ] Root approves the draft route/schema and separate web cookie routes.
- [ ] Root approves local HTTPS strategy or marks HTTP smoke as cookie-unverified.
- [ ] Root supplies/locates (without pasting) the Google test registration and configured allowlists.
- [ ] Implementation worker runs fresh GitNexus impact before each existing-symbol edit and reports HIGH/CRITICAL before editing.
- [ ] No live OpenAPI entry is added until the implementation slice and HTTP tests pass.
- [ ] Real PostgreSQL/Valkey provider-stub tests pass before the system-browser gate.
- [ ] Real Google browser callback + handoff + `/users/me` + cookie refresh/logout is separately recorded; no provider secrets or tokens enter the log.
