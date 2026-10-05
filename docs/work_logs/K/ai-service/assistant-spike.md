# AI assistant tool-calling spike (Week 2, Lane D)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Branch | `feat/assistant-spike` (from `staging`), merged into `staging` (d3e75bf) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`. Verified with fakes plus a live DeepSeek check (section 6); full-stack run (real identity RS256 token, real workflow-service shapes, compose) not done |
| Scope | ai-service `POST /v1/assistant/chat` (SSE) with DeepSeek tool calling and two read-only tools, user-token verifier, gateway SSE route. No `ai_db`, no conversation storage |

## 2. Summary

- `POST /v1/assistant/chat` in ai-service, behind `AI_ASSISTANT_ENABLED` (default `false`). Body `{workspaceId, messages[1..20 x 1..4000 chars]}`, last message must be the user's. Response `text/event-stream`: `delta {text}`, `tool_call {name, arguments}`, `tool_result {name, ok}` (no data echoed), `done {}`, `error {code, message}`.
- Auth: new `UserJwtVerifier` verifies identity RS256 access tokens against identity's JWKS (issuer, audience, RS256 only, kid lookup, clock tolerance, the gateway's required claims, `token_use=access`, `user_status=ACTIVE`). Service JWTs and user tokens are mutually rejected.
- Tools (`list_workflows`, `explain_run_failure`) call workflow-service's public API with the **caller's own** `Authorization` header. 403/404 become `{error: "not_found_or_forbidden"}`; other failures `upstream_error`; no upstream text reaches the model.
- `DeepSeekChatProvider` (OpenAI-compatible `/chat/completions`, `tools`, `stream: true`) with a `ToolCallAccumulator` for split tool-call deltas; the loop allows 3 tool rounds, then one more call without tools.
- Gateway `POST /api/v1/assistant/chat`: normal access-token guard, own `assistant` throttler per user, 256 KiB body cap, upstream body piped to the client without buffering or compression.
- Review: 1 security round (no CRITICAL/HIGH); separate admission pool, gateway body cap, JWKS startup probe and size check, string `error` mapping.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| `explain_run_failure` takes `{workflowId, executionId}` | The execution endpoint is `/workspaces/{ws}/workflows/{wf}/executions/{id}`; no execution-by-id route. The model gets `workflowId` from `list_workflows` |
| No `jose`: verifier uses `node:crypto` plus a fetched, cached JWKS (10 min TTL, one refetch per 30 s on unknown kid, 3 s timeout, 64 KiB cap checked early via `content-length`, fails closed). At startup with the flag on, a fire-and-forget probe logs one warning if the JWKS is unreachable or has no RSA keys, naming `JWT_ACCESS_ALG=RS256` | No new dependency; mirrors `ServiceJwtVerifier` |
| RS256 only. Dev compose signs user tokens with HS256 by default (`JWT_ACCESS_ALG`); the assistant needs identity on RS256 (see `docs/work_logs/K/identity/rs256-access-tokens.md`) and `JWT_JWKS_URI` reachable from ai-service. Documented in `.env.example` | Spec says "verified via identity's JWKS"; putting `JWT_ACCESS_SECRET` into ai-service would widen the secret's reach |
| Env: shared with the gateway `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CLOCK_SKEW`, `JWT_JWKS_URI` (default `http://identity-service:8080/.well-known/jwks.json` in compose). New: `AI_ASSISTANT_ENABLED`, `AI_WORKFLOW_API_URL`, `AI_ASSISTANT_MAX_TOKENS` (1024), `AI_ASSISTANT_RATE_LIMIT_PER_MINUTE` (20), `AI_ASSISTANT_MAX_CONCURRENT` (4); gateway `GATEWAY_ASSISTANT_RATE_LIMIT` (20) | Reuse |
| Flag off = controller not registered (module level), so the route behaves like any unknown route: today **400 `INVALID_REQUEST`**, not 404, because `AiExceptionFilter` maps every `HttpException < 500` to 400. One-line fix in the filter if a real 404 is wanted (outside this lane) | Cannot leak the route |
| Auth order: user token (401), then provider configured (503 `AI_NOT_CONFIGURED`), then body (400), then limits (429 `AI_BUSY`). Errors before the stream starts are JSON; after it starts they are an `error` event with a stable `AiError` code | Config state not revealed to unauthenticated callers |
| Limits: per-user fixed-window counter (`FixedWindowLimiter`, in-memory per replica) plus `Admission.tryAcquire("user:<id>")`; the assistant has its **own** `Admission` pool (`AI_ASSISTANT_MAX_CONCURRENT`, per-user cap reuses `AI_MAX_CONCURRENCY_PER_WORKSPACE`) so chat streams cannot starve service-JWT routes (tested); output capped by `AI_ASSISTANT_MAX_TOKENS`; deadline is `AI_REQUEST_TIMEOUT_MS` (also aborted on disconnect) | A distributed limiter comes in week 3 with quota |
| `CircuitBreakerProvider` is not used | It wraps `LlmProvider.completeJson`, a different shape; generalise in week 3 |
| Prompt-injection stance: system prompt says tool results are untrusted data; each result goes to the model as `{"untrusted_data": ...}` in the `tool` message; tools project whitelisted fields only (workflows: id, name 120 chars, status, updatedAt; run: status, timestamps, failed node id/type/attempts/timestamps, error code, message 300 chars; a string node `error` maps to `errorMessage`); results capped at 16 KB; at most 4 tool calls per round; arguments validated with zod `.strict()` and ids must be UUIDs | Spec rules 1-3 |
| Gateway streams with `reply.send(Readable.fromWeb(upstream.body))` (not `reply.hijack()`); sets `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; per-route `bodyLimit: 262144` via an `onRoute` hook in `create-app.ts` (400 KB gets 413, never reaches upstream); upstream failures map to 400/401/404/413/429/503, else 502, never relaying upstream text | Fastify pipes chunk by chunk and keeps security/CORS/request-id headers; same policy as the other proxies |
| `tsconfig.build.json` excludes `scripts/` | A `scripts/` file importing `../src` would move the build `rootDir` and change `dist/main.js` to `dist/src/main.js` |

## 4. Changed files

| Area | Files |
| --- | --- |
| ai-service new | `application/assistant/` (`chat-provider.ts`, `chat.ts`, `tools.ts`, `system-prompt.ts`), `infrastructure/llm/deepseek/deepseek-chat-provider.ts`, `infrastructure/auth/user-jwt-verifier.ts`, `infrastructure/fixed-window-limiter.ts`, `presentation/http/assistant.controller.ts`, `scripts/assistant-live-check.ts`, 3 spec files, `test/assistant.e2e-spec.ts`, `test/support/scripted-chat-provider.ts` |
| ai-service edited | `config/ai-config.ts` (new env vars), `ai.module.ts` (controller only when flag on), `ai-deps.ts` (optional `assistant` field), `main.ts` (wiring, JWKS probe), `tsconfig.build.json`, `README.md` |
| api-gateway | new `assistant/assistant.module.ts` and `test/assistant.e2e-spec.ts`; edited `app.module.ts`, `config/gateway.config.ts` (`assistantPerMinute`) and its spec, `rate-limit/rate-limit.module.ts`, `gateway-throttler.guard.ts` (`assistant` throttler, per-user tracker), `create-app.ts`, `README.md`, `docs/specs/services/api-gateway.md` |
| Config | `compose.dev.yml`, `.env.example` (new vars appended in the ai-service and gateway blocks) |

## 5. SSE and proxy behaviour

- ai-service writes the stream on the raw socket after `reply.hijack()`: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; each event `event: <name>\ndata: <json>\n\n`, written as soon as it exists.
- Client disconnect: the request signal aborts the DeepSeek fetch and any tool fetch; the loop stops silently and the per-user slot is released in `finally` (verified in ai-service and gateway e2e).
- Gateway: first SSE event reaches the client while the upstream is still open (tested); no `Content-Encoding` even with `Accept-Encoding: gzip, br`. Gateway deadline for the stream is 75 s (ai-service 60 s).
- Known limit: if the upstream dies mid-stream the gateway cannot send an `error` event (headers already out); the client sees a truncated stream. ai-service itself always ends with `done` or `error`.
- Proxies in front of the gateway must not buffer: `X-Accel-Buffering: no` covers nginx; a CDN may need its own setting (week 3 deployment check).

## 6. Evidence

| Check | Command | Result |
| --- | --- | --- |
| ai-service unit | `pnpm --dir services/ai-service test` | 10 suites, 126 tests pass |
| ai-service e2e | `pnpm --dir services/ai-service run test:e2e` | 2 suites, 37 tests pass |
| api-gateway unit | `pnpm --dir services/api-gateway test` | 9 suites, 111 tests pass |
| api-gateway e2e | `pnpm --dir services/api-gateway run test:e2e` | 7 suites, 96 tests pass |
| Builds | `run build` in both services | PASS |
| Lint | `pnpm --dir <service> exec eslint <production files>` | clean; new spec/e2e files keep the strict-type noise the old specs already have (61 errors) |
| Live DeepSeek check | `scripts/assistant-live-check.ts` (below) | 2 tool calls assembled from 67 streamed fragments, both tools ok; first event 660 ms, first `tool_call` 990 ms, `done` 2.3 s. Confirms streamed tool-call deltas, the tool loop and SSE emission against the real provider |
| GitNexus / `git grep` callers | `AiDeps`, `main.ts`, `loadAiConfig`, `AiModule`, `GatewayThrottlerGuard`, `GatewayConfig`, `AppModule`, `createApp`, `tsconfig.build.json` | All additive (optional field, defaults, route-specific hook); `dist` layout unchanged (verified by build) |

Live check (about 2 small DeepSeek calls, canned tool data, max 2 tool rounds, `max_tokens` 400, 60 s timeout, never prints the key):

```powershell
$env:DEEPSEEK_API_KEY = '<key>'; $env:DEEPSEEK_MODEL = '<model>'   # optional: $env:DEEPSEEK_BASE_URL
pnpm --dir services/ai-service exec ts-node scripts/assistant-live-check.ts
```

Expected: `tool_call > tool_result > ... > delta > done`, fragments greater than the number of calls, `assembled OK: yes`.

Not verified: a real identity RS256 token, the real workflow-service response shape for `nodes[].error` (taken from `openapi.yaml`) and for the workflow list (`items[].workflowId|id, name, status, updatedAt`; `WorkflowSummary` is `additionalProperties: true`, confirm `name` and `updatedAt`), compose end to end.

## 7. Full-stack live test (open)

1. Identity on `JWT_ACCESS_ALG=RS256`, `AI_ASSISTANT_ENABLED=true`, DeepSeek key and model set, `compose.dev.yml` stack up (ai-service, workflow-service, gateway).
2. `POST http://localhost:3000/api/v1/assistant/chat` with `Authorization: Bearer <user token>` and `{"workspaceId":"<ws>","messages":[{"role":"user","content":"Which workflows do I have?"}]}`, `curl -N` to watch events arrive.
3. Expect `tool_call` (`list_workflows`), `tool_result ok:true`, `delta`s, `done`. Repeat with a failed run id (`explain_run_failure`). With another user's workspace: `tool_result ok:false` and the model says it could not read it.

## 8. Risks and week 3 follow-ups

- **Conversation history:** the client sends the whole history each turn (max 20 x 4000 chars). Week 3: `ai_db` `conversations`/`messages`, retention purge, server-side truncation, a title.
- **Quota sharing with AI-2:** chat bypasses workflow-service, so per-workspace daily quota and counters need a home in `ai_db` (or a call to workflow's counter); the per-user limiter is per replica and in-memory.
- **Prompt cost:** each turn re-sends tool specs and history; DeepSeek context caching may help; measure.
- **Write tools** (create/run workflow) are not in the spike; spec rule 1 requires propose-then-confirm in the UI.
- **Mobile/web client:** `fetch` + `ReadableStream` works on web; React Native needs a polyfill or SSE library; EventSource cannot send `Authorization`.
- **Token expiry mid-stream:** the user token is checked once at the start; tools reuse it for up to 60 s (access tokens last 15 min), so a revoked session can still read for that window; revocation is not checked.
- **Reasoning models:** `reasoning_content` deltas are ignored by the adapter.
- **Deferred small items:** flag-off status 400 vs 404 (`AiExceptionFilter`); JWKS stale-key expiry when identity is down (cached keys keep verifying); `ToolCallAccumulator` treats parallel calls without `index` as 0 and merges them; the `UNAUTHENTICATED` message ("Service authentication is required.") is misleading for user-token callers.

## 9. Next steps

1. Run the full-stack test in section 7.
2. Week 3: `ai_db`, conversation storage, quota, write-tool proposals, `build` capability, web/mobile clients.
