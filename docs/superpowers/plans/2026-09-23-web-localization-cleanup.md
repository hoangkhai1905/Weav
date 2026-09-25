# Web Localization Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all existing web UI copy follow the selected VI or EN locale and remove raw translation keys.

**Architecture:** Keep the existing `TRANSLATIONS` map and `useI18nStore().t` lookup. Add paired VI/EN entries and replace only user-facing hardcoded strings in the web UI; retain technical values, identifiers, API/log payloads, and genuine sample names.

**Tech Stack:** React, TypeScript, Vite, Zustand, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-web-localization-cleanup.md` (approved scope from the conversation).

## Global Constraints

- Change `apps/web` only; do not change mobile, backend, contracts, or business behavior.
- Ordinary visible and accessible UI copy must follow VI/EN; retain WEAV, OCR, API, Google, provider names, code, identifiers, and sample names where appropriate.
- Use the existing translation dictionary/API; do not add a framework.
- Preserve unrelated dirty changes; do not commit.
- Run focused Playwright, lint, build, and `git diff --check`; browser evidence must identify the local fixture/mock context.

---

### Task 1: Lock the localization regressions

**Files:**
- Test: `apps/web/e2e/localization.spec.ts`

**Interfaces:**
- Consumes: Existing routes and the existing `weav_lang_v1` locale setting.
- Produces: Playwright checks for localized Dashboard quick actions and Vietnamese Connections labels, with intercepted auth/workspace requests so the current Vite server renders protected pages.

- [x] **Step 1: Add the failing browser tests**

  Tests expect `Thao tác nhanh`, no `dashboard.quick_actions`, and an exact Vietnamese `Kết nối` nav label plus a translated add-connection form heading.

- [x] **Step 2: Run RED against the current app**

  Run: `pnpm --dir apps/web test:e2e -- e2e/localization.spec.ts --project=chromium --workers=1`

  Expected: fail on missing Dashboard translation and mixed `Kết nối (Connections)`; observed actual rendered failures for both.

---

### Task 2: Localize shared shell and account screens

**Files:**
- Modify: `apps/web/src/lib/i18n/translations.ts`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/Topbar.tsx`
- Modify: `apps/web/src/components/auth/AnimatedWorkflowShowcase.tsx`
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/pages/RegisterPage.tsx`
- Modify: `apps/web/src/pages/ForgotPasswordPage.tsx`
- Modify: `apps/web/src/pages/GoogleOAuthCallbackPage.tsx`
- Test: `apps/web/e2e/localization.spec.ts`

**Interfaces:**
- Consumes: `useI18nStore().t` and the existing `TRANSLATIONS` entries.
- Produces: Paired locale values for shared chrome, account flows, and auth illustration labels.

- [ ] Add focused browser assertions for VI and EN shell/account labels and verify RED.
- [ ] Add paired translation values and replace user-facing literals in the listed screens.
- [ ] Run: `pnpm --dir apps/web test:e2e -- e2e/localization.spec.ts --project=chromium --workers=1`.

---

### Task 3: Localize workflow, builder, and workspace screens

**Files:**
- Modify: `apps/web/src/lib/i18n/translations.ts`
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/src/pages/WorkflowsPage.tsx`
- Modify: `apps/web/src/pages/CreateWorkflowPage.tsx`
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx`
- Modify: `apps/web/src/pages/WorkspacePage.tsx`
- Test: `apps/web/e2e/localization.spec.ts`

**Interfaces:**
- Consumes: Existing locale state, page components, and stored workflow/workspace data.
- Produces: Localized page labels, statuses, help text, placeholders, and accessible names while keeping workflow/workspace data values intact.

- [ ] Add representative VI/EN page assertions and verify RED.
- [ ] Add paired translations and replace only visible UI literals in the listed screens.
- [ ] Run: `pnpm --dir apps/web test:e2e -- e2e/localization.spec.ts --project=chromium --workers=1`.

---

### Task 4: Localize operations, integrations, and help screens

**Files:**
- Modify: `apps/web/src/lib/i18n/translations.ts`
- Modify: `apps/web/src/pages/ConnectionsPage.tsx`
- Modify: `apps/web/src/pages/ExecutionsPage.tsx`
- Modify: `apps/web/src/pages/ExecutionDetailPage.tsx`
- Modify: `apps/web/src/pages/HelpPage.tsx`
- Modify: `apps/web/src/pages/AiGeneratorPage.tsx`
- Modify: `apps/web/src/pages/TelegramPage.tsx`
- Modify: `apps/web/src/pages/NotificationsPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Test: `apps/web/e2e/localization.spec.ts`

**Interfaces:**
- Consumes: Existing i18n API and operational/sample data.
- Produces: Localized ordinary screen copy while retaining diagnostic identifiers, code samples, provider names, and genuine sample names.

- [ ] Add focused VI/EN assertions for operational and integrations pages and verify RED.
- [ ] Complete paired translations and replace remaining interface literals; leave raw diagnostic payloads/identifiers unchanged.
- [ ] Run: `pnpm --dir apps/web test:e2e -- e2e/localization.spec.ts --project=chromium --workers=1`.

---

### Task 5: Audit locale parity and verify the UI

**Files:**
- Modify: `apps/web/e2e/localization.spec.ts`
- Modify: `docs/work_logs/2026-09-23-web-localization-cleanup.md`

**Interfaces:**
- Consumes: Final VI/EN translations and app routes.
- Produces: Key-parity assertion, locale route smoke coverage, responsive browser screenshots, and a reproducible work log.

- [ ] Assert VI and EN dictionary key parity and scan changed page markup for remaining hardcoded ordinary UI copy.
- [ ] Run focused Playwright in Chromium at desktop and narrow widths, covering representative routes in VI and EN.
- [ ] Run: `pnpm --dir apps/web lint`, `pnpm --dir apps/web build`, and `git diff --check`.
- [ ] Record changed files, exact results, screenshots, fixture/mock limitation, and remaining intentional English technical/data text in the work log.
