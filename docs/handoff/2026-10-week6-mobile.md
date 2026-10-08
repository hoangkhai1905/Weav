## A. Mobile Google sign-in (W6-D1)

Backend is ready (identity-service + API Gateway). Nothing in `apps/mobile` was changed. This section is what the app must do. Design: the server runs the whole Google flow with PKCE; the app only opens a browser, catches a deep link and exchanges a one-time code for a normal session.

### A.1 Prerequisites

| What | Detail |
| --- | --- |
| Identity must have mobile enabled | Env `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback` on identity (empty = disabled; both mobile routes then answer `503 DEPENDENCY_UNAVAILABLE`). Set by K, not by you. |
| New app config `EXPO_PUBLIC_IDENTITY_URL` | The PUBLIC base URL of identity-service (browser leg), e.g. `https://<tunnel>.trycloudflare.com` in dev. The exchange does NOT use it: it goes through the gateway (`EXPO_PUBLIC_API_BASE_URL`). |
| Deep-link scheme `weav` | `apps/mobile/app.json` has `"scheme": "mobile"` today. Add `weav` (`"scheme": ["mobile", "weav"]` or replace it). This is a native config change: it needs a native rebuild (`expo prebuild` / a new dev client or EAS build), an OTA update is not enough. |
| PKCE helpers | `expo-crypto` is NOT installed. Add it (it also needs the rebuild) for random bytes and SHA-256, or any SHA-256 you prefer. `expo-web-browser`, `expo-linking`, `expo-secure-store` are already installed. No `expo-auth-session` needed. |
| HTTPS identity on a device | The correlation cookie that ties the Google callback to the start request is `Secure`. The system browser drops it over plain `http://` unless the host is `localhost`. A phone or emulator reaching a LAN IP / `10.0.2.2` over http will fail at the callback with `400 OAUTH_CALLBACK_INVALID`. Use an HTTPS tunnel to identity (`cloudflared tunnel --url http://localhost:8081`). The coordinator then sets `GOOGLE_REDIRECT_URI=https://<tunnel>/auth/oauth/google/callback` on identity and registers that exact URI in Google Cloud Console (same OAuth client as the web). |

### A.2 Flow

```
App                         System browser            Identity (public URL)          Google          Gateway
 | make verifier+challenge       |                          |                          |                |
 | openAuthSessionAsync(startUrl, 'weav://auth/callback') -->|                          |                |
 |                               | GET /auth/oauth/google/mobile/start?... ----------->|                |
 |                               |<-- 303 to Google + Set-Cookie __Secure-weav_oauth_tx|                |
 |                               |------------------------ user signs in ------------->|                |
 |                               | GET /auth/oauth/google/callback?code&state (cookie) |                |
 |                               |<-- 303 weav://auth/callback?transaction_id=..&handoff_code=..        |
 |<-- result.url (deep link) ----|                          |                          |                |
 | POST /api/auth/oauth/mobile/exchange {transactionId, handoffCode, codeVerifier} ------------------->|
 |<-- 200 {accessToken, refreshToken, tokenType, expiresIn, refreshExpiresAt, user} --------------------|
```

### A.3 Step by step

1. **PKCE.** Generate a `codeVerifier`: 43..128 characters from `A-Z a-z 0-9 - . _ ~` (for example 32 random bytes, base64url, no padding = 43 chars). Keep it in memory only. `codeChallenge = base64url(SHA-256(codeVerifier))` with no padding, always exactly 43 characters. Method is always `S256`.
2. **Open the browser** (do not use `fetch` for this leg; the cookie must land in the browser that later receives Google's callback):
   ```ts
   const startUrl =
     `${IDENTITY_URL}/auth/oauth/google/mobile/start` +
     `?codeChallenge=${codeChallenge}&codeChallengeMethod=S256`;
   const result = await WebBrowser.openAuthSessionAsync(startUrl, 'weav://auth/callback');
   ```
3. **Read the result.** `result.type === 'success'` carries `result.url`. Any other type (`cancel`, `dismiss`, `locked`) means the user left: show nothing or a neutral message and stay on the login screen. Parse `result.url` (for example `Linking.parse`):

   | Query parameter | Meaning |
   | --- | --- |
   | `transaction_id` + `handoff_code` | Success: continue to step 4. Both are 43 base64url characters. Always present together. |
   | `transaction_id` + `oauth_error=cancelled` | The user cancelled on Google's consent screen. Not an error banner; return to login. |
   | `transaction_id` + `oauth_error=provider_unavailable` | Google or the token exchange failed. Show "Google sign-in is unavailable, try again". |

   If the browser shows a JSON error page instead of redirecting (callback with missing/expired cookie or `state`, `400 OAUTH_CALLBACK_INVALID`), the auth session never returns a `success` URL; treat `cancel`/`dismiss` the same way and let the user retry. A new attempt always starts at step 1 with a NEW verifier.
4. **Exchange through the gateway** (public route, no `Authorization` header, no cookies, no CSRF):
   ```
   POST {EXPO_PUBLIC_API_BASE_URL}/api/auth/oauth/mobile/exchange
   Content-Type: application/json

   { "transactionId": "<transaction_id>", "handoffCode": "<handoff_code>", "codeVerifier": "<verifier from step 1>" }
   ```
   Body is strict: exactly these three fields (an extra field, a wrong length or a character outside the alphabets gives `400`). `transactionId` and `handoffCode` are 43 chars of `A-Za-z0-9_-`; `codeVerifier` is 43..128 chars of `A-Za-z0-9._~-`.

   `200` response, the SAME shape as `POST /api/auth/login` (`TokenResponse`):
   ```json
   {
     "accessToken": "<jwt>",
     "refreshToken": "<opaque 43 chars>",
     "tokenType": "Bearer",
     "expiresIn": 900,
     "refreshExpiresAt": "2026-10-15T08:00:00Z",
     "user": { "id": "<uuid>", "email": "person@gmail.com", "displayName": "Person", "...": "same fields as login" }
   }
   ```
   Tokens are in the BODY only; the response sets no cookies. Store them exactly like the password login does (`http-auth.repository.ts`: tokens into `useAuthStore`, refresh token into SecureStore) and refresh with the existing `POST /api/auth/refresh`. Do not log tokens, the verifier or the handoff code.
5. **One shot.** The handoff code is single use and lives 60 seconds. Exchange right after the deep link arrives. A wrong verifier counts as a failure (5 failures burn the handoff); a successful exchange or a reuse of the same code gives `401`. Do not retry an exchange automatically; on failure go back to step 1.

### A.4 Errors

**Branch on the HTTP status first**, then (optionally) on `error.code`. The exchange goes through the gateway, so the same status can carry a gateway code or an identity code. Body shape for both: `{ "error": { "code": "...", "message": "...", "details": [] }, "status": <http>, "requestId": "..." }` (identity's body may omit `requestId`).

| HTTP | Gateway code (before/instead of identity) | Identity code (relayed unchanged) | Meaning and what the app should show |
| --- | --- | --- | --- |
| 400 | `BAD_REQUEST` (body is not a JSON object or fails the strict schema: extra field, wrong length or alphabet) | `VALIDATION_ERROR` / `MISSING_PARAMETER` (mobile/start query, or exchange body) | App bug (challenge not 43 base64url chars, method not exactly `S256`, malformed body). Do not retry; log without the secret values. |
| 401 | none | `OAUTH_HANDOFF_INVALID` | Wrong verifier, expired (60 s), already used, 5 failures reached, or the code belongs to another client (a web handoff). Restart the flow with a new verifier. |
| 401 | none | `UNAUTHORIZED` | The Google account may not sign in (account disabled, or Google did not verify the email). Generic message. |
| 409 | none | `ACCOUNT_LINK_REQUIRED` | An account with this email already exists with a password. Show "sign in with your password, then link Google from the web app". Google linking stays web-only. The handoff is spent. |
| 409 | none | `CONFLICT` | A concurrent sign-in created the same Google account; restart the flow. |
| 429 | `TOO_MANY_REQUESTS` (gateway throttling, shared public-auth bucket per IP) | `RATE_LIMITED` (identity, +`Retry-After`) | Too many attempts from this IP. Wait for `Retry-After` and retry manually. |
| 503 | `SERVICE_UNAVAILABLE` (identity unreachable / timed out) | `DEPENDENCY_UNAVAILABLE` (mobile sign-in disabled on the server, or Valkey/Google down) | Offer password login; try again later. |

For the browser leg (`mobile/start`) only identity answers, and the browser shows its JSON body; the app just sees the auth session end without a `success` URL (treat as cancel).

### A.4b Rate limits and proxies (for K / deployment)
- Both identity and gateway key their limits on the client IP. Identity trusts `X-Forwarded-For` only from the gateway, so the browser legs (`mobile/start`, `callback`) that reach identity directly through a tunnel or reverse proxy (cloudflared, Caddy) all appear as the proxy's IP: they share ONE bucket per proxy IP. `OAUTH_START_IP` is 10 per 15 minutes and is shared with the web start (`POST /auth/oauth/google/start`), so a busy demo can hit `429` on sign-in.
- Deployment: set `GATEWAY_TRUST_PROXY_HOPS` to match the proxy chain in front of the gateway, and add the public reverse proxy to identity's trusted-proxy pattern, otherwise every user looks like one IP.

### A.5 Account rules (same as web Google login)
- A Google account already linked to a user signs that user in. A new Google account with a verified email and no existing user creates a user without a password (`displayName` from Google); an existing email gives `409 ACCOUNT_LINK_REQUIRED`.
- Scopes are only `openid email profile`. Linking and unlinking Google accounts is not available on mobile.

### A.6 How to test
1. K: identity running with `GOOGLE_CLIENT_ID/SECRET`, `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback`, an HTTPS tunnel to identity and `GOOGLE_REDIRECT_URI` set and registered to the tunnel callback; gateway running.
2. App: `EXPO_PUBLIC_IDENTITY_URL=https://<tunnel>`; rebuilt dev client with the `weav` scheme.
3. Tap "Sign in with Google": the system sheet opens, Google consent shows, the sheet closes by itself, the app lands signed in. Expect exactly one `POST /api/auth/oauth/mobile/exchange` in the gateway log with status 200.
4. Negative checks: cancel on the consent screen (back to login, no banner); close the sheet manually; call the exchange twice (second is `401 OAUTH_HANDOFF_INVALID`).
