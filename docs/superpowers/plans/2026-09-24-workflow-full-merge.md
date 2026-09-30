# Workflow Service Full Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the complete `origin/feature/workflow-service` ancestry, including its docs/work-log reorganizations and current FE real-API integration, into `api-gateway` without losing the main checkout's 146 dirty entries.

**Architecture:** Finish the already-prepared merge in `codex/workflow-service-merge-check`, review and test the complete staged plus unstaged/untracked milestone, then commit the merge there. In the dirty main checkout, save only the eight exact overlapping user-modified files in a verified recoverable stash, merge the completed integration branch, and reapply/reconcile those eight changes while verifying every non-overlap dirty/untracked path remains intact.

**Tech Stack:** Git merge/stash, GitNexus 1.6.5, pnpm, React/Vite/Playwright, Java 25 Maven container where available.

**Spec:** `packages/contracts/http/workflow/README.md`, `services/workflow-service/README.md`, and this task's explicit full-ancestry merge request.

## Global Constraints

- Target checkout starts at `api-gateway` / `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02` with 146 compact dirty entries; preserve all of them and all existing stash entries.
- Source worktree is `codex/workflow-service-merge-check`, with `MERGE_HEAD=688eb6d8cceb58a2feb59048afd819496ca3102d`; merge the full ancestry including docs moves/deletions.
- The only main-checkout overlaps to temporarily preserve/reconcile are `.env.example`, `apps/web/src/pages/CreateWorkflowPage.tsx`, `ExecutionDetailPage.tsx`, `ExecutionsPage.tsx`, `WorkflowBuilderPage.tsx`, `WorkflowsPage.tsx`, `apps/web/src/types/workflow.types.ts`, and `compose.dev.yml`.
- Never use broad stash, reset, force overwrite, `checkout --`, push, PR, Testcontainers Cloud, host Docker socket, or privileged DinD. Never drop a stash/backup.
- Full Maven suite has 116 Testcontainers cases still unverified; report the gap, never call the suite green.
- Stop on setup `helper_unknown_error`, unexpected conflicts/overwrites, partial GitNexus results, failed preservation checks, or product test failures; retain the exact state and recovery object ID.

---

### Task 1: Record preflight and checkpoints

**Files:**
- Create: `docs/superpowers/plans/2026-09-24-workflow-full-merge.md`
- Read: current worktree/main status, refs, stash list, overlap diffs, compose/test configuration

- [x] Recheck both branch/HEAD states, `MERGE_HEAD`, full source ref, compact/expanded statuses, exact eight overlap paths, and stash object IDs.
- [x] Record SHA-256 for all 146 main dirty/untracked paths and content/diff fingerprints for the eight overlaps without printing secrets.
- [x] Confirm the saved source worktree merge has zero unmerged paths and its current changes are exactly the expected Workflow merge plus FE integration and audit artifacts.

### Task 2: Complete and verify the isolated merge milestone

**Files:**
- Stage the already-reviewed Workflow Service, contracts, docs/work-log reorganizations, Web FE integration, tests, work log, and this plan.
- Do not include `.env` files, secrets, generated artifacts, or unrelated paths.

- [x] Review the full intended staged manifest, including documentation moves/deletions and all eight untracked integration files; inspect config files for secret values without printing them.
- [x] Stage only the intended complete milestone, then run `node D:\End\Weav\.gitnexus\run.cjs detect-changes --scope all --repo weav-workflow-isolated` and obtain structured counts/flows. Confirm no partial/truncated result; review all affected flows even if risk remains CRITICAL.
- [x] Run `git diff --check` and `git diff --cached --check`.
- [x] Run Web typecheck/build, serial mock UI/catalog Playwright suite, and the focused Java 25 container tests feasible without Docker socket; record full Maven/Testcontainers as unverified. The prior isolated real-mode browser/API smoke is documented in the work log; it was not repeated against the currently running shared dev stack to avoid mutating user services/data.
- [ ] Commit the complete isolated merge milestone only if every runnable required check passes and the manifest contains no unrelated/secrets/generated paths. Preserve the branch/worktree.

### Task 3: Preserve exact main overlaps and integrate full ancestry

**Files:**
- Main overlaps listed in Global Constraints; no other main path may be altered by recovery operations.

- [ ] Reconfirm main HEAD/status/stash IDs immediately before mutation. Create a path-limited recovery stash for the eight overlaps only; inspect its tree/diff and verify object ID, all eight paths, and original staged/working content before any main merge.
- [ ] Verify all other dirty/untracked main paths still match their preflight status and SHA-256 manifest.
- [ ] Merge the completed isolated branch into `api-gateway` without pulling or resetting. If Git reports a conflict outside the eight expected overlaps or changes an unapproved path, stop.
- [ ] Reapply the exact-path recovery object and reconcile each of the eight files to retain both existing user edits and Workflow behavior. Do not drop the recovery object; if reconciliation is ambiguous, stop and report the object ID.

### Task 4: Verify merged main and hand off

**Files:**
- Append merge evidence and the Maven verification gap to `docs/work_logs/T/2026-09-24-workflow-v1-web-integration.md` or an equivalent focused log in the main checkout only after its path/state is confirmed safe.

- [ ] Verify full source ancestry is reachable from main, current HEAD/merge state, all pre-existing dirty/untracked paths and content outside the eight overlaps, and both stashes plus the new recovery stash remain present.
- [ ] Review each overlap diff semantically; run `git diff --check`, Web build, focused Workflow/UI tests, and available live contract/browser checks on main. Do not claim full Maven/Testcontainers green.
- [ ] Report the isolated merge commit, main merge status, preserved recovery object ID, exact test results, remaining Maven gap, current dirty count, and no-push status. Leave worktree/branch and recovery stash for user review.
