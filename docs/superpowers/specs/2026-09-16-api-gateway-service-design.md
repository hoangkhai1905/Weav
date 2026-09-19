# API Gateway V1 design

Status: approved for implementation by the user on 2026-09-16.
Baseline: `api-gateway` at `00cc5f8`; 2026-09-16, Asia/Saigon.

## Purpose and boundary

Provide a tested public ingress for the existing Identity, Workspace, Notification and OCR services. Gateway owns transport authentication, routing, request limits, correlation and operational endpoints. Services retain domain authorization and persistence. Service-to-service traffic remains direct. Public gateway routes must never expose service `/internal/**` endpoints or forward client-supplied internal service keys.

Sources: repository `AGENTS.md`; `packages/contracts/http/auth/openapi.yaml`; `packages/contracts/http/workspace/openapi.yaml`; existing gateway and client routes; [Notion Gateway](https://app.notion.com/p/65f4d7a29afb83e58f0a814716d88f6e?pvs=204); [Notion architecture](https://app.notion.com/p/57f4d7a29afb833ca27b014ed52a82db?pvs=204).

## Approach

Use incremental Nest/Fastify modules and explicit route registration. Preserve existing Identity, Notification and OCR adapters while adding shared security/transport policies and a Workspace adapter. A wholesale switch to wildcard `@fastify/http-proxy` risks widening the public API and changing streaming behavior; a configurable universal gateway framework adds unnecessary scope. Neither is required for V1. Reuse installed dependencies when they serve a concrete requirement.

Runtime: Node 24, pnpm 11.22.0, NestJS 11, Fastify 5, jose 6, Zod 4, Throttler 6, Terminus 11. TypeScript `^5.7.3` permits 5.9; verify the resolved version before claiming a mismatch or changing the manifest/lockfile.

## Public API compatibility

| Public route | Upstream | Policy |
| --- | --- | --- |
| Existing `/api/auth/**`, `/api/users/**` registered endpoints | Identity `/auth/**`, `/users/**` | Preserve each current public/optional/required auth mode |
| `/api/v1/workspaces` and explicit nested Workspace contract routes | Workspace `/workspaces` and matching suffix | Required access JWT; downstream owns membership/capabilities |
| Both existing notification prefixes | Notification existing `/api/v1/notifications` routes | Required JWT; preserve aliases |
| Existing workspace-scoped OCR extraction | OCR `/v1/extractions` | Required JWT, except existing explicit development-only bypass |
| `/health`, `/ready` | Gateway | Public, no credentials or infrastructure details in response |

No catch-all Workspace proxy. Register only methods and paths in Workspace OpenAPI. Keep OCR extraction specificity intact. Unknown paths/methods return 404/405 according to the application router without reaching any upstream. Do not introduce global `/api/v1` prefix because it would break existing aliases.

Preserve upstream success and business-error bodies, statuses and documented response headers. New gateway-generated errors use `{error:{code,message,details:[]},requestId}`; document these separately. A global filter must not rewrite existing proxy responses. Preserve OCR's existing transport-error contract. Additive response correlation headers are allowed.

## Authentication and transport

Verify access JWT using jose with HS256 only, configured issuer/audience, 30-second default skew, access token use, UUID `sub`/`sid`/`jti`, valid role/status claims and required numeric time claims consistent with Identity's actual validator. Reject disabled access claims; live session revocation and domain authorization remain downstream checks. Do not trust client-provided identity headers. Forward the original verified Bearer token to the service.

Required routes reject missing, malformed, expired or invalid credentials before proxying. Public login/register/refresh/recovery routes must remain usable; optional-auth route behavior must be explicitly tested against the existing adapter. A refresh token must not pass an access-token guard. Unknown signing algorithms are rejected. Never log tokens, secrets, cookies, request bodies or raw upstream failure bodies.

Validate config at startup without echoing values: port range, absolute HTTP(S) upstream URLs with no embedded credentials/query/fragment, JWT secret at least 32 UTF-8 bytes, issuer/audience, nonnegative bounded clock skew, explicit production CORS origins. Wire JWT variables into Gateway's Compose environment. Do not copy refresh/internal-service secrets into Gateway. Preserve supported development OCR bypass; reject enabling it outside explicit development.

Select a validated incoming `X-Request-ID`, otherwise `X-Correlation-Id`, otherwise generate a UUID. Allowed external ID: 1–128 characters matching `[A-Za-z0-9._:-]+`; invalid IDs are replaced. Set both response headers and propagate the canonical ID in both upstream headers. If both supplied IDs disagree, `X-Request-ID` takes precedence. Validate W3C trace headers before propagation. Correlation headers are exposed through CORS; credentials remain false for existing token routes.

Proxy destinations come exclusively from validated configuration. Use explicit headers, reject redirects, never forward hop-by-hop headers, client internal keys, spoofed user/role headers or arbitrary cookies. Preserve upstream 204, JSON and existing OCR stream semantics. Cancel requests on timeout and disconnect; do not retry mutating requests. Retain existing OCR timeout/size behavior after inspecting it; do not apply a small auth JSON limit to OCR uploads.

Optional-auth acceptance: absent Authorization permits anonymous access with no principal; a valid access JWT attaches the principal; any supplied malformed/invalid/expired/refresh token returns 401 before upstream, never silently anonymous.

OCR acceptance: add a 10-second upstream timeout (the current OcrService has no abort signal; the earlier planning review incorrectly described it as existing) and preserve 503 OCR_BUSY with request ID on connection failure, extending that behavior to timeout. Preserve multipart boundary/content-type and native fetch duplex half behavior. Measure actual Fastify upload limits in integration tests; retain the measured existing limit in this slice. If raw streams bypass the parser limit, report that gap explicitly. Verify disconnect cancellation and no eager buffering/JSON coercion. A stricter upload cap needs separate compatibility review; Identity's 16 KiB JSON cap never applies to OCR uploads.

## Limits and health

V1 targets one Gateway replica with in-memory Throttler storage. Proposed configurable defaults: general 120 requests/minute/IP, auth public mutations 10/minute/IP, OCR 10/minute/authenticated subject (IP fallback only in allowed dev bypass). Use socket IP with `trustProxy=false`; ignore spoofed forwarded headers. Exclude health and CORS preflight. Return 429 with Retry-After. Distributed storage is a separate requirement before multiple replicas; do not imply cluster-wide enforcement.

`GET /health`: process liveness, no upstream calls. `GET /ready`: validated startup and bounded parallel probes of Identity and Workspace, the required services for the primary authenticated workspace flow; 200 ready or 503 not ready. Probe only verified existing health paths, with two-second per-probe deadlines. Notification/OCR failures are reported at their routes and do not make the whole ingress unready. Response omits internal URLs and raw errors.

## Exclusions and integration risks

Workflow/AI/Bot public endpoints require actual upstream contracts before a later milestone. OAuth browser-cookie migration, mobile legacy workspace route migration, realtime, distributed throttling and admin/avatar expansion are separate slices. Preserve existing direct Identity OAuth behavior for this milestone. Do not fabricate `/workspaces/current` semantics or change client code incidentally.

The checkout contains 929 pre-existing status entries. Implementation must use an isolated worktree based on the recorded current HEAD, preserve local user changes, and use explicit file ownership. GitNexus runner/index is currently unavailable: restore/bootstrap it before editing existing symbols; UNKNOWN requires manual corroboration, HIGH/CRITICAL requires a reported warning. No commits without complete graph change detection.

## Acceptance

Existing route aliases, response contracts and OCR dev/stream behavior pass regression tests. JWT rejection, public-route accessibility, Workspace mapping, header sanitization, bounded requests, 429 and health semantics are demonstrated against the real Fastify adapter. Contract tests cover every public Workspace operation and prove no internal path is reachable. Runtime proof includes real Identity login and Workspace access through Gateway plus authenticated browser auth/notification/OCR smoke where services and test credentials exist. Missing runtime prerequisites are reported as blocked verification, never as a passing real-service flow.

## Worker and review protocol

GPT-5.6 Luna at reasoning effort `max` implements one bounded task at a time. `ultramax` is not an available Luna effort. The controlling agent owns the plan, review decisions and integration; Luna owns only the task's declared implementation/test files. The controller independently checks spec compliance, code/security correctness and verification output. Findings are sent back with severity, file/line, reproduction and acceptance condition. Luna fixes and reruns affected tests; the controller reviews the new diff until findings are resolved. No self-reported success substitutes for this gate.
