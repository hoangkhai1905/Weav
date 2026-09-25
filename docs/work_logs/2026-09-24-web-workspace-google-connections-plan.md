# Work log — Web Workspace Google Connections plan

## Metadata

- Date/time: 2026-09-24, Asia/Saigon.
- Branch/HEAD: `api-gateway` / `7e14de0`.
- Scope: Tasks 1–5 implementation across Gateway and web; no mobile changes.
- Status: Tasks 1–5 implemented and verified with focused browser suites and package builds; no commit. Task 6 live-service verification is unavailable because Docker engine access is denied; real Google consent remains unverified.

## Request and decisions

The user asked for a plan to improve Workspace because Gmail/Google Sheets connection management is absent from the current UI. User clarified that web comes first and mobile follows later; Gmail should keep the backend's existing metadata-read scope, without Gmail send. The plan also makes the fixed topbar workspace label a real selector because the preceding question identified it as a nonfunctional control.

## Evidence and findings

- `apps/web/src/pages/ConnectionsPage.tsx`: hardcoded eight-provider catalog and timer-driven create/test/sync/delete; no Workspace API call. `apps/web/src/api/connection.api.ts` is a separate unused localStorage mock.
- `apps/web/src/components/layout/Topbar.tsx`: fixed “WEAV · Production” label with no selection handler. The actual selector uses `useWorkspaceStore` in `WorkspacePage.tsx`.
- `services/workspace-service/README.md` and `packages/contracts/http/workspace/openapi.yaml`: Workspace owns persisted connections, OAuth start/callback, verification, statuses and permission flags. Gmail scope is `gmail.metadata`; Sheets uses `spreadsheets`.
- `services/api-gateway/src/workspace/workspace.controller.ts` and `packages/contracts/http/gateway/openapi.yaml`: no public Connections routes. Prior `docs/work_logs/2026-09-22-workspace-connections-contract-audit.md` reached the same gap verdict.
- `GoogleOAuthCallbackController.java`: Workspace callback redirects to `/connections` with safe `oauth`, optional `reason` and `connectionId` query values. It is distinct from Identity's Google login callback.
- `.env.example` and `compose.dev.yml` default the frontend return URL to port 3000; the web Vite server uses port 5173. The plan corrects local development configuration and retains the direct-run service default until a separate compatibility review.
- Graph-first checks used local GitNexus CLI because the referenced `.claude/skills/gitnexus-exploring/SKILL.md` is absent. GitNexus query reported missing FTS indexes; named-symbol `context` and `impact` worked. Upstream impact returned LOW for `ConnectionsPage` (caller `App`), `Topbar` (caller `AppLayout`, then `App`), `WorkspacePage` (caller `App`), `WorkspaceController` (import chain `workspace.module.ts` → `app.module.ts` → `create-app.ts`), `WorkspaceProxyService` (Gateway module/controller import chain) and `useWorkspaceContext` (callers `WorkflowBuilderPage`, `WorkspacePage`, then `App`). `connectionApi` returned LOW with zero graph callers, but a targeted source search also found no imports of that module; zero graph callers alone was not treated as proof. These are lower-bound planning results while the worktree is dirty; re-run before code edits, and do not treat unresolved property calls as unused.

## Artifacts and verification

- Added `docs/superpowers/specs/2026-09-24-web-workspace-google-connections-design.md` with scope, alternatives, API boundaries, user flow and acceptance criteria.
- Added `docs/superpowers/plans/2026-09-24-web-workspace-google-connections.md` with six independently reviewable tasks: Gateway, web data, topbar, list/create, OAuth/lifecycle, and real-user verification.
- Verified current Git status before planning. Many pre-existing modified and untracked web/mobile files remain user-owned and untouched by this planning task.
- `git diff --check` completed with no whitespace errors; Git only reported an existing CRLF conversion warning for a modified mobile file. No tests/builds were run because this session changed documentation only. No live OAuth or authenticated browser flow was claimed.
- A targeted scan found no trailing spaces or placeholder markers in the three new documents. Git status shows those three as untracked; existing source changes were preserved.

## Risks and next steps

1. Review the proposed design and plan, especially the eight-route Google-only Gateway subset and topbar behavior.
2. Before implementation, separate file ownership or use an isolated checkout because this is cross-service work on a dirty worktree. Re-run GitNexus impact on exact symbols and inspect overlapping diffs.
3. Execute Gateway contract first, then web adapter and UI. Runtime acceptance needs a signed-in test user and configured Google OAuth test account; fixture tests alone are insufficient.
4. Before any commit, run complete GitNexus change detection and keep unrelated changes out of the staged set.

## Implementation review checkpoint — 2026-09-24

- The coding subagent added eight explicit Gateway connection routes, Gateway OpenAPI/README updates, and Gateway e2e coverage. Task 2 has two new adapter-level Playwright tests but no HTTP adapter implementation; Tasks 3–5 are not implemented. No commit or task report was produced.
- Independent rerun: `pnpm --dir services/api-gateway test:e2e -- --runInBand workspace.e2e-spec.ts` passed (12/12); `pnpm --dir services/api-gateway build` passed.
- `pnpm --dir apps/web test:e2e -- e2e/workspace-connections.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` failed (2/2) as expected for unfinished Task 2: `connectionApi.list is not a function`, then no bearer request was observed.
- Read-only ESLint on the two changed Gateway TypeScript files failed at `test/workspace.e2e-spec.ts:778` for Prettier formatting. Focused `git diff --check` was clean.
- GitNexus `impact WorkspaceController --direction upstream --repo .` returned LOW; import chain: `workspace.module.ts` → `app.module.ts` → `create-app.ts`, with no indexed process. The concept query earlier warned that FTS indexes are missing; graph results are a lower bound.
- A reviewer is checking Task 1's spec compliance and code quality separately. This checkpoint does not assert that the whole feature or Task 1 review gate is complete.
- Reviewer verdict: Task 1 remains partial. The Gateway OpenAPI omits `400 GatewayBadRequest` for five UUID-validating connection operations (collection GET, item GET, DELETE, test, disable). Fix this contract gap and the ESLint formatting failure before treating Task 1 as review-complete.

## Task 1 review closure — 2026-09-24

- Added the five missing OpenAPI `400 GatewayBadRequest` responses and added invalid-UUID e2e inputs for the `test` and `disable` item routes.
- `pnpm --dir services/api-gateway test:e2e -- --runInBand workspace.e2e-spec.ts`: PASS, 1 suite / 12 tests.
- `pnpm --dir services/api-gateway build`: PASS. Focused ESLint and Prettier checks on the changed Gateway TypeScript files: PASS. `git diff --check`: PASS (one existing unrelated CRLF warning only).
- GitNexus `WorkspaceController` upstream impact: LOW, import chain through `workspace.module.ts`, `app.module.ts`, `create-app.ts`, 0 processes. The duplicate-name `handleFixtureRequest` UNKNOWN was resolved by exact UID and text search; the current fixture function has one `createServer` reference. No HIGH/CRITICAL risk.
- Task 1 report: `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-1-report.md`. No commit; no unrelated files staged.
- Task 2 adapter tests remain the known RED entry point; implementation proceeds in the next checkpoint.

## Task 2 checkpoint — 2026-09-24

- Replaced the localStorage connection mock with an authenticated, typed Workspace Gateway adapter and added scoped list/detail queries and lifecycle mutations. `ConnectionResponse` includes required `createdBy`. Google create explicitly forwards only name/provider/OAUTH2; response parsing and errors remain typed, with both Gateway nested and Workspace top-level error envelopes supported.
- Confirmed Task 2 RED first (original adapter suite 0/2); GREEN after implementation and one security-review adjustment: full connection adapter Playwright file 4/4 passed.
- Web build, focused ESLint, Prettier check (using the repository's installed formatter), and `git diff --check` all passed. Build reports the existing large-chunk advisory. Git reports the existing unrelated mobile CRLF warning only.
- GitNexus `connectionApi` upstream impact LOW with zero indexed callers; targeted text search confirmed no pre-existing source consumer. No HIGH/CRITICAL warning.
- Detailed checkpoint: `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-2-report.md`. No commit or staging.
- Next: inspect the user-owned dirty Topbar/workspace/i18n state and impact exact symbols before Task 3; add the selector browser test and confirm RED.

## Task 3 checkpoint — 2026-09-24

- Replaced the fixed “Production” topbar decoration with a responsive native selector bound to the shared workspace store. Added list-only loading/error/retry handling in `useWorkspaceListContext`, keeping member paging confined to `useWorkspaceContext`. Added a Workspace → Connections link beside the active workspace label and bilingual selector copy.
- TDD: two new browser tests were RED before implementation; focused feature suite GREEN at 6/6. Web build and focused ESLint passed. Existing combined workspace-switch/OCR regression run: 23/27 passed; four failures are the exact pre-existing localization substring mismatches already in the pre-implementation baseline (OCR and remaining workspace scenarios passed). `git diff --check` passed except for Git's unrelated mobile CRLF notice.
- GitNexus: `Topbar`, `useWorkspaceContext`, exact `WorkspacePage` function, and `TRANSLATIONS` impacts all LOW; no HIGH/CRITICAL risk. WorkspacePage function name collision was resolved by exact UID.
- Detailed checkpoint: `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-3-report.md`. No commit or staging; existing dirty web work was preserved and no mobile files changed.
- Next: Task 4 replaces the Connections demo with the active workspace list/create UI; inspect current dirty page/i18n diffs and rerun GitNexus impact before those edits.

## Task 4 checkpoint — 2026-09-24

- Replaced the mock Connections experience with the selected workspace's real typed list and Google-only create path. The UI renders only server-returned metadata and status, has explicit empty/loading/401/403/404/5xx states, scopes list data by workspace, and refetches after creation. No fabricated totals/health/latency, static providers, secrets/config, or timer-based success remain.
- TDD: eight new page scenarios failed against the old mock page; after implementation and an i18n-aware status assertion correction, the complete feature e2e suite passed 14/14. Web build, focused ESLint, Prettier, and diff check passed. The known large-chunk warning and unrelated mobile CRLF notice remain.
- GitNexus impact for `ConnectionsPage` and `TRANSLATIONS` was LOW; no HIGH/CRITICAL risk. The dirty mock-only localization component code was replaced as required by Task 4; the pre-existing translation dictionary changes were preserved and extended.
- Detailed checkpoint: `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-4-report.md`. No commit or staging.
- Next: Task 5 OAuth start/return, safe transient context, real rename/test/disable/delete calls, dev callback URL and docs.

## Task 5 checkpoint — 2026-09-24

- Added Google OAuth start from persisted Gmail/Sheets connection rows. Only `{userId, workspaceId, connectionId, createdAt}` is kept in session storage; the authorization URL, state, code and credentials are not persisted. On return, pending context is age/user/access checked, known server state is refetched, callback query values are scrubbed, and success never implies `ACTIVE`.
- Callback review found that a forged `state_invalid` URL could include the pending connection ID and restore its workspace. Workspace's contract says invalid state has no trusted connection ID; restoration now refuses that failure reason even if the query is forged. Rename, test, disable and confirmed delete use the existing authenticated API mutations and `canManage`; 409/503 failures preserve the row.
- Updated the existing localization browser scenario from the removed static demo modal to the real workspace-scoped Google form. Local Compose callback defaults now target Vite on port 5173; Workspace README distinguishes the frontend return URL from the Google-registered callback URI. The service's direct-run default was left unchanged.
- TDD RED was observed before Task 5 UI work: the selected Playwright run showed seven expected missing-control/notice failures before it was interrupted at scenario eight. During GREEN, the invalid-state scenario then caught the workspace-restoration bug and was fixed. The OAuth-start fixture was changed to capture session storage before cross-origin navigation rather than blocking navigation with an in-route `page.evaluate`.
- Final `pnpm --dir apps/web test:e2e -- e2e/workspace-connections.spec.ts e2e/localization.spec.ts --project=chromium --workers=1 --retries=0`: PASS, 35/35. The revised localization suite passed 10/10.
- After the final responsive row-wrapping adjustment, reran `pnpm --dir apps/web test:e2e -- e2e/workspace-connections.spec.ts --project=chromium --workers=1 --retries=0`: PASS, 25/25; web build, focused ESLint and Prettier checks also passed after this adjustment.
- Final `pnpm --dir apps/web build`: PASS (2,511 modules; existing >500 kB chunk advisory). Focused ESLint and Prettier checks passed. The localization file kept its prior user-owned style; its focused ESLint and browser check pass.
- Final Gateway verification: `pnpm --dir services/api-gateway test:e2e -- --runInBand workspace.e2e-spec.ts` PASS (12/12), `pnpm --dir services/api-gateway build` PASS, and focused read-only ESLint PASS.
- Compose `config --quiet` exited 0 with warnings that `C:\Users\nguye\.docker\config.json` is inaccessible. `docker compose ps --services --status running` could not connect to the Docker named pipe (`permission denied`). No real authenticated service path or Google consent was run; fixture tests are not live OAuth evidence.
- Pre-edit GitNexus impact for `ConnectionsPage` was LOW (caller `App`, one indexed process); `TRANSLATIONS` was LOW. The later exact `ConnectionRow` lookup returned UNKNOWN/not indexed and was resolved by targeted search to one local definition and one page render site. No HIGH/CRITICAL warning. No mobile changes, staging, or commit. GitNexus `detect-changes` was not required because no commit is being prepared.
- Detailed report: `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-5-report.md`. Task 1 review closure is documented in `task-1-report.md`; Tasks 2–4 have their own task reports.

## Task 6 verification checkpoint — 2026-09-24

- Task 6's real-service/authenticated browser path and live Gmail/Sheets consent remain unverified. Docker configuration syntax passed, but the engine permission denial prevented service discovery or startup. No OAuth client/account configuration was inferred or exposed. Re-run only when a safe configured environment and test account are available.
- No Workspace Service behavior or contract was changed, so no service integration test was run. Existing Task 1 Gateway and the complete focused web browser suites were rerun after Tasks 1–5.
- Final `git diff --check` exited 0; only line-ending conversion notices appeared for `.env.example` and a pre-existing mobile file. Existing user-owned dirty changes were preserved; no mobile paths were edited by this task.

## Independent review checkpoint — 2026-09-24

- Reran Gateway e2e (12/12), Gateway build, web build, focused read-only ESLint for Gateway and web, and `git diff --check`: all passed. `docker compose ... config --quiet` exited 0 with Docker config access warnings; `docker compose ps --services --status running` failed with Docker engine named-pipe permission denied. No live service or Google consent was verified.
- First concurrent Playwright run: 34/35; the localization navigation case timed out at `/workflows` while Gateway tests/build and web build also ran. The single case passed (1/1) when rerun without those jobs. A full sequential rerun of connection + localization passed 35/35. Cause of the first timeout is unproven; monitor test stability.
- Review finding: `ConnectionsPage.tsx` renders Connect Google for every `canManage` row, including TELEGRAM/HTTP. `StartConnectionOAuthUseCase.validateGoogleConnection` rejects non-Google providers with 400. Restrict the action to Gmail/Google Sheets OAuth2 rows and test the legacy-provider case.
- Review finding: `ConnectionsPage.getErrorMessage` does not map Workspace's actual `DEPENDENCY_UNAVAILABLE` 503 code (nor Gateway `BAD_REQUEST`/`UNAUTHORIZED`), so these responses fall through to raw English server messages in Vietnamese UI, without the planned retry guidance for dependency failure. The current 503 delete fixture uses synthetic `CONNECTION_UNAVAILABLE`, masking this mismatch.
- No source files were edited during this independent review; no commit or staging occurred. A separate read-only reviewer is evaluating the implementation diff.

## Post-retry verification — 2026-09-24

- The Luna Max continuation returned `DONE_WITH_CONCERNS`, not a runner setup error, and reported no source edits in its final narrow verification turn.
- Controller independently reran `pnpm --dir apps/web exec playwright test e2e/workspace-connections.spec.ts --project=chromium --workers=1 --retries=0`: 28/28 passed. The provider-gating and real Gateway/Workspace error-code assertions are present.
- Independently reran `pnpm --dir apps/web build`, focused read-only ESLint on `ConnectionsPage.tsx` and `workspace-connections.spec.ts`, and `git diff --check`: all exited 0. Build retains the >500 kB chunk advisory; diff check emitted only line-ending notices.
- The reported UI/model error did not match `helper_unknown_error: setup refresh had errors` in the subagent status. Live Google consent remains unverified because Docker engine access is denied. No commit was made.

## Final independent review fix checkpoint — 2026-09-24

- Closed the review findings in `apps/web/src/pages/ConnectionsPage.tsx`: Google OAuth action is limited to manageable GMAIL/GOOGLE_SHEETS OAUTH2 rows; Workspace `DEPENDENCY_UNAVAILABLE` and Gateway `BAD_REQUEST`/`UNAUTHORIZED` codes (plus 400/401/503 status fallbacks) map to existing bilingual localized messages, including retry guidance for 503.
- Updated `apps/web/e2e/workspace-connections.spec.ts` with legacy TELEGRAM/HTTP and non-OAuth assertions, actual backend error-code fixtures, and localized expectations. TDD RED was observed for the action exposure, raw 400/401 messages, and actual 503 fixture; GREEN: focused Chromium cases 4/4 and complete connection suite 28/28.
- Verification passed: `pnpm --dir apps/web build` (with existing bundle-size advisory), targeted read-only ESLint, focused Prettier check, and `git diff --check` (only existing line-ending notices). See `.superpowers/sdd/2026-09-24-web-workspace-google-connections/task-5-report.md` for exact commands and graph details.
- The full multi-project Playwright attempt could not verify Firefox because it fails before test setup with `browserContext.newPage` (`_page` undefined); final verified browser coverage is Chromium. No mobile files were edited. Live Google consent remains unverified due unavailable safe configured runtime/account. No commit/staging; `detect-changes` was not run because no commit is planned.

## Live Gateway route incident — 2026-09-24

- User reported `GET /api/v1/workspaces/:workspaceId/connections` returning 404 in the Workspace UI while workspace switching still worked. An unauthenticated live request returned Gateway `NOT_FOUND` / `Cannot GET .../connections`, whereas the existing workspace route returned 401. Current source contains the connections controller route; the running Gateway container was created three days earlier and its controller source lacked that route.
- Confirmed port 3000 belonged to Docker's Gateway container and inspected its Compose file labels. Rebuilt and recreated only `api-gateway` with the same three Compose files (`compose.yml`, `compose.dev.yml`, `compose.colab-ocr.dev.yml`) using `--env-file .env --profile app up -d --no-deps --build api-gateway`. No database service or volume was changed.
- Post-rebuild read-only checks: Gateway container is running; unauthenticated `GET /api/v1/workspaces/:workspaceId/connections` now returns 401 `Bearer token required`, confirming route registration and removal of the reported Gateway 404. The authenticated UI list and Google OAuth consent remain unverified; user should refresh and report any new response. No source code edit or commit was made for this incident.

## Live Workspace Service 500 incident — 2026-09-24

- After the Gateway route update, the user reported HTTP 500 for the same Connections list request. Workspace Service logs showed `NoResourceFoundException` / `No static resource .../connections`; the running container had no `ConnectionController.java`, while current source defines the route. This was a stale Workspace Service image, not a connection-data exception.
- Built `workspace-service` using the currently running Compose files (`compose.yml`, `compose.dev.yml`) and recreated only that container with `--no-deps --no-build`. No source code or other service was changed. Flyway startup reported schema version 3 already current and no migration necessary.
- Fresh checks: Spring started successfully; compiled `ConnectionController.class` exists in the running container; unauthenticated direct `GET http://localhost:8082/workspaces/:workspaceId/connections` returns 401 instead of the previous missing-route 500; both Gateway and Workspace Service containers are up. The actual authenticated browser request and Google consent remain unverified; user should refresh Connections and report any new response. No commit was made.
