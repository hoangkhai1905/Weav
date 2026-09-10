# Agent Worker Hardening Implementation Plan

> Execution: coordinator owns bridge/docs; independent agent investigates OpenCode CLI behavior and later reviews/tests. User already approved the bounded repair and synthetic worker test.

**Goal:** Make external worker failures visible, enforce OpenCode Plan, and verify real file-writing workers.

**Architecture:** Keep the existing PowerShell launcher and canonical repository. Add minimal result validation and supported CLI arguments. Preserve explicit authorization and timeouts.

**Tech Stack:** Windows PowerShell 5.1, installed Antigravity/OpenCode, Node built-in assertions.

## Task 1: Diagnose and bind impact

- [x] Read repo guidance, launcher, operations, prior probe evidence, and git status.
- [x] Query upstream GitNexus impact for changed functions; UNKNOWN requires targeted caller inspection.
- [ ] Refresh stale index and repeat graph check where applicable.
- [ ] Confirm OpenCode permissions and Antigravity model/output options from installed tools.

## Task 2: Repair bridge

- [ ] Add script-level regression checks for exit-0 empty response, stderr redaction, explicit model arguments, and Plan/AcceptEdits argument mapping. Extract functions using PowerShell AST to avoid launching a provider in unit checks.
- [ ] Modify scripts/agent-cli.ps1: forward Antigravity Model, enforce OpenCode Plan, show bounded redacted diagnostics, reject empty output with code 40. Preserve canonical cwd and no-retry behavior.
- [ ] Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/agent-cli.tests.ps1`; parse the launcher and inspect diff.

## Task 3: Live acceptance

- [ ] Run launcher Check Auto with real Windows profile.
- [ ] Run Antigravity root package.json readback with explicit `gemini-3.8-flash-high`, Plan, and 90-second timeout. Compare actual values locally.
- [ ] Run separate authorized AcceptEdits probes for each worker on disposable synthetic files. Each task must implement the same specified task-order function; parent executes independent correctness tests and checks file boundaries.
- [ ] Record actual outcomes including permission failures, empty responses, and timeout blockers without automatic retry.

## Task 4: Handoff

- [ ] Independent bridge review and focused regression checks.
- [ ] Update docs/agent-cli-operations.md and focused work log with exact commands/results and remaining limitations.
- [ ] Run git diff --check; preserve existing untracked probe log; no commit.
