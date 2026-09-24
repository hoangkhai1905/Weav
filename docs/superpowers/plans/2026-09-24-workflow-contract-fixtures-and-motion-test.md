# Workflow Contract Fixture and Motion Test Implementation Plan

> **For agentic workers:** Execute inline in the existing isolated `codex/workflow-service-merge-check` worktree. Do not commit or merge into the dirty `api-gateway` checkout.

**Goal:** Make the two Workflow contract tests see shared contract assets in Java 25 Docker builds and make the active-edge Playwright test deterministic without changing reduced-motion behavior.

**Architecture:** Keep `services/workflow-service` as the primary Docker build context and expose only `packages/contracts` as a named additional context. Copy that context to the filesystem path already resolved by the tests. In Playwright, explicitly emulate `no-preference` only in the animation-positive test; preserve the adjacent test that verifies reduced motion suppresses animation.

**Tech Stack:** Docker Compose BuildKit named contexts, Java 25, Maven, Playwright, Vite.

**Spec:** User-approved bounded task in the current conversation; baseline evidence and boundaries are recorded in `docs/work_logs/T/2026-09-24-workflow-v1-web-integration.md`.

## Global Constraints

- Stay in `C:/Users/nguye/.codex/worktrees/workflow-service-merge-check/Weav` on `codex/workflow-service-merge-check`.
- Do not modify the original `D:/End/Weav` checkout, commit, or merge.
- Do not mount a Docker socket, start Testcontainers, alter databases, or delete volumes.
- Do not broaden the Workflow Docker build context to the repository root or include secrets.
- Do not change production animation or accessibility behavior.
- Keep existing merge/user edits intact and update the focused work log.

---

### Task 1: Provide shared contracts to Workflow Docker builds

**Files:**
- Modify: `compose.dev.yml`
- Modify: `compose.workflow-smoke.yml`
- Modify: `services/workflow-service/Dockerfile.dev`
- Verify: `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodecTest.java`
- Verify: `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/ocr/OcrClientContractTest.java`

**Interfaces:**
- Both Compose services retain `./services/workflow-service` as primary context and declare named context `contracts: ./packages/contracts`.
- Dockerfile copies only the named contracts context to `/packages/contracts`; existing test paths from `/app` resolve there.

- [x] Reproduce the current two-test failure in a Java 25 container using only the service directory as build context.
- [x] Add named contracts context to both Compose definitions and copy it into the existing expected path in `Dockerfile.dev`.
- [x] Rebuild both Compose variants and rerun the two affected tests (`9/9` pass).
- [x] Rerun the focused 226-test Maven allowlist in the Java 25 container; do not mount host Docker socket (`226/226` pass).

### Task 2: Make the animation-positive Playwright test deterministic

**Files:**
- Modify: `apps/web/e2e/workflow-ui.spec.ts`
- Verify: the sibling reduced-motion preview test in the same file.

**Interfaces:**
- The animation-positive test explicitly emulates `reducedMotion: 'no-preference'`.
- The existing reduced-motion test remains unchanged and continues to assert that preview animation is suppressed.

- [x] Reproduce failure by running the animation assertion with `reducedMotion: 'reduce'`.
- [x] Set `reducedMotion: 'no-preference'` in the animation-positive test only and wait for fixture edges before preview.
- [x] Run both Workflow UI/catalog Playwright specs in Chromium: final serial rerun PASS `33/33`; OCR preview also passed in 9/9 isolated repetitions. One earlier full run hit transient browser `ERR_NO_BUFFER_SPACE`, then its isolated test and the full suite both passed.

### Task 3: Review and hand back for user review

- [x] Audit staged, unstaged, and untracked state; keep all pre-existing work intact (303 status entries: 287 staged, 13 unstaged, 4 mixed, 8 untracked; 0 unmerged paths).
- [x] Run `git diff --check` and `git diff --cached --check`.
- [x] Update the focused work log with red/green evidence, test counts, and remaining blockers.
- [x] Do not commit or merge; report the full-suite Docker/Testcontainers limitation.
