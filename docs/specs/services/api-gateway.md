# API Gateway

> Status: Partial. Identity (incl. avatar, OAuth-account list, admin users), Workspace (incl. credential replace/delete), Notification, OCR and Workflow (draft/publish/run/monitor, AI generate, public webhook ingress) routes are proxied at the edge; Bot routes, identity browser cookie/OAuth flows and distributed rate limiting are not. Owner: T (partner). Last verified: 2026-10-01 against `refactor/optimize-backend`.

## Purpose and scope

Public NestJS/Fastify ingress for web and mobile clients. Responsibilities: explicit route registration and proxying, edge verification of the access JWT, request/correlation IDs and safe header forwarding, per-request upstream deadlines, in-memory rate limiting, CORS allow-list, error normalization, liveness/readiness endpoints.

Not responsible for: business data or persistence (none), business authorization (Identity/Workspace/Workflow decide membership and permissions), service-to-service traffic (services call each other directly, never through the Gateway), the AI Service (kept off the public edge), WebSockets/realtime.

Gateway changes are requested from the partner as documented handoffs; this spec does not propose code.

## Use cases covered

The Gateway only carries these use cases; the owning service implements them.

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC001, UC002, UC003, UC004 | Sign in, forgot password, register, change password | Implemented | `api/auth/*` routes (plus `api/users/me/avatar`, `oauth-accounts`) in [identity.module.ts](../../../services/api-gateway/src/identity/identity.module.ts) |
| UC005-UC010 | Workspaces, members, permissions, connections | Implemented | 19 Workspace operations (incl. credential PUT/DELETE) in [workspace.controller.ts](../../../services/api-gateway/src/workspace/workspace.controller.ts) |
| UC011, UC012, UC013, UC015, UC016, UC018, UC019 | Create, edit, save draft, publish, pause/resume, run manually, monitor executions (per workflow) | Implemented | [workflow.module.ts](../../../services/api-gateway/src/workflow/workflow.module.ts); no `DELETE` route, so UC017 is missing |
| UC014 | Generate workflow from natural language | Implemented (gateway level) | `POST /api/v1/workspaces/:id/workflows/generate`, 32 KiB body, 80 s deadline |
| UC017 | Delete workflow | Planned | No Gateway route; check Workflow contract before adding |
| UC020 | Result notifications | Implemented | `api/v1`, `api/v2`, `api/notifications` routes |
| UC021 | Trigger via webhook | Implemented (gateway level) | Public `POST /api/v1/webhooks/{endpointKey}` in `WebhookProxyController` |
| UC022-UC024 | Telegram trigger, connect a bot, use the bot | Implemented (gateway level) | Public `POST /api/v1/webhooks/telegram/{endpointKey}` in `TelegramWebhookProxyController`; the bot itself is a workspace connection and `telegram.send_message` runs in Workflow. There is no Bot service or Bot route |
| UC025-UC028 | Admin: users, lock, all workspaces, all executions | Implemented (gateway level) | `api/admin/users` list, detail, status (edge ADMIN check); depends on the Identity admin endpoints |
| n/a | OCR extraction (used by workflow OCR nodes/UI) | Implemented | [ocr.controller.ts](../../../services/api-gateway/src/ocr/ocr.controller.ts) |

## Business rules

| Rule | How the Gateway supports it |
| --- | --- |
| BR01 | Global `AccessTokenGuard` defaults every route to `required`; only routes tagged `public`/`optional` skip it ([access-token.guard.ts](../../../services/api-gateway/src/auth/access-token.guard.ts)). Scope checks stay downstream. |
| BR02-BR05 | Not enforced here. The Gateway validates shape (UUIDs, strict bodies, pagination) and forwards the user JWT; Workspace/Workflow decide membership, Owner and publish rights. |
| BR09 | Webhook ingress forwards the validated `X-Webhook-Secret` to Workflow, which enforces it. Telegram ingress forwards only `X-Telegram-Bot-Api-Secret-Token` (checked against `^[A-Za-z0-9_-]{1,256}$`), never Authorization, and has the same endpoint-key pattern, body cap and per-key rate limit as the webhook route. |

Component rules from code:
- Unknown paths, internal service paths and unsupported methods are not forwarded (no wildcard proxy).
- A supplied but invalid bearer token is rejected, never treated as anonymous.
- Mutating upstream requests are never retried; redirects from upstreams are rejected.
- Access token must have `token_use=access`, `user_status=ACTIVE`, UUID `sub`/`sid`/`jti`, `system_role` USER or ADMIN.

## Domain model and data

None. The Gateway owns no database, cache or queue. Rate-limit counters are in process memory only. `VALKEY_URL` is passed in `compose.yml` but no Gateway code reads it.

## API

### Public routes (method, path, upstream, auth)

Upstream paths drop the `/api` or `/api/v1` prefix except Notification. Auth: Public / Optional bearer / Required bearer.

| Method | Gateway path | Upstream (service path) | Auth |
| --- | --- | --- | --- |
| GET | `/` | Gateway | Public |
| GET | `/health`, `/ready` | Gateway | Public (throttle-exempt) |
| POST | `/api/auth/login`, `register`, `refresh`, `logout`, `forgot-password`, `reset-password` | Identity `/auth/*` | Public |
| POST | `/api/auth/otp/request`, `/api/auth/otp/verify` | Identity `/auth/otp/*` | Optional |
| POST | `/api/auth/change-password` | Identity `/auth/change-password` | Required |
| GET, PATCH | `/api/auth/me`, `/api/users/me` | Identity `/users/me` | Required |
| GET, DELETE | `/api/auth/sessions`, `/api/users/me/sessions` | Identity `/users/me/sessions` (GET forwards `page`,`size`) | Required |
| DELETE | `/api/auth/sessions/{id}`, `/api/users/me/sessions/{id}` | Identity `/users/me/sessions/{id}` | Required |
| GET | `/api/v1/notifications`, `/unread-count` (also `/api/notifications`) | Notification `/api/v1/notifications` | Required |
| PATCH, POST | `.../{id}/read`, `.../read-all` | Notification v1 | Required |
| GET, PATCH, POST | `/api/v2/notifications`, `/unread-count`, `/{id}/read`, `/read-all` | Notification `/api/v2/notifications` | Required |
| GET | `/api/users/me/oauth-accounts` | Identity `/users/me/oauth-accounts` | Required |
| GET, PUT, DELETE | `/api/users/me/avatar` | Identity `/users/me/avatar` (PUT streams multipart, 2 MiB + 64 KiB cap, 415 if not multipart) | Required |
| GET | `/api/admin/users`, `/api/admin/users/{userId}` (list forwards `page`,`size`,`search`,`status`) | Identity `/admin/users` | Required, `system_role=ADMIN` else 403 |
| PATCH | `/api/admin/users/{userId}/status` | Identity `/admin/users/{id}/status` | Required, ADMIN |
| POST, GET | `/api/v1/workspaces` | Workspace `/workspaces` | Required |
| GET, PATCH | `/api/v1/workspaces/{workspaceId}` | Workspace `/workspaces/{id}` | Required |
| GET, POST | `.../{workspaceId}/members` | Workspace `.../members` | Required |
| PATCH | `.../members/{userId}/permissions` | Workspace | Required |
| DELETE | `.../members/{userId}`, `.../members/me` | Workspace | Required |
| POST, GET | `.../{workspaceId}/connections` | Workspace | Required |
| GET, PATCH, DELETE | `.../connections/{connectionId}` | Workspace | Required |
| POST | `.../connections/{connectionId}/test`, `/disable`, `/oauth/authorize` | Workspace | Required |
| POST | `.../connections/{connectionId}/oauth/complete` (strict body `{completion}`, `^[A-Za-z0-9_-]{32,128}$`) | Workspace | Required |
| PUT, DELETE | `.../connections/{connectionId}/credential` | Workspace | Required |
| POST, GET | `/api/v1/workspaces/{workspaceId}/workflows` | Workflow `/workspaces/{id}/workflows` | Required |
| GET | `.../workflows/{workflowId}` | Workflow | Required |
| PUT | `.../workflows/{workflowId}/draft` | Workflow | Required |
| POST | `.../workflows/generate` | Workflow `.../workflows/generate` (32 KiB, 80 s) | Required |
| POST | `.../workflows/{workflowId}/publish`, `/pause`, `/resume` | Workflow | Required |
| POST, GET | `.../workflows/{workflowId}/executions` | Workflow | Required |
| GET | `.../workflows/{workflowId}/executions/{executionId}` (`logPage`,`logSize`) | Workflow | Required |
| POST | `/api/v1/webhooks/{endpointKey}` | Workflow `/webhooks/{endpointKey}` (JSON only, 415 otherwise; client Authorization never forwarded; `X-Webhook-Secret` forwarded after validation) | Public (own `webhook` throttler per endpoint key) |
| POST | `/api/v1/workspaces/{workspaceId}/ocr/extractions` | OCR `/v1/extractions` | Required (dev-only unauthenticated bypass) |

Not routed (by design or pending): Workspace internal routes, Google OAuth callbacks, identity browser cookie/OAuth flows (`/auth/web/*`, Google OAuth start/exchange/callback, account link, OAuth unlink; clients still call Identity directly), AI `/v1/*`, Bot, Workflow `DELETE`.

Common errors: 400 validation, 401 missing/invalid bearer, 413 body too large (Identity 16 KiB, avatar 2 MiB + 64 KiB, Workflow 1 MiB, generate 32 KiB), 429 with `Retry-After`, 502 invalid upstream response, 503 upstream unavailable/timeout (`OCR_BUSY` for OCR). Downstream business errors (401/403/404/409/422) pass through unchanged.

### Contracts
- Public Workspace surface: [gateway openapi.yaml](../../../packages/contracts/http/gateway/openapi.yaml) and [README](../../../packages/contracts/http/gateway/README.md) (20 operations only).
- Workflow: [workflow openapi.yaml](../../../packages/contracts/http/workflow/openapi.yaml) (upstream contract, includes `generate` and `/webhooks/{endpointKey}`).
- Notification v2: [notifications-v2.md](../../../packages/contracts/http/notifications-v2.md). Identity: `packages/contracts/http/auth`. OCR: `packages/contracts/http/ocr`.
- Identity, Notification, Workflow and OCR routes have no Gateway OpenAPI document.

### Internal API
None. The Gateway exposes no service-to-service endpoints and holds no Service JWT or internal service key.

## Events and messaging

None. The Gateway neither publishes nor consumes RabbitMQ messages.

## Dependencies

| Direction | Component | Detail |
| --- | --- | --- |
| Calls | Identity (`IDENTITY_SERVICE_URL`) | Auth/session routes; readiness probe `/actuator/health/readiness` |
| Calls | Workspace | Workspace routes; readiness probe |
| Calls | Workflow | Workflow routes |
| Calls | Notification, OCR | Proxied routes (not readiness dependencies) |
| Configured, unused | AI, Bot | URLs validated, no controller |
| Called by | Web, mobile | Only public ingress |
| External | None | No Neon, R2, RabbitMQ or Valkey use in code |

## Security

- Edge JWT: `jose` HS256, checks issuer, audience, required claims, clock skew (default 30 s), `token_use`, ACTIVE status ([access-token.service.ts](../../../services/api-gateway/src/auth/access-token.service.ts)). Only the access secret is held; refresh and internal secrets stay out.
- Authorization header must be a single `Bearer <token>` of at most 8192 chars. The original value is forwarded so downstream services re-verify.
- Forwarded headers: Authorization, canonical `X-Request-ID`/`X-Correlation-ID`, valid `traceparent`, truncated `User-Agent`, a valid `Idempotency-Key` (`[A-Za-z0-9._:-]{8,128}`, non-GET only). `X-Forwarded-For` is set from the Gateway-derived client IP (`request.ip`); client-supplied values are never copied. Cookies, internal keys and forged user/role headers are dropped.
- CORS: explicit origin allow-list, `credentials: false`, allowed headers Authorization, Content-Type, Idempotency-Key, Traceparent, X-Correlation-ID, X-Request-ID.
- Response headers on every reply: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Admin routes check `system_role === ADMIN` at the edge (403, no upstream call); Identity still re-checks.
- Input validation before proxying: UUIDs, strict zod bodies (Workflow, Workspace), allow-listed query keys (Identity), pagination bounds (`size` 1-100).
- Production checks: `CORS_ALLOWED_ORIGINS` required; `OCR_ALLOW_UNAUTHENTICATED_DEV` only valid in `development`; `JWT_ACCESS_SECRET` at least 32 bytes.
- `trustProxy` is false by default (`GATEWAY_TRUST_PROXY_HOPS=0`); set the hop count behind a load balancer so rate limits and `X-Forwarded-For` use the real client IP. Identity ignores `X-Forwarded-For` until `server.forward-headers-strategy` is configured.

## Configuration

Names and defaults from [gateway.config.ts](../../../services/api-gateway/src/config/gateway.config.ts). Secret: `JWT_ACCESS_SECRET` (no default, required).

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_ENV` | `development` (or `production` if `NODE_ENV=production`) | development/test/production |
| `PORT` | `3000` | Listen port (host `0.0.0.0`) |
| `JWT_ACCESS_SECRET` | none, required | HS256 key, at least 32 bytes |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `weav-identity` / `weav-api` | Expected claims |
| `JWT_CLOCK_SKEW` | `30s` | 0-300 s, units ms/s/m/h |
| `IDENTITY_SERVICE_URL` | `http://identity-service:8080` | Upstream |
| `WORKSPACE_SERVICE_URL` | `http://workspace-service:8080` | Upstream |
| `WORKFLOW_SERVICE_URL` | `http://workflow-service:8080` | Upstream |
| `NOTIFICATION_SERVICE_URL` | `http://notification-service:3000` | Upstream |
| `OCR_SERVICE_URL` | `http://ocr-service:8000` | Upstream |
| `AI_SERVICE_URL` | `http://ai-service:3000` | Upstream of the assistant routes: `POST /api/v1/assistant/chat` (SSE) and the conversation history proxies (`GET /api/v1/assistant/conversations`, `GET .../conversations/{id}/messages`, `DELETE .../conversations/{id}`) |
| `CORS_ALLOWED_ORIGINS` | localhost/127.0.0.1 on 5173 and 8081; required in production | Comma list of origins |
| `OCR_ALLOW_UNAUTHENTICATED_DEV` | `false` | Dev-only OCR bypass with no Authorization header |
| `GATEWAY_GENERAL_RATE_LIMIT` | `120` | Requests per window per socket IP |
| `GATEWAY_AUTH_RATE_LIMIT` | `10` | Public auth mutations per window per IP |
| `GATEWAY_OCR_RATE_LIMIT` | `10` | OCR per window per JWT subject |
| `GATEWAY_WEBHOOK_RATE_LIMIT` | `60` | Webhook ingress per window per endpoint key |
| `GATEWAY_ASSISTANT_RATE_LIMIT` | `20` | Assistant chat per window per user |
| `GATEWAY_TRUST_PROXY_HOPS` | `0` | 0-10 trusted proxy hops; 0 disables `trustProxy` |
| `GATEWAY_RATE_LIMIT_WINDOW_MS` | `60000` | Window and block duration |
| `VALKEY_URL` | n/a | Set in `compose.yml`, not read by code |

Compose ([compose.yml](../../../compose.yml), profile `app`, port 3000) hardcodes Workspace, Workflow, AI, OCR, Bot and Notification URLs; only Identity and CORS are overridable there. `.env.example` lists the Identity, Workflow, Workspace URLs, CORS, JWT and OCR bypass variables.

## Non-functional requirements

| Area | Value (from code) |
| --- | --- |
| Upstream deadline | 10 s for Identity, Workspace, Notification, OCR (includes response body read); 15 s for Workflow; 80 s for workflow generate |
| Health probes | 2 s per upstream, parallel, body read included |
| Body limits | Identity JSON 16 KiB; avatar multipart streamed with a 2 MiB + 64 KiB cap; Workflow JSON 1 MiB; generate 32 KiB; OCR raw multipart stream not capped by the Gateway |
| Retries | None; mutations never retried |
| Rate limits | 4 throttlers (general, auth, OCR, webhook per endpoint key), in-memory, single replica; health and CORS preflight exempt |
| Response caching | `Cache-Control: no-store` on Identity and Workflow responses |
| Observability | `X-Request-ID`/`X-Correlation-ID` on every response; errors logged with request ID; `GET /health` liveness, `GET /ready` readiness (Identity + Workspace only) |
| Error envelope | `{ error: { code, message, details }, requestId }`; proxy-generated errors also include `status` |

## Status and known gaps

- Done at gateway level: generate (UC014, per [AI Service design §9](../../../docs/superpowers/specs/2026-09-25-ai-service-v1-design.md)), webhook ingress (UC021) and admin user routes (UC025-UC028 as far as Identity exposes them).
- Planned: Bot routes, workflow delete (UC017), realtime/WebSocket (empty `src/websocket`), identity browser cookie/OAuth flows through the Gateway.
- Unchanged: upstream timeouts surface as 503, not 504; OCR upload has no byte cap.
- Partial: distributed rate limiting (in-memory only, `VALKEY_URL` unused); readiness ignores Workflow, Notification, OCR.
- Known risk: OCR raw-stream path may bypass the Fastify body-size limit (accepted, documented in README).
- Real-service login/Workspace and authenticated browser smoke tests remain deployment-gated (README).
- Gateway test coverage for Workflow is a small unit spec only ([workflow.module.spec.ts](../../../services/api-gateway/src/workflow/workflow.module.spec.ts)); no Workflow e2e.

## Testing

Commands (from README and package scripts; do not run `lint`, it uses `--fix`):

```
pnpm --dir services/api-gateway test --runInBand --silent
pnpm --dir services/api-gateway test:e2e --runInBand --silent
pnpm --dir services/api-gateway exec tsc --noEmit
pnpm --dir services/api-gateway build
pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"
```

Last full result (2026-10-01, `refactor/optimize-backend`): 92/92 unit, 80/80 e2e. E2E suites in `services/api-gateway/test/`: `app`, `auth`, `limits-health`, `routes`, `transport`, `workspace`. No known environment-only errors.

## Open questions

1. Gateway README says Workflow public routes are deferred, but Workflow routes exist in code (`WorkflowModule`). Suggested: partner updates the README; treat code as truth.
2. `compose.yml` passes `VALKEY_URL` and comments "rate limiting / cache", but the limiter is in-memory. Suggested: drop the variable or plan Valkey-backed throttling before multi-replica.
3. Notion's diagram routes the Gateway to AI/OCR/Bot directly; the AI spec keeps AI private and code has no AI/Bot routes. Suggested: only OCR (already routed) and the Telegram webhook (routed to Workflow, no Bot service) are public; AI stays private.
4. Resolved: webhook ingress is a Gateway route (no JWT, JSON only, own rate-limit bucket per endpoint key).
5. Error envelope: README says Gateway errors include `status`; [gateway-exception.filter.ts](../../../services/api-gateway/src/common/gateway-exception.filter.ts) omits it (only proxy-generated errors add it). Suggested: pick one shape and document it in the OpenAPI `GatewayErrorResponse`.
6. Resolved: generate has a per-route 80 s deadline and 32 KiB cap.
7. UC017 (delete workflow): does the Workflow contract define `DELETE`? Not seen in the Workflow OpenAPI paths list; confirm before requesting a Gateway route.
8. Deployment behind a proxy: set `GATEWAY_TRUST_PROXY_HOPS` to the real hop count; Identity must be unreachable directly before it trusts `X-Forwarded-For`.
9. Notification v1 and v2 both exposed, plus legacy `/api/notifications`; no Gateway OpenAPI for them. Suggested: document and set a deprecation date for v1.

## References

- Code: [app.module.ts](../../../services/api-gateway/src/app.module.ts), [create-app.ts](../../../services/api-gateway/src/create-app.ts), [rate-limit](../../../services/api-gateway/src/rate-limit/), [auth](../../../services/api-gateway/src/auth/), [health](../../../services/api-gateway/src/health/), [common](../../../services/api-gateway/src/common/)
- [Gateway README](../../../services/api-gateway/README.md), [design spec](../../superpowers/specs/2026-09-16-api-gateway-service-design.md)
- [Gateway contract](../../../packages/contracts/http/gateway/README.md), [Workflow contract](../../../packages/contracts/http/workflow/openapi.yaml)
- [AI Service V1 design](../../superpowers/specs/2026-09-25-ai-service-v1-design.md), [rulebook](../../rulebook.md), [specs index](../README.md)
