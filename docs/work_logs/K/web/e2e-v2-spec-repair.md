# Repair Playwright specs stale since the v2 redesign

| Field | Value |
| --- | --- |
| Branch | `test/stale-e2e-v2` from `feature/simple-node-ui` `56493125` (now merged into `dev` as `a24928c3`), not pushed, not merged |
| Dates | 2026-10-18 – 2026-10-19 |
| Why | dev's v2 UI redesign (`d57ffae8`, `91005b03`) changed copy, layout and test ids; 74 web Playwright tests failed identically on `dev` |
| Related | Manual live QA audit: `docs/work_logs/K/qa/e2e-audit.md` (different scope: user flows on the real stack) |
| Status | Done, reviewed per batch and as a whole branch; 2 known failures left by decision (below) |

## Root cause

Most specs were written for the in-app mock mode (demo data such as `wf-001`, auto-login), while the repo runs `VITE_API_MODE=http`; the rest asserted copy, selectors or test ids the redesign changed. Fix pattern: stub the backend per spec with exact-path, exact-method routes, plus an `/api/*` fallback that answers 501 and records the call, and an `afterEach` that fails the test on any unmatched call, so a broken request can never pass as a silent 200. Shared helper: `apps/web/e2e/support/http-builder.ts`.

## What changed

| Batch | Specs | Commits | Review |
| --- | --- | --- | --- |
| A | workflow-ui (25) | `53773aa6`, `0f9273b4`, fix wave `264ff645` | 1 fix round (deleted test restored as a computed-style check; catch-all removed; login test really signed out) + branch-review fix wave (exact-path stubs) |
| B | ocr-builder (13), workflow-catalog-v1 (7), ai-builder (2) | `adbc68a3`, `353f6b02`, `30c2c9ba` | 2 fix rounds (catch-all 200 removed, GET-only exact stubs, unknown ids recorded) |
| C | password-recovery (8), workspace-read-switch (6), workspace-connections (4), workspace-members (1) | `ddf85e02`, `2e222fe6` | 1 fix round (401 tests really go through the refresh call; strict builder stub; owner notice asserted) |
| D | executions-live (3), workflow-api-v1 (1), localization (1), notification-integration (1), request-budget (stale part) | `f481304c`, `10502a52` | 1 fix round (run-detail screen localized VI/EN with exact stubs) |

App fixes (own commits, can be cherry-picked separately):

| Commit | File | Bug | Proving test | Review |
| --- | --- | --- | --- | --- |
| `f23dc8b1` | `apps/web/src/api/workspace.api.ts`, `WorkspacePage.tsx`, `translations.ts` | Adding someone who is already a member showed "A workspace with these details already exists." in http mode (the member text only ever came from the mock API). Now `USER_ALREADY_MEMBER` -> new key `msg.user_already_workspace_member` (vi + en); other 409s unchanged | `workspace-members.spec.ts` (409 case) | Approved |
| `f23dc8b1`, `f89c8998` | `apps/web/src/pages/WorkflowsPage.tsx` | The workflow row "more actions" menu was clipped by the table card's horizontal scroll on short lists. Now fixed-positioned from its trigger, flips above near the viewport bottom, right edge clamped, closes on scroll/resize and returns focus to the trigger | `workspace-connections.spec.ts` (~1687 clipping), `workflow-ui.spec.ts` "keeps the row menu of the last row inside a short viewport" (RED 435 > 400 before the fix) | Approved after 1 fix round |

Removed or retitled tests (behaviour no longer in the UI):
- workflow-ui "OCR workflow node" kept and repaired (not deleted); "dark sidebar palette" retitled to a computed-style check (footer shares the sidebar surface).
- dashboard / executions: mock-only content ("Lịch (hằng ngày)", EX-8492 "Step inspector", "Stripe IP") removed; the `/executions/EX-8492` screen stays as a not-found check and a new test localizes a stubbed run detail.
- OCR "no workspace selected" (ocr-builder, workspace-read-switch): retitled to "builder stays closed and no OCR request is sent"; the "Select a workspace" guard (`WorkflowBuilderPage.tsx` ~1265/1282, `ocr.api.ts` ~264) can no longer be reached from the UI (no draft loads without a workspace) — dead code, left in place.
- workspace-connections 401: the old mapped message is gone since session renewal (`92ca1bd9`); the tests now assert one refresh call, then sign-out to `/login`.

## Checks

- Full web suite (`VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium`), sequential, at `f89c8998`: **416 passed, 2 skipped, 2 failed** (before: 339 passed, 75 failed). Re-run at `264ff645` after the fix wave: 415 passed, 2 skipped, 3 failed = the same 2 + workspace-connections "OCR picks the photo sent to the bot…" (30 s timeout under full-suite load; passes 3/3 alone and passed in the previous full run).
- `tsc -p tsconfig.app.json` OK; `git diff --check 56493125..HEAD` clean; eslint on changed files: only pre-existing set-state-in-effect errors (`WorkflowsPage.tsx`, `WorkflowBuilderPage.tsx`, same lines on `dev`); no merge conflict with `dev` (`a24928c3`).

## Left failing on purpose

- `request-budget.spec.ts` "Dashboard to Workflows to run history and back stays within the API request budget": 44-45 requests against a budget of < 25. The v2 workflows list (`d57ffae8`) loads up to 20 workflow details one by one plus run fan-out (N+1). The budget was not raised; reducing the requests is app performance work (follow-up).
- `notification-task10-live.spec.cjs`: a live test; needs `WEAV_TASK10_*` (gateway, mobile, RabbitMQ URLs) and a running compose stack.

## Deferred (can wait, per the branch review)

Near-duplicate stub helpers across specs (could share `http-builder.ts`); `loginAndOpenBuilder` leftover in `support/builder.ts`; older catch-all routes in localization / notification specs that predate this branch; logo test checks an SVG path; row menu not clamped at the top of a < 390 px viewport; refresh-succeeds-then-retry path untested.

## Next

- K: review and merge `test/stale-e2e-v2` into `dev` (`git merge --no-ff`); the app fixes can also be cherry-picked alone.
- Follow-up: cut the workflows-list request fan-out so `request-budget` passes again.
