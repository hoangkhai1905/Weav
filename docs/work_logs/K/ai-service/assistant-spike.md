# AI assistant tool-calling spike (Week 2, Lane D)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Repository / branch | Weav / `feat/assistant-spike` (worktree `T:\Weav-wt\assistant`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented and verified with fakes; not committed. Live DeepSeek check not run (coordinator runs it, see section 8) |
| Scope | ai-service `POST /v1/assistant/chat` (SSE) with DeepSeek tool calling and two read-only tools, user-token verifier, gateway SSE route. No `ai_db`, no conversation storage |

## 2. Summary

- `POST /v1/assistant/chat` in ai-service, behind `AI_ASSISTANT_ENABLED` (default `false`). Body `{workspaceId, messages[1..20 x 1..4000 chars]}`, last message must be the user's. Response `text/event-stream` with `delta {text}`, `tool_call {name, arguments}`, `tool_result {name, ok}` (no data echoed), `done {}`, `error {code, message}`.
- Auth: new `UserJwtVerifier` verifies identity RS256 access tokens against identity's JWKS (issuer, audience, RS256 only, kid lookup, clock tolerance, the gateway's required claims, `token_use=access`, `user_status=ACTIVE`). Service JWTs and user tokens are mutually rejected.
- Tools (`list_workflows`, `explain_run_failure`) call workflow-service's public API with the **caller's own** `Authorization` header. 403/404 become `{error: "not_found_or_forbidden"}`; other failures `upstream_error`; no upstream text reaches the model.
- DeepSeek adapter `DeepSeekChatProvider` (OpenAI-compatible `/chat/completions`, `tools`, `stream: true`) with a `ToolCallAccumulator` for split tool-call deltas; the tool loop allows 3 tool rounds, then one more call without tools.
- Gateway `POST /api/v1/assistant/chat`: normal access-token guard, own `assistant` throttler per user, 256 KiB body cap, upstream body piped to the client without buffering or compression.

## 3. Decisions

| Decision | Reason | Alternatives |
| --- | --- | --- |
| `explain_run_failure` takes `{workflowId, executionId}`, not only `executionId` | The execution endpoint is `/workspaces/{ws}/workflows/{wf}/executions/{id}` (the tuple is checked together); there is no execution-by-id route. The model gets `workflowId` from `list_workflows` | A lookup tool that scans workflows (N calls) |
| No `jose` in ai-service: verifier uses `node:crypto` plus a fetched, cached JWKS (10 min TTL, one refetch per 30 s on unknown kid, 3 s timeout, 64 KiB cap, fails closed) | "No new dependency unless unavoidable"; `ServiceJwtVerifier` already uses `node:crypto`, so this mirrors it | Add `jose` (lockfile change) |
| RS256 only. Dev compose signs user tokens with HS256 by default (`JWT_ACCESS_ALG`), which the gateway verifies with the shared secret. The assistant needs identity on RS256 in dev | Spec: "verified via identity's JWKS". Putting `JWT_ACCESS_SECRET` into ai-service would widen the secret's reach | HS256 support in ai-service |
| Env names shared with the gateway: `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CLOCK_SKEW`, `JWT_JWKS_URI` (default `http://identity-service:8080/.well-known/jwks.json` in compose). New: `AI_ASSISTANT_ENABLED`, `AI_WORKFLOW_API_URL`, `AI_ASSISTANT_MAX_TOKENS` (1024), `AI_ASSISTANT_RATE_LIMIT_PER_MINUTE` (20); gateway `GATEWAY_ASSISTANT_RATE_LIMIT` (20) | Reuse | n/a |
| Flag off = the controller is not registered (module-level), so the route behaves exactly like any unknown route. Today that is **400 `INVALID_REQUEST`**, not 404, because `AiExceptionFilter` maps any `HttpException < 500` to 400. The brief says 404; changing the shared filter was out of this lane's file ownership | Smallest, cannot leak the route | Controller that throws 404 (filter would still turn it into 400) |
| Auth order: user token verified first (401), then provider configured (503 `AI_NOT_CONFIGURED`), then body (400), then limits (429 `AI_BUSY`). Errors before the stream starts are normal JSON errors; after the stream starts they are an `error` event with a stable `AiError` code | Same order as the existing controller (config state not revealed to unauthenticated callers) | n/a |
| Limits: per-user fixed-window counter (new `FixedWindowLimiter`, in-memory per replica) plus `Admission.tryAcquire("user:<id>")` for concurrency (reuses the per-workspace cap, default 2, and the shared global cap); output capped by `AI_ASSISTANT_MAX_TOKENS`; overall deadline is the existing `AI_REQUEST_TIMEOUT_MS` request signal (also aborted on disconnect) | Reuse what exists | A distributed limiter (week 3, with quota) |
| `CircuitBreakerProvider` is not used: it wraps `LlmProvider.completeJson`, a different shape | Not worth a second breaker class for a spike | Generalise the breaker (week 3) |
| Prompt-injection stance: system prompt says tool results are untrusted data; each result goes to the model as `{"untrusted_data": ...}` JSON in the `tool` message; tools only project whitelisted fields (workflows: id, name 120 chars, status, updatedAt; run: status, timestamps, failed node id/type/attempts/timestamps, error code, message 300 chars); results capped at 16 KB; at most 4 tool calls per round; tool arguments validated with zod `.strict()` and ids must be UUIDs before they reach a URL | Spec rules 1-3 | n/a |
| Gateway streams with `reply.send(Readable.fromWeb(upstream.body))` instead of hijacking the socket | Fastify pipes a Node stream chunk by chunk, keeps the existing security/CORS/request-id headers, and no compression plugin is installed. The `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` headers are set | `reply.hijack()` + manual headers |
| Gateway maps upstream failures to 400/401/404/413/429/503, anything else 502, never relaying upstream text | Same policy as the other proxies | n/a |
| `tsconfig.build.json` now excludes `scripts/` | A `scripts/` file importing `../src` would otherwise move the build `rootDir` and change `dist/main.js` to `dist/src/main.js` | Put the script under `test/` |

## 4. Changed files

| Type | Path | Change |
| --- | --- | --- |
| Add | `services/ai-service/src/application/assistant/chat-provider.ts` | `ChatProvider` port, message/tool/event types |
| Add | `services/ai-service/src/application/assistant/chat.ts` | Streaming tool loop (`runAssistant`, round cap) |
| Add | `services/ai-service/src/application/assistant/tools.ts` | Tool specs, zod validation, calls to workflow-service, field projection |
| Add | `services/ai-service/src/application/assistant/system-prompt.ts` | Assistant system prompt |
| Add | `services/ai-service/src/infrastructure/llm/deepseek/deepseek-chat-provider.ts` | DeepSeek streaming adapter + `ToolCallAccumulator` |
| Add | `services/ai-service/src/infrastructure/auth/user-jwt-verifier.ts` | User access-token verifier (JWKS) |
| Add | `services/ai-service/src/infrastructure/fixed-window-limiter.ts` | Per-key rate window |
| Add | `services/ai-service/src/presentation/http/assistant.controller.ts` | SSE controller |
| Edit | `services/ai-service/src/config/ai-config.ts` | New env vars (appended) |
| Edit | `services/ai-service/src/ai.module.ts` | Registers the controller only when the flag is on |
| Edit | `services/ai-service/src/ai-deps.ts`, `src/main.ts` | Optional `assistant` deps, wiring |
| Edit | `services/ai-service/tsconfig.build.json`, `README.md` | Exclude `scripts/`; assistant section |
| Add | `services/ai-service/scripts/assistant-live-check.ts` | Live check (section 8) |
| Add | `services/ai-service/src/**/*.spec.ts` (3 files), `test/assistant.e2e-spec.ts`, `test/support/scripted-chat-provider.ts` | Tests and the fake provider |
| Add | `services/api-gateway/src/assistant/assistant.module.ts` | SSE proxy route |
| Edit | `services/api-gateway/src/{app.module,config/gateway.config,rate-limit/rate-limit.module,rate-limit/gateway-throttler.guard}.ts` | Module import, `assistantPerMinute`, `assistant` throttler, per-user tracker |
| Edit | `services/api-gateway/src/config/gateway.config.spec.ts` | Expected `limits` gains `assistantPerMinute: 20` |
| Add | `services/api-gateway/test/assistant.e2e-spec.ts` | Streaming/auth/abort/limit tests |
| Edit | `services/api-gateway/README.md`, `docs/specs/services/api-gateway.md` | Route + env docs |
| Edit | `compose.dev.yml`, `.env.example` | New vars appended (ai-service block, gateway block) |

## 5. SSE and proxy behaviour

- ai-service writes the stream on the raw socket after `reply.hijack()`: headers `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; each event is `event: <name>\ndata: <json>\n\n`, written as soon as it exists.
- Client disconnect: ai-service's existing request signal aborts, which cancels the DeepSeek fetch and any tool fetch; the loop stops silently and the per-user slot is released in `finally`. Verified in the ai-service e2e (provider sees the abort) and the gateway e2e (upstream response closes before finishing).
- Gateway: the first SSE event reaches the client while the upstream response is still open (test holds the upstream open and asserts `upstreamFinished === false` after the first read). No `Content-Encoding` even with `Accept-Encoding: gzip, br`. The gateway's own deadline for the stream is 75 s (ai-service's is 60 s).
- Known limit: if the upstream dies mid-stream the gateway cannot send an `error` event (headers are already out); the client sees a truncated stream. ai-service itself always ends with `done` or `error`.
- nginx/other proxies in front of the gateway must not buffer: `X-Accel-Buffering: no` covers nginx; a CDN may need its own setting (week 3 deployment check).

## 6. Evidence

| Check | Command | Result |
| --- | --- | --- |
| ai-service unit | `pnpm --dir services/ai-service test` | 10 suites, 123 tests pass (new: accumulator with 1/7/1000-byte chunk splits, tool loop incl. two rounds / round cap / tool error / unknown tool / invalid args / abort, user verifier) |
| ai-service e2e | `pnpm --dir services/ai-service run test:e2e` | 2 suites, 36 tests pass (SSE event order with user token reaching a fake workflow API, error event, 401 for no/service/bad tokens, user token rejected on service routes, 400 bounds, per-user 429, client abort, flag off) |
| ai-service build | `pnpm --dir services/ai-service run build` | PASS |
| api-gateway unit | `pnpm --dir services/api-gateway test` | 9 suites, 111 tests pass |
| api-gateway e2e | `pnpm --dir services/api-gateway run test:e2e` | 7 suites, 95 tests pass (10 new) |
| api-gateway build | `pnpm --dir services/api-gateway run build` | PASS |
| Lint (touched production files) | `pnpm --dir <service> exec eslint <files>` | clean. New `*.spec.ts` / e2e files keep the strict-type noise that the existing specs already have (61 errors in the old ones) |
| Live-check script against a local fake SSE server | see section 8 | Runs; sequence, timing and assembly report print correctly |

Not verified: a real DeepSeek stream, a real identity RS256 token, a real workflow-service response shape for `nodes[].error` (taken from `openapi.yaml`: sanitized JSON, read as `{code, message}` when it is an object), compose end to end.

## 7. Risks and open questions for week 3

- **Dev auth mode:** identity defaults to HS256 in dev; the assistant needs `JWT_ACCESS_ALG=RS256` (see `docs/work_logs/K/identity/rs256-access-tokens.md`) and `JWT_JWKS_URI` reachable from ai-service.
- **Flag-off status** is 400, not 404 (section 3). One-line fix in `AiExceptionFilter` if a real 404 is wanted.
- **Workflow list shape:** the tool reads `items[].workflowId|id, name, status, updatedAt`; `WorkflowSummary` is `additionalProperties: true` in the contract, so confirm `name` and `updatedAt` are present (live run).
- **Conversation history:** the client sends the whole history each turn (max 20 x 4000 chars). Week 3: `ai_db` `conversations`/`messages`, retention purge, server-side truncation, and a title.
- **Quota sharing with AI-2:** chat bypasses workflow-service, so per-workspace daily quota and counters need a home in `ai_db` (or a call to workflow's counter); the per-user limiter here is per replica and in-memory.
- **Prompt cost:** each turn re-sends tool specs and history; DeepSeek context caching may help; measure in the live check.
- **Write tools** (create/run workflow) are not in the spike; spec rule 1 requires propose-then-confirm in the UI.
- **Mobile/web client:** `fetch` + `ReadableStream` works on web; React Native needs a polyfill or an SSE library; EventSource cannot send `Authorization`.
- **Token expiry mid-stream:** the user token is checked once at the start; tools reuse it for up to 60 s (access tokens last 15 min), so a revoked session can still read for that window.
- **Reasoning models:** `reasoning_content` deltas are ignored by the adapter; if the configured model streams them, they are not shown.

## 8. Live check (for the coordinator, about 2 small DeepSeek calls)

Runs ONE conversation through the real adapter and tool loop with both tools answered from canned data (no workflow-service), max 2 tool rounds, `max_tokens` 400, 60 s timeout. Never prints the key.

```powershell
$env:DEEPSEEK_API_KEY = '<key>'; $env:DEEPSEEK_MODEL = '<model>'   # optional: $env:DEEPSEEK_BASE_URL
pnpm --dir services/ai-service exec ts-node scripts/assistant-live-check.ts
```

Prints: event sequence, the assembled tool calls, the answer, timings (first event, first `tool_call`, `done`), the number of raw `tool_calls` fragments the model streamed, and `assembled OK: yes|NO`. Expected: `tool_call > tool_result > ... > delta > done`; fragments greater than the number of calls shows the deltas really were split; `assembled OK: yes`.

## 9. Live test (full stack, later)

1. Identity on RS256, `AI_ASSISTANT_ENABLED=true`, DeepSeek key and model set, `compose.dev.yml` stack up (ai-service, workflow-service, gateway).
2. `POST http://localhost:3000/api/v1/assistant/chat` with `Authorization: Bearer <user token>` and `{"workspaceId":"<ws>","messages":[{"role":"user","content":"Which workflows do I have?"}]}`, `curl -N` to see events as they arrive.
3. Expect `tool_call` (`list_workflows`), `tool_result ok:true`, `delta`s, `done`. Repeat with a failed run id: `explain_run_failure`. With another user's workspace: `tool_result ok:false` and the model says it could not read it.

## 10. Next steps

1. Coordinator runs section 8, then the compose smoke in section 9.
2. Week 3: `ai_db`, conversation storage, quota, write-tool proposals, `build` capability, web/mobile clients.

## 11. Review round 1 (security review: no CRITICAL/HIGH)

### Live check result (coordinator, real DeepSeek)

2 tool calls assembled from 67 streamed fragments, both tools ok; first event 660 ms, first `tool_call` 990 ms, `done` 2.3 s. Streamed tool-call deltas, the tool loop and SSE emission are confirmed against the real provider. Still not exercised live: real identity RS256 token, real workflow-service response shapes, compose end to end (section 9).

### Changes

| # | Change | Where |
| --- | --- | --- |
| 1 | Assistant has its own `Admission` pool (`AI_ASSISTANT_MAX_CONCURRENT`, default 4; per-user cap reuses `AI_MAX_CONCURRENCY_PER_WORKSPACE`), so chat streams cannot starve the service-JWT routes. Test: pool of 1 full -> another user gets 429, a service-JWT summarize still returns 200 | `assistant.controller.ts`, `ai-config.ts`, `.env.example`, `compose.dev.yml`, `assistant.e2e-spec.ts` |
| 2 | Gateway per-route `bodyLimit: 262144` for `POST /api/v1/assistant/chat` (an `onRoute` hook in `create-app.ts`); a 400 KB body returns 413 and never reaches the upstream. zod bounds kept | `create-app.ts`, gateway e2e |
| 3 | When the assistant is enabled, startup probes the JWKS and logs one warning if it is unreachable or has no RSA keys, naming `JWT_ACCESS_ALG=RS256` (no secrets). **RS256 requirement:** identity must sign access tokens with `JWT_ACCESS_ALG=RS256`; HS256 tokens (the dev default) are rejected by ai-service. Documented in `.env.example` | `user-jwt-verifier.ts` (`check()`), `main.ts` |
| 4 | JWKS fetch is rejected early when `content-length` exceeds 64 KiB, before reading the body | `user-jwt-verifier.ts` |
| 5 | A string node `error` is mapped to `errorMessage` instead of nulls | `tools.ts` |

### Caller confirmation (`git grep`, edited existing symbols)

| Symbol / file | Callers found | Effect of my change |
| --- | --- | --- |
| `AiDeps` (`ai-deps.ts`) | `ai.module.ts`, `app.ts`, `ai.controller.ts`, `health.controller.ts`, `main.ts` (builds it), `test/ai.e2e-spec.ts` | Optional `assistant` field added: no caller changes needed |
| `main.ts` wiring | entry point only | Assistant deps built only when the flag is on; JWKS probe is fire-and-forget |
| `loadAiConfig` / `AiConfig` | `main.ts`, `test/ai.e2e-spec.ts`, `ai-deps.ts` | New vars all have defaults; existing parse unchanged |
| `AiModule` | `app.ts` only | Extra controller only when `AI_ASSISTANT_ENABLED` |
| `GatewayThrottlerGuard` | `rate-limit.module.ts` (APP_GUARD) | OCR behaviour unchanged; assistant path gets a subject tracker |
| `validateGatewayEnvironment` / `GatewayConfig` | `app.module.ts`, `gateway.config.spec.ts` (expected `limits` updated), guards via `ConfigService` | New `assistantPerMinute` with default |
| `AppModule` | `create-app.ts` only | `AssistantModule` imported |
| `createApp` | gateway `main.ts` and 6 e2e specs | `onRoute` hook only matches the assistant route |
| `tsconfig.build.json` | used implicitly by `nest build` (no explicit reference found in `nest-cli.json`, Dockerfiles or scripts) | Excludes `scripts/`; `dist` layout unchanged (verified by build) |

### Deferred to week 3 (skipped on purpose)

- Flag-off answers 400 instead of 404: `AiExceptionFilter` maps every error below 500 to 400 on purpose.
- JWKS stale-key expiry when identity is down (cached keys keep verifying; there is no hard expiry).
- Token revocation (the token is checked once at stream start).
- `ToolCallAccumulator` when parallel calls omit `index` (treated as 0 and merged).
- Wording of the `UNAUTHENTICATED` message ("Service authentication is required.") for user-token callers.

### Round 1 evidence

| Check | Result |
| --- | --- |
| `pnpm --dir services/ai-service test` | 10 suites, 126 tests pass |
| `pnpm --dir services/ai-service run test:e2e` | 2 suites, 37 tests pass |
| `pnpm --dir services/api-gateway test` | 9 suites, 111 tests pass |
| `pnpm --dir services/api-gateway run test:e2e` | 7 suites, 96 tests pass |
| both `run build` | PASS |
| `eslint` on touched production files (both services) | clean |
