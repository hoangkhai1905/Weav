# Dashboard Real-Data Slice Implementation Plan

> **For agentic workers:** Execute this plan inline in the current checkout; preserve all unrelated dirty files and do not commit or push.

**Goal:** Make the Dashboard honest in default HTTP mode by rendering real workflows, deriving only complete workflow-list counts, and replacing unsupported execution widgets with localized placeholders while preserving the existing mock demo.

**Architecture:** `DashboardPage` remains the boundary. It will load the complete `workflowApi.getWorkflows()` result into visible state, expose loading/error/empty states, and branch only the unsupported visual areas by `VITE_API_MODE === 'mock'`. HTTP mode will render real workflow rows and published/total counts; mock mode keeps the existing chart/panel/demo table.

**Tech Stack:** React, TypeScript, Vite, Playwright Chromium, existing `useI18nStore` translations, Workflow V1 API fixture contract.

**Spec:** User-approved Dashboard real-data readiness slice from 2026-09-25.

## Global Constraints

- Default HTTP mode must not render fabricated execution counts, success rates, worker counts, health status, fixed demo IDs, or fake last-run data.
- Mock/demo layout remains available only when `VITE_API_MODE=mock`.
- Do not edit OCR, AI/Bot behavior, Playwright config, Workflow API contracts, or user-owned dirty files.
- Run TDD RED/GREEN, focused HTTP fixture tests, existing mock UI suite, typecheck/build, and `git diff --check`.
- Do not commit, push, reset, stash, or stop user-owned processes.

### Task 1: Add failing HTTP-mode Dashboard fixture coverage

**Files:**
- Create: `apps/web/e2e/dashboard-real-data.spec.ts`
- Read: `apps/web/playwright.config.ts`, `apps/web/src/api/workflow-v1.api.ts`

- [ ] Add populated, empty, and API-error tests with explicit `VITE_API_MODE=http`, isolated workspace/API routes, real workflow IDs, and assertions that fabricated demo values are absent.
- [ ] Run the focused spec before production edits and record the expected RED failures.

### Task 2: Implement Dashboard HTTP-mode data boundary

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`

- [ ] Run GitNexus impact for the existing `DashboardPage` symbol and confirm no HIGH/CRITICAL risk.
- [ ] Store workflow list, loading, and error state; retain `workflowApi.getWorkflows()` as the source of truth.
- [ ] Keep the existing mock branch unchanged; in HTTP mode render localized loading/error/empty states, real workflow rows, real IDs, and Run only for `PUBLISHED` workflows.
- [ ] In HTTP mode show only total/published workflow counts and explicit unavailable placeholders for execution/chart/live areas.
- [ ] Re-run focused fixture tests until GREEN without adding HTTP-to-mock fallback.

### Task 3: Verify regression boundaries

- [ ] Run full `dashboard-real-data.spec.ts` with unique port and inspect browser console/network evidence.
- [ ] Run existing Chromium-serial mock `workflow-ui.spec.ts` and verify the prior mock layout remains green.
- [ ] Run web typecheck/build, `git diff --check`, inspect target diff, and verify dirty/stash preservation.
- [ ] Append exact commands/results and remaining fake follow-ups to `docs/work_logs/T/2026-09-24-workflow-v1-web-integration.md`.
