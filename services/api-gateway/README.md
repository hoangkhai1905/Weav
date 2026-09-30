# Weav API Gateway

The API Gateway is the public NestJS/Fastify ingress for the Identity,
Workspace, Notification, and OCR services. It owns transport authentication,
explicit route registration, request correlation, safe header forwarding,
request deadlines, rate limiting, and operational endpoints. Domain
authorization and persistence remain in the downstream services.

The Gateway contract published at
`packages/contracts/http/gateway/openapi.yaml` is intentionally scoped to the
public Workspace surface. It is not a declaration that every Gateway route is
covered by that document.

## Local development

From the repository root:

```powershell
pnpm install
pnpm --dir services/api-gateway start:dev
```

Supply the validated environment variable names through the local shell,
Compose, or an approved secret store. Do not commit `.env` files or put secret
values in scripts, logs, or this README.

Runtime and authentication names:

```text
APP_ENV
PORT
JWT_ACCESS_SECRET
JWT_ISSUER
JWT_AUDIENCE
JWT_CLOCK_SKEW
```

Validated upstream and CORS names:

```text
IDENTITY_SERVICE_URL
WORKSPACE_SERVICE_URL
WORKFLOW_SERVICE_URL
AI_SERVICE_URL
BOT_SERVICE_URL
NOTIFICATION_SERVICE_URL
OCR_SERVICE_URL
CORS_ALLOWED_ORIGINS
OCR_ALLOW_UNAUTHENTICATED_DEV
```

Rate-limit names:

```text
GATEWAY_GENERAL_RATE_LIMIT
GATEWAY_AUTH_RATE_LIMIT
GATEWAY_OCR_RATE_LIMIT
GATEWAY_RATE_LIMIT_WINDOW_MS
```

The validated defaults and production-only configuration checks live in
`src/config/gateway.config.ts`. The local development OCR bypass is permitted
only for the explicit development environment and only when the request has no
Authorization header.

## Route and authentication matrix

Gateway route declarations are explicit. Unknown paths, internal service paths,
and unsupported methods are not forwarded.

| Gateway route                                                                    | Methods                         | Auth policy                                                            | Upstream                            |
| -------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| `/`                                                                              | `GET`                           | Public                                                                 | Gateway                             |
| `/health`, `/ready`                                                              | `GET`                           | Public                                                                 | Gateway                             |
| `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, `/api/auth/logout` | `POST`                          | Public                                                                 | Identity                            |
| `/api/auth/forgot-password`, `/api/auth/reset-password`                          | `POST`                          | Public                                                                 | Identity                            |
| `/api/auth/otp/request`, `/api/auth/otp/verify`                                  | `POST`                          | Optional bearer                                                        | Identity                            |
| `/api/auth/me`                                                                   | `GET`, `PATCH`                  | Required bearer                                                        | Identity                            |
| `/api/auth/change-password`                                                      | `POST`                          | Required bearer                                                        | Identity                            |
| `/api/auth/sessions`                                                             | `GET`, `DELETE`                 | Required bearer                                                        | Identity                            |
| `/api/auth/sessions/{sessionId}`                                                 | `DELETE`                        | Required bearer                                                        | Identity                            |
| `/api/users/me`                                                                  | `GET`, `PATCH`                  | Required bearer                                                        | Identity                            |
| `/api/users/me/sessions`                                                         | `GET`, `DELETE`                 | Required bearer                                                        | Identity                            |
| `/api/users/me/sessions/{sessionId}`                                             | `DELETE`                        | Required bearer                                                        | Identity                            |
| `/api/v1/notifications/**`, `/api/notifications/**`                              | Registered notification methods | Required bearer                                                        | Notification                        |
| `/api/v1/workspaces`                                                             | `POST`, `GET`                   | Required bearer                                                        | `/workspaces`                       |
| `/api/v1/workspaces/{workspaceId}`                                               | `GET`, `PATCH`                  | Required bearer                                                        | `/workspaces/{workspaceId}`         |
| `/api/v1/workspaces/{workspaceId}/connections`                                  | `POST`, `GET`                   | Required bearer                                                        | `/workspaces/{workspaceId}/connections` |
| `/api/v1/workspaces/{workspaceId}/connections/{connectionId}`                   | `GET`, `PATCH`, `DELETE`        | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/connections/{connectionId}/test`              | `POST`                          | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/connections/{connectionId}/disable`           | `POST`                          | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/connections/{connectionId}/oauth/authorize`   | `POST`                          | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/members`                                       | `GET`, `POST`                   | Required bearer                                                        | `/workspaces/{workspaceId}/members` |
| `/api/v1/workspaces/{workspaceId}/members/{userId}/permissions`                  | `PATCH`                         | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/members/{userId}`                              | `DELETE`                        | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/members/me`                                    | `DELETE`                        | Required bearer                                                        | Matching Workspace suffix           |
| `/api/v1/workspaces/{workspaceId}/ocr/extractions`                               | `POST`                          | Required bearer, or the existing development-only missing-token bypass | OCR `/v1/extractions`               |

The Workspace rows are exactly the seventeen public operations in the Gateway
OpenAPI contract. Connection routes are explicitly allow-listed; internal
Workspace operations, manual credential routes, and the Google OAuth callback
are not Gateway routes. The literal `members/me` route is registered separately
from the generic `{userId}` route so route precedence cannot widen the API.

## Transport and response behavior

- A supplied bearer token is verified at the edge using the configured issuer,
  audience, algorithm, signature, and time claims. Optional routes may omit a
  token, but a malformed or invalid supplied token is rejected rather than
  treated as anonymous.
- The original verified `Authorization` value, canonical request/correlation
  ID, and valid trace context are forwarded as allowed. Cookies, internal
  service keys, forged user/role headers, forwarded-IP spoofing, and hop-by-hop
  headers are not forwarded.
- Workspace input is validated before the proxy runs. UUIDs, strict bodies,
  allow-listed query values, pagination bounds, and boolean filters follow the
  Workspace contract. Rejected input does not call the upstream.
- Successful downstream JSON, documented business-error status/body pairs, and
  bodyless `204` responses are preserved. Gateway-generated errors use the
  correlated `{ error: { code, message, details }, status, requestId }`
  envelope.
- Redirects are rejected. Upstream connection failures, deadline expiry, or
  client disconnects return the existing sanitized service-unavailable contract;
  mutating requests are not retried. `429` responses include `Retry-After`.

## Health, readiness, and rate limits

`GET /health` is process liveness. It is public, exempt from throttling, and
does not call an upstream service.

`GET /ready` is public and probes Identity and Workspace in parallel at their
verified `/actuator/health/readiness` paths. Each probe has a two-second
deadline that includes reading the response body. Both services must report
HTTP 200 for Gateway `200`; a down, failed, redirected, or stalled probe yields
Gateway `503`. The response exposes only aggregate `up`/`down` status and the
correlation ID. Notification and OCR are not readiness dependencies.

The limiter is intentionally in-memory and single-replica:

- General traffic uses one socket-IP budget across routes.
- Public authentication mutations use a separate socket-IP budget.
- OCR uses the verified JWT `principal.sub`; IP fallback exists only for the
  explicit development OCR bypass.
- `trustProxy` is false, forwarded headers do not choose a bucket, and health
  plus CORS preflight are exempt.

Distributed rate storage and multi-replica enforcement require a separate
design and rollout decision.

## OCR streaming risk

OCR preserves the accepted progressive multipart/raw-stream behavior and uses a
ten-second upstream deadline covering response-body reads, plus disconnect
cancellation. The established response is sanitized `503 OCR_BUSY` when the
upstream cannot complete in time.

The existing raw-stream path may bypass the ordinary Fastify parser body-size
limit. This compatibility risk is intentionally not changed here; a strict
stream cap needs a separate measurement, client-compatibility review, and
rollout plan before being enabled.

## Verification commands

```powershell
pnpm --dir services/api-gateway test -- --runInBand --silent
pnpm --dir services/api-gateway test:e2e -- --runInBand --silent
pnpm --dir services/api-gateway exec tsc --noEmit
pnpm --dir services/api-gateway build
pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"
```

The package E2E fixtures prove Gateway-boundary behavior. They do not replace
real Identity/Workspace deployment or an authenticated browser smoke test.

## Deferred features

Workflow, AI, and Bot public routes; distributed throttling; OAuth browser
cookie migration; realtime; client/database changes; admin/avatar expansion;
and production stream-cap changes are outside this Gateway slice. Real-service
login, Workspace mutation/access, and authenticated browser compatibility proof
remain deployment-gated follow-up checks.

## Rollback

The Gateway has no database migration in this slice. If rollout verification
fails, route traffic back to the previous Gateway artifact or revert the
isolated Gateway change set through the normal reviewed VCS process. Keep the
Identity, Workspace, Notification, and OCR services unchanged while rolling
back the ingress. Re-evaluate the readiness and limiter configuration before a
retry; do not compensate by widening routes, disabling JWT verification, or
removing deadline checks.
