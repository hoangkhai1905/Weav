# API Gateway Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a compatible, verified NestJS public Gateway for existing Identity, Workspace, Notification and OCR APIs.

**Architecture:** Explicit Nest/Fastify routes with shared configuration, edge JWT verification, correlation and limits. Preserve existing proxy contracts; Workspace remains the authorization owner. Add operational endpoints and Fastify integration tests.

**Tech Stack:** Node 24; pnpm 11.22.0; NestJS 11; Fastify 5; jose 6; Zod 4; Throttler 6; Terminus 11; Jest.

**Spec:** `docs/superpowers/specs/2026-09-16-api-gateway-service-design.md` (read it with this plan).

## Global constraints

- Baseline `00cc5f8` on `api-gateway`; recheck HEAD and scoped dirty files before execution.
- Main agent orchestrates/reviews; GPT-5.6 Luna `max` implements. The user selected this workflow; do not ask them to select an execution mode again.
- One Luna implementation task at a time; main agent alone owns integration and documentation. Parallel read-only reviews may inspect separate concerns.
- Isolated worktree for implementation; preserve all unrelated staged/unstaged work. No push or merge without a separate integration decision.
- Graph impact before any existing-symbol edit. UNKNOWN needs corroboration; HIGH/CRITICAL must be reported before editing. Complete detect-changes before a commit.
- Stop immediately on `helper_unknown_error: setup refresh had errors`; do not retry/work around it.
- Keep existing API/data contracts. No business authorization, database access or client migration in Gateway.
- No secret values in prompts, fixtures, logs or committed files. Use ephemeral test JWT keys only.
- User approved execution on 2026-09-16. Implementation progress is recorded separately from planning completion.

## Task 0: Establish isolated baseline and graph tooling

**Ownership:** controller; no product code edits.

- [ ] Read worktree skill, create `codex/api-gateway-v1` in an isolated worktree from the recorded current HEAD; do not move the dirty checkout to the new branch.
- [ ] Read current AGENTS, service docs, this spec/plan and work log in that worktree. Check Node/pnpm/resolved dependency versions.
- [ ] Restore or bootstrap GitNexus per AGENTS. Discover CLI help and index status before relying on command output. Do not substitute text search for graph availability.
- [ ] Record baseline test/build results with the commands below. Existing E2E is a starter using the default adapter; record its result separately and replace it with Fastify coverage in Task 1.

```powershell
pnpm --dir services/api-gateway test -- --runInBand
pnpm --dir services/api-gateway build
pnpm --dir services/api-gateway test:e2e -- --runInBand
```

**Gate:** verified workspace path, graph ready, baseline recorded. Setup failures are distinguished from source failures. If graph cannot run, complete only read-only review and report the blocker.

## Task 1: Validated bootstrap and actual Fastify test harness

**Files:** create `services/api-gateway/src/config/gateway.config.ts`, `src/config/gateway.config.spec.ts`, `src/create-app.ts`; modify `src/main.ts`, `src/app.module.ts`, `test/app.e2e-spec.ts`, `compose.dev.yml`, `.env.example` only as needed. All service-relative paths refer to `services/api-gateway/`.

**Interfaces:** `validateGatewayEnvironment(env: Record<string, unknown>): GatewayConfig`; `createApp(): Promise<NestFastifyApplication>` constructs/configures an app without listening. `main.ts` owns listen. Config carries validated port, upstream URLs, JWT settings, CORS and limits; secrets are never serialized.

- [ ] Run impact on bootstrap/AppModule and existing symbols to be modified; report callers/processes/risk.
- [ ] Add red config tests: missing/short JWT secret, credential-bearing/non-HTTP upstream URL, invalid port/skew, unsafe production bypass; valid development and production inputs. Test exact 32-byte UTF-8 boundary, not character count.
- [ ] Create a Fastify E2E harness with app close/cleanup. Establish a passing root compatibility and CORS regression case.

```ts
const app = await createApp();
await app.init();
await app.getHttpAdapter().getInstance().ready();
const response = await app.inject({ method: 'GET', url: '/' });
expect(response.statusCode).toBe(200);
await app.close();
```

- [ ] Implement validated config using Zod and bootstrap extraction. Wire access JWT env names into Gateway Compose; preserve port 3000 and Docker service URLs. Use nonsecret dummy values in isolated test environments.
- [ ] Run config tests, unit suite, E2E and build; render Compose with `config --quiet` against the project's actual compose files so resolved secrets never print.

**Gate:** startup fails safely for bad configuration; test harness exercises Fastify and shared production bootstrap.

## Task 2: Correlation and safe shared transport behavior

**Files:** create `src/common/request-context.ts`, `src/common/request-context.spec.ts`, `src/common/gateway-exception.filter.ts`, `src/common/gateway-exception.filter.spec.ts`; modify `src/create-app.ts`; update existing adapters only where required for correlation/header policy. Create `test/transport.e2e-spec.ts`.

**Interfaces:** `resolveRequestId(headers: Record<string, unknown>): string` implements spec precedence/validation; gateway-owned error shape `{error:{code:string,message:string,details:unknown[]},requestId:string}`. Existing upstream business responses pass through unchanged.

- [ ] Run impact for each existing symbol before editing.
- [ ] Write failing tests for ID precedence, empty/overlong/control-character IDs, both response headers, allowed/disallowed CORS origins and exposed headers.

```ts
expect(resolveRequestId({ 'x-request-id': 'req-123', 'x-correlation-id': 'other' }))
  .toBe('req-123');
expect(resolveRequestId({ 'x-request-id': '\r\ninvalid' }))
  .toMatch(/^[0-9a-f-]{36}$/i);
```

- [ ] Implement per-request ID propagation and sanitized gateway errors using Nest logger. Keep upstream error bodies and OCR error codes compatible. Validate traceparent before forwarding.
- [ ] Use a local HTTP fixture upstream to prove 204, JSON errors, non-JSON failure sanitization, timeout, redirect rejection, response-header allow-list and forbidden client headers. Keep the fixture destination fixed by test configuration.
- [ ] Run focused tests and existing OCR/Notification tests. Prove streams and 204 responses are not forced through JSON parsing by the new shared code.

- [ ] Verify OCR 10-second timeout/503 OCR_BUSY, multipart boundary and duplex half, measured baseline upload limits and client-disconnect cancellation. Report unbounded raw-stream paths explicitly; never apply Identity's JSON cap to OCR uploads.

**Gate:** no raw upstream exception leaks; correlation spans ingress/egress; all existing response shapes preserved.

## Task 3: Edge access JWT verification with explicit route policy

**Files:** create `src/auth/access-token.service.ts`, `src/auth/access-token.service.spec.ts`, `src/auth/access-token.guard.ts`, `src/auth/auth-policy.decorator.ts`, `src/auth/auth.module.ts`, `test/auth.e2e-spec.ts`; modify module wiring and existing controller auth annotations after impact.

**Interfaces:** `AccessTokenService.verify(token: string): Promise<AccessPrincipal>`; `AccessPrincipal` contains `sub`, `sid`, `jti`, `system_role`, `user_status`; `AuthPolicy('public' | 'optional' | 'required')` preserves existing route intent. Required is the safe default for registered application controllers; health/public auth endpoints are explicit exceptions.

- [ ] Inspect Identity issuer/validator contract and existing route auth modes. Record a method/path/auth-policy matrix before annotations.
- [ ] Write failing token tests with an ephemeral key: valid, expired, wrong issuer/audience/algorithm/signature, missing/invalid UUID/time claims, refresh token, disabled status, skew boundary.
- [ ] Implement jose verification; confirm jose ESM behavior with actual Node 24/Jest setup and avoid broad project module-mode changes.
- [ ] Add Fastify E2E proofs: login/register/refresh/recovery remain accessible, required routes reject before upstream receives a request, optional routes match the existing adapter, original Bearer token reaches upstream, forged identity headers do not.
- [ ] Test existing OCR bypass only in development; production cannot enable it. Do not introduce an authentication bypass for other routes.
- [ ] Run focused tests, full unit/E2E suites and build.

- [ ] Optional-auth tests: missing token is anonymous, valid token attaches principal, every supplied invalid token returns 401 without upstream traffic.

**Gate:** real cryptographic verification, preserved public auth flows and downstream domain ownership.

## Task 4: Workspace public API and contract coverage

**Files:** create `src/workspace/workspace.module.ts`, `src/workspace/workspace.controller.ts`, `src/workspace/workspace-proxy.service.ts`, `test/workspace.e2e-spec.ts`, `packages/contracts/http/gateway/openapi.yaml`, `packages/contracts/http/gateway/README.md`; modify `src/app.module.ts`.

**Interfaces:** explicit controller methods mirror Workspace OpenAPI; configured upstream path strips only `/api/v1`. Public paths: `/api/v1/workspaces`, `/:workspaceId`, `/:workspaceId/members`, `/:workspaceId/members/:userId/permissions`, `/:workspaceId/members/:userId`, `/:workspaceId/members/me`. Match methods from upstream OpenAPI exactly.

- [ ] Run impact for module/controller integration. Read every Workspace operation and schema used; derive query/body bounds from the contract.
- [ ] Add failing fixture-server tests for all nine public operations, preserving status/body including empty success responses where specified. Assert actual upstream path, query and bearer/correlation headers.
- [ ] Add negative cases for invalid UUID/query/body limits, missing JWT, internal path variants and unexpected methods. Assert no upstream request for rejected inputs.
- [ ] Implement the bounded proxy with explicit route declarations, 10-second request deadline, redirect rejection, disconnect cancellation and no retry of mutations. Preserve downstream 401/403/404/409 responses.
- [ ] Test that OCR extraction remains routed to OCR, not Workspace; test encoded traversal/separator variants cannot reach internal routes.
- [ ] Publish gateway-facing OpenAPI documenting prefix mapping, security, gateway errors and unchanged upstream schemas. Include existing routes or clearly scope the document to Workspace; never claim an incomplete document covers the whole ingress.
- [ ] Run unit/E2E/build and contract coverage check enumerating methods/paths against Workspace OpenAPI.

**Gate:** every contracted public Workspace operation works through Fastify; `/internal/**` cannot be reached through Gateway.

## Task 5: Rate limiting and bounded readiness

**Files:** create `src/rate-limit/rate-limit.module.ts`, `src/rate-limit/gateway-throttler.guard.ts`, `src/health/health.module.ts`, `src/health/health.controller.ts`, `test/limits-health.e2e-spec.ts`; modify config, wiring and route policy metadata.

**Interfaces:** configured general/auth/OCR limits follow spec; authenticated OCR key uses verified principal only. `/health` returns 200 while the process can respond; `/ready` returns 200/503 from bounded Identity/Workspace probes.

- [ ] Run impact before wiring guards/health/config.
- [ ] Write deterministic limiter tests with a controlled clock or tiny test-only thresholds: 429/Retry-After, expiry recovery, independent callers, forged forwarded headers, preflight and health exemptions.
- [ ] Implement single-instance Throttler policy with `trustProxy=false`. Verify guard ordering so OCR subject has already been authenticated; unverified subject claims must never choose the bucket.
- [ ] Write fixture-based readiness tests for both required services up, one down, timeout and recovery; prove liveness does not contact upstreams.
- [ ] Implement Terminus probes using verified upstream health paths and two-second deadlines. Hide URLs/raw exceptions from public responses.
- [ ] Run focused and full regression suites/build. Document single-replica limitation and operational knobs.

**Gate:** bounded resource use, observable 429, accurate readiness, no cascading liveness failure.

## Task 6: Independent review, runtime proof and handoff

**Files:** update `services/api-gateway/README.md`, `docs/development/SETUP.md` only for Gateway instructions, focused `docs/work_logs/YYYY-MM-DD-api-gateway.md`; adjust product files only through reviewed Luna fixes.

- [ ] Controller reads actual diff, independently reviews spec compliance then security/correctness. Check route precedence, header spoofing, JWT bypasses, stream limits, optional auth and response compatibility.
- [ ] Send each finding to Luna with severity, file/line, reproduction, expected behavior and required regression test. Luna fixes only assigned files; controller rechecks resulting diff and verification. Repeat until no unresolved correctness/security/contract finding remains.
- [ ] Run the actual package unit/E2E/build scripts. Use `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"` for non-mutating lint; repository `lint` includes `--fix` and is not a read-only check.
- [ ] Run real Identity login → Gateway-protected Workspace listing/creation/access checks with dedicated test data. Do not silently write into a real user's workspace; use a test account and record cleanup scope. If no test credentials/services exist, report this runtime gate as blocked.
- [ ] Use real authenticated Playwright flows for existing browser login/notification/OCR compatibility with test fixtures; record browser console/network and distinguish unavailable OCR upstream from Gateway regressions. Do not create UI features just to exercise new Workspace routes.
- [ ] Update docs with route matrix, env variable names, health semantics, limits, error compatibility, commands, deferred features and rollback. No secret values.
- [ ] Run `git diff --check` in the isolated worktree; run complete GitNexus detect-changes, rerunning partial/truncated results. Review only task-owned files before any milestone commit.
- [ ] Commit only tested logical milestones with summary and description. Report SHA and exact test/runtime limits. Never auto-stage the dirty original checkout or claim merge/push occurred.

## Controller dispatch contract

For each Luna assignment send: spec/plan paths; task number; exact owned files; prerequisite interfaces; acceptance cases; graph obligations; verification commands; no changes outside ownership; stop on runner setup error; return changed paths, test evidence and unresolved issues. Use fresh bounded workers for new tasks, and the same worker via follow-up for review fixes. Do not delegate the controller's acceptance decision.

Task status: 0–6 not started. Planning and read-only Luna acceptance review are separate from implementation completion.

## Cleanup follow-up — 2026-09-20

The historical checklist and status line above are preserved. Tasks 0–6 are
implemented and integrated on `api-gateway` through `a7be457` and cleanup
commit `a984069`. The full read-only Gateway ESLint command now passes with
zero errors and warnings; integrated unit (82), E2E (65), typecheck, build, and
diff checks also pass. Real Identity/Workspace and authenticated browser gates
remain blocked pending an authorized environment and dedicated test account.
The source worktree remains preserved separately with its historical planning
artifacts; see the focused 2026-09-20 worklog for artifact decisions.

## Final document consolidation status — 2026-09-20

The source plan and focused worklog were compared with the main checkout before
consolidation. Their historical differences remain preserved in the external
archive manifest; this main plan keeps its original planning history and the
current integrated status above. The source-only Task 4 execution plan is now
also preserved as `docs/superpowers/plans/2026-09-19-api-gateway-task-4-workspace.md`.
The design specification was byte-identical across source and main after
comparison and is retained once in the main planning set. The source SDD
ledger and task reports were archived with SHA-256 hashes before worktree
removal; no ignored report, credential, real environment file, or uncertain
user document was discarded.

Current final state: `api-gateway` remains at `a984069`; the Gateway code and
configuration are unchanged, and the real-service/browser gates remain
explicitly blocked pending authorized infrastructure. The focused worklog
records the documentation commit, archive manifest, preserved main index
state, and exact worktree-removal recovery path.
