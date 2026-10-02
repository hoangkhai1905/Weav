<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Weav** (12254 symbols, 29228 relationships, 484 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/Weav/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Weav/clusters` | All functional areas |
| `gitnexus://repo/Weav/processes` | All execution flows |
| `gitnexus://repo/Weav/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Weav Project Guidance

> Keep this section identical in `CLAUDE.md` and `AGENTS.md`. The GitNexus block above is generated; do not edit it by hand.

## What Weav is

Weav is a graduation-thesis platform for automating and monitoring work processes, with a Zapier/n8n-style experience for working professionals, on web and mobile. If this file and the code disagree, the code, package manifests, and compose files win; fix this file.

## Repository map

| Path | Stack | Verify with |
| --- | --- | --- |
| `apps/web` | React + Vite | `pnpm --dir apps/web exec tsc --noEmit`, `pnpm --dir apps/web build`, `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium` |
| `apps/mobile` | React Native + Expo | `npx tsc --noEmit -p .` (from `apps/mobile`); no unit test script |
| `services/identity-service`, `workspace-service`, `workflow-service` | Spring Boot | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (from the service folder) |
| `services/api-gateway`, `ai-service`, `bot-service`, `notification-service` | NestJS | `pnpm --dir <path> test`, `test:e2e`, `build` |
| `services/ocr-service` | FastAPI (uv) | `uv run pytest` (from the service folder) |
| `packages/contracts`, `shared`, `workflow-schema` | Shared contracts and generic utilities only | consumers' tests |

- Package manager: `pnpm@11.22.0` (from `package.json`). In a fresh checkout or worktree, run `pnpm install --frozen-lockfile` first.
- Dev stack: `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build [services]`. Overlays: `compose.ai-local.yml` (fake AI provider), `compose.workflow-smoke.yml`, `compose.*ocr*.dev.yml`.
- Database: Neon PostgreSQL, project `Weav`, branch `production`. One database per service (`identity-db`, `workspace_db`, `workflow_db`, `notification_db`); each service uses the schema named by its `DB_SCHEMA`.
- Docs: specs and plans in `docs/superpowers/`, architecture/API/decisions under `docs/`, work logs under `docs/work_logs/`.

## Boundaries

- Each service owns its domain model, schema, migrations, and business rules. Never read or write another service's tables.
- Cross-service calls go through a documented HTTP contract (`packages/contracts`) or a message-broker event.
- Shared packages hold contracts, schemas, clients, and generic utilities, never service business logic.
- Changes to public APIs and persisted data are additive by default. Do not rename or drop data, break a contract, or remove compatibility behavior without a migration/rollback plan and the user's explicit confirmation.
- The user owns the whole backend, API Gateway and notification-service included. Only `services/ocr-service` belongs to the partner; request OCR changes as a documented handoff instead of implementing them.

## How to work

1. Read this file, the relevant service docs, the feature's work log, and `git status` before changing anything.
2. Diagnose the concrete error or requirement first. For non-trivial work, state scope, acceptance criteria, risks, and how you will verify, and use brainstorming/writing-plans when there are real design alternatives or several steps.
3. Run GitNexus upstream impact before editing an existing symbol (see the block above). Warn the user on HIGH/CRITICAL risk. Treat `UNKNOWN` or "not found" as unresolved: confirm callers with a text search and say so. The index can be stale on new branches.
4. Make the smallest safe change that meets the requirement. Reuse existing code, prefer the standard library, keep diffs minimal, and leave one runnable check for non-trivial logic. Never trade away validation, security, accessibility, logging, error handling, or tests for brevity.
5. Test the affected packages (see the repository map), then build. If a contract, event, schema, auth rule, or response shape changes, add or update an integration or contract test.
6. Verify user-facing web behavior in the real running app with Playwright, including console and network errors. A mock, build, or snapshot alone does not prove a UI flow works.
7. Review the diff, run `git diff --check`, update the work log, and run GitNexus `detect_changes` before committing.

Refactoring is allowed when it clearly improves correctness, maintainability, or performance, but keep it bounded, behavior-preserving, tested, and separate from unrelated fixes. For performance work, measure a baseline and the bottleneck first; never claim a speedup from intuition or a build alone.

## Environment facts that save time

- **Lint scripts that rewrite files.** The NestJS services' `lint` scripts run `eslint --fix` and reformat code. To check lint without changing files, run `pnpm --dir <service> exec eslint "{src,test}/**/*.ts"`. `apps/web` `lint` is plain `eslint .`.
- **Maven time zone.** On Windows, forked JVMs inherit `Asia/Saigon`, which Postgres Testcontainers reject; always set `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`. A shell `TZ=UTC` does not reach the JVM.
- **Known environment-only test errors** (anything else is a regression):
  - workflow-service `HttpTransportIntegrationTest` x2: TLS test certificate missing.
  - workflow-service `WorkflowNotificationLifecyclePersistenceIntegrationTest.compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox`: needs a built `services/notification-service/dist`.
  - identity-service Avatar integration tests x3: the `minio/minio:RELEASE.2024-06-04T19-20-08Z` image can no longer be pulled from Docker Hub.
- **Playwright.** Specs that stub the backend with `page.route` (for example `workspace-connections.spec.ts`) need `VITE_API_MODE=http`, the default in `apps/web/.env.example`. `mock` swaps the API clients for in-app demo data, so the route stubs never fire. The full suite was already red on `dev` (stale text and demo-data assertions) as of 2026-10-02. The live AI generation case also needs `AI_E2E=1` and the Gateway generate route.
- **Local web against the real stack.** Run Vite on `localhost:5173`; the Gateway's CORS allow-list does not include other ports.
- **AI Service.** Off by default. To enable: `node scripts/ai-dev-keys.mjs` (writes `tmp/service-keys/public/` and `private/`), set `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` in `.env`, set `WORKFLOW_AI_ENABLED=true` and `WORKFLOW_AI_GENERATION_ENABLED=true`, then start the stack without `compose.ai-local.yml`. Check `curl http://localhost:3001/health/ready`.
- **Windows long paths.** Deleting a folder that contains `node_modules` can fail with "Filename too long"; remove it with `cmd /c rd /s /q \\?\<absolute path>`.

## Infrastructure and data (Neon, Cloudflare R2)

- Our laptops have limited resources. Do not create local databases, object storage, or other infrastructure: use Neon for PostgreSQL and Cloudflare R2 for object storage (S3-compatible; see the `AVATAR_S3_*` settings in `.env.example`).
- Start containers only when a task needs them (the Compose dev stack, Testcontainers in tests). When done, stop or remove the containers you started and delete any images and volumes you built or created for a one-off check. Leave the user's other containers alone.
- Never change another service's schema, and never run destructive SQL without the user's confirmation.
- Before destructive SQL: list what exists, check dependencies (foreign keys, views, `pg_depend`), confirm the service configs do not use the target, create a Neon backup branch, then act on exact names, never patterns.
- Tests and smoke scripts that create throwaway schemas or accounts (for example `scripts/start-workflow-v1-live-smoke.ps1` creates `weav_workflow_smoke_*` schemas) must clean up after themselves, or record what they left behind in the work log.

## Logging, secrets, and security

- Use each framework's logger with request/correlation context. No `console.log` in production code.
- Never log, paste, or commit passwords, tokens, JWTs, API keys, cookies, private keys, connection strings, `.env` contents, or unnecessary personal data. When you must check a secret, check only that it is set, not its value.
- Never commit `.env`, `tmp/`, keys, build output, or test artifacts. If you add a variable to `.env`, add it with a placeholder to `.env.example`.
- Validate input at service boundaries, keep authorization checks, and apply rate and size limits to expensive work such as AI, OCR, and workflow execution.

## Work logs

- One log per feature or area, updated in place: `docs/work_logs/<member>/<area>/<feature>.md` (member folders `K/` and `T/`), using `docs/work_logs/log_template.md`. Do not create a new file for every session; extend the feature's existing log.
- Record decisions, changed files, commands with one-line results, runtime/browser evidence, risks, blockers, and next steps. Keep it short and reproducible, mark what is done, in progress, or blocked, and redact all secrets.

## Git and collaboration

- Branch from `dev` for features and fixes. `dev` is the integration branch; `main` lags behind it.
- The team merges into `dev` directly with `git merge --no-ff` (merge commit named "Merge branch '<branch>' into dev"); there are no pull requests. Merge only reviewed, tested work.
- Commit in small logical batches or at tested milestones, with a summary and a description (`git commit -m "summary" -m "description"`). Report each commit briefly so the user can push. Never include unrelated user changes.
- This is a two-person project: a branch per feature is enough. Do not create worktrees unless the user asks for parallel agent work. When they do, give each lane its own branch and worktree with disjoint file ownership (no two agents edit the same file at once), coordinate the agents through Orca, have a different agent review each lane, merge only after review and verification, and remove the worktrees and merged branches afterwards.
- Never use bare `git stash`/`git stash pop` (the stash is shared across worktrees); prefer a temporary WIP commit.

## Communication

- If a worker or managed runner reports `helper_unknown_error: setup refresh had errors`, stop and wait for the user. It is an environment problem, not a source bug; do not retry or work around it.
- Keep progress updates short. If something is unclear or unverified, ask; never present an assumption as a fact.

## Skills

Use only skills relevant to the task; if one is unavailable, say so and use the closest fallback. Route stack work to `react-patterns`/`react-testing`/`react-performance` (web), `react-native-patterns` (mobile), `springboot-patterns`, `nestjs-patterns`, `fastapi-patterns`, `docker-patterns`, and `postgres-patterns` with `database-migrations`. Use the GitNexus skills for exploration, impact, debugging, and refactoring; `parallel-execution-optimizer`/`dispatching-parallel-agents` for independent lanes; and `verification-before-completion` before claiming done.

## Before reporting completion

- The requested behavior or document exists, and existing behavior and service boundaries are preserved.
- Relevant tests and builds pass (known environment-only errors named), and user-facing web changes were checked in the running app.
- `git diff --check` is clean, GitNexus `detect_changes` ran before any commit, and the work log is updated without secrets.
- Remaining risks, skipped checks, and next steps are stated plainly.
