# Design: asymmetric access-token signing (ID-6 / GW-3 / WS-15 / X-8)

Status: proposed, not implemented. Source: `docs/reviews/2026-10-01-backend-review.md` (ID-6 section and 5.4 item 1). Related: X-7 (service JWTs for workflow to workspace, verified against a JWKS file) is independent and can ship first or in parallel.

## 1. Problem

Access tokens are HS256 JWTs signed with one shared secret, `JWT_ACCESS_SECRET`. Every verifier holds that secret, so compromising any of them lets an attacker mint a token with `system_role=ADMIN` that every other service accepts. Verifiers found today:

| Service | Where the secret is used |
| --- | --- |
| identity-service (signer and verifier) | `infrastructure/config/IdentityApplicationConfig.java` (`NimbusJwtEncoder.withSecretKey`, `NimbusJwtDecoder.withSecretKey`); `JwtAccessTokenIssuer.java` sets `MacAlgorithm.HS256`; `application.properties` `weav.jwt.access-secret` |
| workspace-service | `infrastructure/security/SecurityConfig.java` `jwtDecoder` (HS256), `JwtAccessTokenValidator.java` |
| workflow-service | `infrastructure/security/SecurityConfig.java` `jwtDecoder` (HS256, validator inline) |
| api-gateway | `src/auth/access-token.service.ts` (`jose` `jwtVerify`, `algorithms: ['HS256']`), `src/config/gateway.config.ts` |
| notification-service | `src/presentation/http.ts` (`jsonwebtoken` `verify`, HS256), `src/config/settings.ts` |

ai-service does not use the access secret: it only verifies service JWTs (RS256, JWKS file; see `src/infrastructure/auth/service-jwt-verifier.ts` and `scripts/ai-dev-keys.mjs`). Web and mobile treat tokens as opaque: a quick grep of `apps/web/src` and `apps/mobile` for jwt-decode, `atob(` and `decodeJwt` found nothing (not exhaustive).

Claims stay as they are: `iss`, `aud`, `sub`, `sid`, `jti`, `token_use=access`, `user_status`, `system_role`, `iat`, `nbf`, `exp` (15 min default). Every verifier already checks them; only the key and algorithm change.

## 2. Target

- **Algorithm: RS256.** The repo already uses RS256 for service JWTs (ai-service verifier and `scripts/ai-dev-keys.mjs` generate RS256 JWKS), so tooling and test helpers exist. Nimbus and `jose` both support it with no extra setup. `jsonwebtoken`, still used by notification-service, does not support EdDSA. EdDSA gives smaller tokens and faster signing but buys nothing at this scale. Use a 2048-bit key.
- Identity signs with `NimbusJwtEncoder` over an RSA JWK and puts `kid` in the JWS header. It serves `GET /.well-known/jwks.json` (public keys only, unauthenticated, `Cache-Control: public, max-age=300`), added to the permit-all matchers in identity `SecurityConfig.java`. Services reach it directly on the compose network; the gateway proxies it only if a client ever needs it.
- Java verifiers: `NimbusJwtDecoder.withJwkSetUri(...)` (caches, refetches on unknown `kid`) with the existing `JwtAccessTokenValidator`. Node verifiers: `jose.createRemoteJWKSet(new URL(...))` with `jwtVerify`, `algorithms: ['RS256']` and the existing issuer, audience and claim checks. Notification swaps `jsonwebtoken` for `jose` (it only needs verify).
- The `user_status === ACTIVE` check stays in each verifier unchanged (workspace `JwtAccessTokenValidator`, workflow `SecurityConfig`, gateway `access-token.service.ts`).

## 3. Key management

- The private key lives only in identity. Generate it with a small script modelled on `scripts/ai-dev-keys.mjs` into `tmp/service-keys/` (git-ignored) and mount it read-only into identity, as the AI keys are mounted at `/run/weav-keys`. New identity-only env: `JWT_SIGNING_KEY_LOCATION` (PEM file) and `JWT_SIGNING_KEY_ID`. Production uses the same two variables fed from the host's secret store; nothing goes into Neon or the repo.
- Rotation: add the new key file, publish both public keys in the JWKS (one extra `JWT_PREVIOUS_PUBLIC_KEY_LOCATION` is enough), switch `JWT_SIGNING_KEY_ID` to the new key, and drop the old public key after max token TTL plus skew (15 min + 30 s; wait 20 min). Verifiers need no change because they resolve by `kid`.
- Verifiers hold no secret, only `JWT_JWKS_URI` (default `http://identity-service:<port>/.well-known/jwks.json`).
- Startup behaviour: Nimbus and `jose` fetch lazily, so a verifier should start while identity is down and return 401 until the JWKS is reachable. Unverified; confirm in step b tests.

## 4. Migration (each step deployable alone, with a dual-verify window)

| Step | Change | Rollback |
| --- | --- | --- |
| a | Identity loads the key, serves JWKS, can sign RS256, but still signs HS256 by default (`JWT_ACCESS_ALG=HS256`). Nothing else changes. | Remove the endpoint; no consumer exists yet. |
| b | Every verifier accepts both: HS256 with the old secret and RS256 via JWKS. Select the key by the `alg` header and never let a token verify under the other algorithm's key (HS256 with the public key is the classic confusion attack). Spring: a small delegating `JwtDecoder` that reads the header and routes to the HS256 or RS256 decoder. Node: `jose` key-resolver function with `algorithms: ['HS256','RS256']`. | Redeploy the previous verifier build; tokens are still HS256. |
| c | Set `JWT_ACCESS_ALG=RS256` in identity. New logins and refreshes get RS256; existing HS256 tokens keep working. | Set it back to HS256; step b verifiers accept both. |
| d | After TTL plus skew (soak 30 min), remove HS256 acceptance and `JWT_ACCESS_SECRET` from all verifiers, `compose.dev.yml` (identity, workspace, workflow, gateway, notification), `compose.workflow-smoke.yml`, `.env.example`, `scripts/start-workflow-v1-live-smoke.ps1`, and the identity HS256 signer. | Redeploy the step c build and restore the secret; only needed if RS256 verification breaks. |

Refresh tokens are unaffected (opaque, stored as SHA-256 hashes). `JWT_REFRESH_SECRET` is dead config (compose.dev.yml identity block, `.env.example`, identity `application.properties`) and is removed separately per the review's "Now" item, not as part of this work.

## 5. Per-service change list

| Service | Files | Test to add |
| --- | --- | --- |
| identity-service | `IdentityApplicationConfig.java` (JWK-backed encoder), `JwtAccessTokenIssuer.java` (alg, `kid`), `JwtProperties`, `SecurityConfig.java` (permit JWKS), new JWKS controller, `application.properties` | Issued token verifies against the served JWKS; JWKS has no private members; rotation with two keys |
| workspace-service | `SecurityConfig.java` `jwtDecoder`, `JwtProperties`, `application.properties` | Accepts RS256, rejects HS256 after step d, rejects unknown `kid`; existing validator tests unchanged |
| workflow-service | `SecurityConfig.java` `jwtDecoder`, `application.properties` | Same as workspace |
| api-gateway | `access-token.service.ts`, `gateway.config.ts` and its spec | RS256 accepted, HS256 rejected after d, forged `alg` rejected |
| notification-service | `presentation/http.ts`, `config/settings.ts`, `package.json` (use `jose`), `testing/fixtures.ts` | Same as gateway |
| compose and scripts | `compose.dev.yml`, `compose.workflow-smoke.yml`, `.env.example`, new key script, smoke script | Smoke: login via gateway, then call a workspace, a workflow and a notification endpoint |

## 6. Out of scope and open questions

- Revocation: disabled users, password changes and revoked sessions stay valid for up to 15 min on every verifier except identity. Asymmetric signing does not fix this. Later options: a revoked-`sid` set in Valkey checked by verifiers, or a shorter TTL. Not solved here.
- Whether the gateway should expose the JWKS externally (web and mobile do not need it today).
- JWKS availability assumes a single identity instance in the current topology.

## 7. Effort and order

| Step | Effort |
| --- | --- |
| a | S |
| b | M (five verifiers, two stacks, dual-algorithm tests) |
| c | S (config flip) |
| d | S (deletions across compose, env, scripts) |

Recommended order: ship X-7 first (it introduces the JWKS-file verification pattern and test helpers for Java and Node that step b can reuse), then a, b, c, d. Steps a to c can share one branch; d is a separate commit after the soak window.
