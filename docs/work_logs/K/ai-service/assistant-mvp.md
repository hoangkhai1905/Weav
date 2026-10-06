# AI assistant MVP (Week 3)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-06 (Asia/Saigon) |
| Branches | `feat/generator-switch`, `feat/assistant-store`, `feat/assistant-tools` (phase 1), `feat/assistant-wiring`, `feat/assistant-gateway` (phase 2); all from `staging`, merged into `staging` (cd8236c, 4978ad8, bedbbfd, 6fe9e33, 1b37adf) |
| Owner | K / Sonnet workers per lane, a different agent reviewed each lane, coordinator re-ran checks and committed |
| Status | Done. Live test `scripts/live-test-nodes.ps1 -Flow assistant -Cleanup` passed 2026-10-06 against the real stack (reported by K) |
| Scope | Spec `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md` section 3; builds on `assistant-spike.md` |

## 2. Summary

- **Storage:** Neon `ai_db` (schema `ai`), Prisma 7 + adapter-pg like notification-service. Tables `conversations`, `messages` (user text and final assistant text only), `assistant_usage` (day, workspace, user, calls). History is **per user**. Retention purge: conversations after 30 days, usage rows after 90 days; the first run is 10 s after start, then hourly.
- **Chat** `POST /v1/assistant/chat` (gateway `/api/v1/assistant/chat`):
  - Body `{workspaceId, conversationId?, message, timezone?}`.
  - SSE `conversation` comes first, then `delta` / `tool_call` / `tool_result` / `draft`, then `done` or `error`.
  - The model gets the last 20 messages or 24,000 characters.
- **History routes:** list conversations, messages (latest 100), delete. All are owner-filtered; a foreign or missing id gives 404.
- **Tools** (read-only, caller's own token, whitelisted fields, `{"untrusted_data": ...}`):
  - From the spike: `list_workflows`, `explain_run_failure`.
  - `list_failed_runs_today`: fans out over 20 workflows x 20 runs, 4 in flight, using the calendar day in the caller's timezone; capped at 40 runs.
  - `list_members`: name, role and capabilities; no email.
  - `build_workflow`: calls workflow-service `/generate`. The full draft goes to the client as a `draft` event and is never saved; the model sees only status, name and node types.
- **Generator:** `logic.switch` is re-enabled. Ports are checked per source node: condition true/false, switch cases or `default`, no port otherwise.
- **Limits** (pre-stream order): auth, provider and store, body, per-user rate, admission, **workspace membership** (workspace-service `GET /workspaces/{id}` with the caller's token, 60 s cache), per-workspace rate, conversation ownership, daily quota (50 per user, 200 per workspace). History routes have their own per-user limit.
- **Spike fixes:**
  - Flag off gives 404; only unmatched routes map to `NOT_FOUND`, and service routes are unchanged.
  - JWKS stale keys stop verifying after `AI_JWKS_MAX_STALE_MS`.
  - User routes say "Authentication is required."
  - A deadline abort during a tool call ends with `error AI_TIMEOUT`.
  - The tool-call accumulator keys calls by id.
- **Gateway:**
  - New body schema and history proxies.
  - Allow-listed upstream error codes pass through with static messages, so 429 `AI_BUSY` and `AI_QUOTA_EXCEEDED` can be told apart. 5xx still become `SERVICE_UNAVAILABLE` (gateway filter).
  - JSON relay is capped at 64 KiB in bytes.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| `ai_db` on `production`; K's `.env` points at Neon branch `dev-k` (copy of production, incl. `ai_db`) | The partner's older stack shared `workflow_db` and stole runs (`docs/work_logs/K/workflow/core-logic-nodes.md` section 9). Data and accounts now diverge between the two branches |
| Prisma, migrations run manually (`pnpm --dir services/ai-service db:migrate`, `AI_MIGRATION_URL` must carry `schema=ai`) | Same as notification-service |
| History per user; no assistant on mobile in V1 | Simpler owner check and privacy; RN SSE needs a polyfill |
| Spike `messages[]` body replaced, not kept | No client used it and the flag was off |
| Membership check before any quota or storage write; workspace limiter after it | Otherwise a non-member could burn another workspace's quota or rate budget |
| User message stored before the model call; the assistant reply only on success; quota not refunded on provider failure | Simple and predictable; a failed turn leaves only the user's message |
| "Failed today" fans out from ai-service | No workspace-level executions endpoint; ceiling marked with `ponytail:` |
| Gateway assistant paths in a new `packages/contracts/http/gateway/assistant.openapi.yaml` | `workspace.e2e-spec.ts` pins `gateway/openapi.yaml` to the workspace operations |
| Malformed path id: gateway 400, ai-service 404 | Gateway route style; both documented |

New env (all in `.env.example` with defaults; K's `.env` has the DB block):
- Storage and retention: `AI_DB_*`, `AI_MIGRATION_URL`, `AI_ASSISTANT_RETENTION_DAYS`, `AI_ASSISTANT_USAGE_RETENTION_DAYS`.
- Upstream: `AI_WORKSPACE_API_URL`.
- History bound: `AI_ASSISTANT_HISTORY_MESSAGES`, `AI_ASSISTANT_HISTORY_CHARS`.
- Limits and quota: `AI_ASSISTANT_WORKSPACE_RATE_LIMIT_PER_MINUTE`, `AI_ASSISTANT_DAILY_USER_LIMIT`, `AI_ASSISTANT_DAILY_WORKSPACE_LIMIT`, `AI_ASSISTANT_HISTORY_RATE_LIMIT_PER_MINUTE`.
- JWKS: `AI_JWKS_MAX_STALE_MS`.

## 4. Evidence (coordinator re-runs)

| Check | Result |
| --- | --- |
| ai-service unit / e2e / build (merged staging 1b37adf) | 186 / 75 pass, build OK |
| ai-service integration (throwaway Postgres `test/compose.yml`, removed afterwards) | 12/12 |
| api-gateway unit / e2e / build (merged staging) | 111 / 117 pass, build OK. **Flaky:** 2 of about 16 e2e runs had 1 failure, both on the first run after an install or a change; not reproduced in 14 later runs and the test name was not captured |
| workflow-service `mvnw verify` (generator-switch lane) | 680 tests, 0 failures, 1 known env-only error (needs a built notification-service dist) |
| Reviews | One reviewer per lane (code, DB, security, TS). No CRITICAL/HIGH; MEDIUM findings fixed before merge |
| GitNexus `detect_changes` per lane | All low risk, 0 affected processes |
| Impact warnings | `AiExceptionFilter` CRITICAL and `createAiApp` HIGH (real, global): changed narrowly, and an e2e proves service routes keep 400 `INVALID_REQUEST`. `runTool`, `ToolCallAccumulator`, `AiDeps`, `UserJwtVerifier` CRITICAL were name collisions with Java and mobile code; git grep shows ai-service callers only |

## 5. Live test (K)

1. **Migrate `ai_db` on dev-k:** `pnpm --dir services/ai-service db:migrate`. It reads `AI_MIGRATION_URL` from the environment, so load `.env` first or run it inside the ai-service container.
2. **Set up the stack:**
   - Set `AI_ASSISTANT_ENABLED=true` in `.env`.
   - Restart the stack. A restart also moves it onto dev-k.
   - Identity must be on RS256 (`.env` already has `JWT_ACCESS_ALG=RS256`).
3. **Run the flow:** `.\scripts\live-test-nodes.ps1 -Flow assistant -Cleanup`. It asks for `yes` and makes about 4 chats (8-12 small DeepSeek calls). Steps:
   - list, failed today and members, with no email in the stream;
   - a switch draft;
   - history list and messages;
   - a foreign workspace giving 404;
   - cleanup.
   A FAIL on a tool-name check can be the model's choice, not a bug.

**Live test result (2026-10-06): passed** (reported by K).
- **Setup:** `ai_db` migrated on dev-k (`202610060001_assistant_store`; schema `ai` has `conversations`, `messages`, `assistant_usage`, `_prisma_migrations`). Stack started without ocr-service.
- **Real providers:** identity RS256 JWKS (1 RSA key), real DeepSeek.
- **Earlier failed start:** the first `compose up` failed in the ai-service image `pnpm install`. Most likely a registry timeout during parallel builds; the actual pnpm error line was not captured. Rebuilt without changes.

## 6. Risks and next steps

- **Frontend (partner):** chat UI and draft review/save are needed. Rule 1 of the spec, explicit confirmation, lives in the UI. The contract is in `packages/contracts/http/gateway/assistant.openapi.yaml`.
- **Per-replica state:** limiters and the membership cache are in memory per replica. Daily quota is in the DB.
- **Proxies:** must not buffer SSE (`X-Accel-Buffering: no`); check this on the demo deployment.
- **Gateway e2e flake:** investigate (timing on a cold start).
- **Model quality:** tool choice with five tools is only tested with fakes; the live test is the first real check.
