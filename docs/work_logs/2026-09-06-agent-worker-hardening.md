# Nhật ký ngày 2026-09-06 — Agent worker bridge hardening

## 1. Metadata

- Repository/workspace: Weav, `T:\Weav`; timezone Asia/Saigon.
- Branch/start: `feat/identity-service`, `3221762`.
- Coordinator owns bridge/docs; independent Codex agent owns regression test and OpenCode investigation/probes.
- User approved bridge fixes and synthetic worker file writes; no commit requested.

## 2. Tóm tắt điều hành

- Bridge now forwards Antigravity Model, surfaces bounded redacted stderr, and rejects empty stdout even with child exit 0.
- OpenCode Plan uses a child-only deny-by-default permission policy; AcceptEdits selects build without permission bypass.
- Regression suite: 11/11 passed, including actual child environment propagation.
- Antigravity and OpenCode each created real synthetic CommonJS code files that passed 10/10 independent Node assertions.
- This validates bounded worker tasks, not general model superiority or reliable large-service implementations.

## 3. Mục tiêu và phạm vi

- Fix diagnosed launcher behavior and validate real file artifacts, not only model claims.
- Preserve canonical cwd, explicit AcceptEdits, timeout, no automatic duplication of started tasks, global settings, and application code.
- Disposable files isolated under `.agent-tests/worker-12cf8ff53af14a628a1a463fe7650fe5`; each external worker owns separate files.

## 4. Bối cảnh và giả định

- Prior untracked `docs/work_logs/2026-09-06-worker-probe.md` preserved.
- Antigravity 1.1.27 catalog confirms `gemini-3.8-flash-high`; explicitly selected for all new Anti probes.
- OpenCode 1.18.21 uses `opencode/big-pickle`.
- Skills: brainstorming, writing-plans, GitNexus impact, parallel-execution-optimizer, dispatching-parallel-agents, verification-before-completion.

## 5. Nhật ký session

1. Read launcher, operations, prior work log, template, skills; inspect git status.
2. Run GitNexus impact on Invoke-AgentRequest, Get-SafeDiagnostic, Get-Preflight, Invoke-CapturedProcess: UNKNOWN / target not found. Refresh index with `node .gitnexus/run.cjs analyze --index-only` through real user-profile runner; index completed (3,412 nodes, 6,161 edges), FTS dependency unavailable. Repeated impact remains UNKNOWN for PowerShell symbols.
3. Manual caller inspection: Invoke-CapturedProcess serves model catalog and request execution; Get-SafeDiagnostic serves request diagnostics; Invoke-AgentRequest is called by launcher entrypoint. No application-service callers found. Graph risk remains unresolved; manually bounded launcher scope and regression/live checks provide additional evidence.
4. Installed CLI help proves Anti --model support. OpenCode debug and embedded installed implementation prove Plan alone still permits shell/plan edits, and write checks permission edit against a worktree-relative path.
5. Regression baseline 2 pass / 7 fail; initial repair 9/9 pass; independent review adds header/diagnostic tests, reproduces credential-header leak; fix yields 11/11 pass.
6. Anti Plan root package.json request, explicitly authorized by user, exits with no answer. Newly surfaced stderr says read_file auto-denied because headless mode cannot prompt. Bridge now returns code 40 rather than false success.
7. Anti AcceptEdits creates antigravity.cjs; actual file verified, independent tests 10/10 pass. No global permission changes.
8. OpenCode exact-file read scope denies parent-directory read; model falsely claims write success, but artifact absent. Controlled new probe with directory read removes that blocker but absolute edit rule still denies write. Inspect installed code before another call: write uses relative edit pattern. New v3 probe with corrected relative rule creates opencode-v3.cjs; 10/10 tests pass. These were explicit configuration-correction probes, not automatic replay of a started request.
9. Auto-review rejected OpenCode Plan root-package egress; replaced with a synthetic JSON fixture. Live Plan reads correct fixture marker and reports PLAN_WRITE_DENIED; sentinel file absent. No pending request to export private repository data to OpenCode.

## 6. Quyết định kỹ thuật

- Keep one launcher and existing defaults; no new orchestration framework.
- Plan child OPENCODE_PERMISSION denies unspecified tools and allows read/glob/grep; explicitly denies read of *.env and *.env.*. This enforces mutation restrictions, not complete data isolation through grep.
- Preserve AcceptEdits permissions and allow callers to supply scoped process rules. No --auto or --dangerously-skip-permissions.
- Emit first five nonempty stderr lines, each redacted and capped at 240 characters, on success/failure/timeout. Redaction is best-effort, not authorization to request secrets.
- Count correctness only after checking actual files and independent assertions.

## 7. Thay đổi đã thực hiện

- scripts/agent-cli.ps1: child environment overrides, model forwarding, OpenCode mode enforcement, empty-output failure, stderr diagnostics/redaction, explicit missing-user-profile error.
- Documentation and dependency-free tests only; no application/API/database/global settings changes.

## 8. Danh sách file ảnh hưởng

- Modified scripts/agent-cli.ps1 and docs/agent-cli-operations.md.
- Added scripts/agent-cli.tests.ps1 (11 regression checks).
- Added scripts/agent-worker.acceptance.cjs (10 independent task-order requirements).
- Added focused design, plan, and this work log; retained prior probe log.

## 9. Kiểm tra và bằng chứng

| Check | Command / evidence | Result |
| --- | --- | --- |
| Parser/regressions | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/agent-cli.tests.ps1` | 11/11 PASS |
| Preflight | Same PowerShell launcher, `-Action Check -Tool Auto` | Both ready |
| Anti creation | `-Action Run -Tool Antigravity -Model gemini-3.8-flash-high -Mode AcceptEdits -TimeoutSec 90 -AllowRepoContext` with exact synthetic file scope | Actual file, 10/10 PASS |
| OpenCode creation | `-Tool OpenCode -Mode AcceptEdits -TimeoutSec 120`, process policy with relative edit allow | Actual v3 file, 10/10 PASS |
| Worker correctness | `node scripts/agent-worker.acceptance.cjs <worker.cjs>` | empty, chain, initial/newly-unlocked lexical order, duplicates, unknown dep, cycle, self-cycle, repeated dep, frozen input |
| OpenCode Plan | Synthetic fixture readback + absent write sentinel | PASS |
| Anti Plan | Authorized root package readback | BLOCKED by headless read_file permission; now diagnosed |

- Initial Anti generated file SHA256: 5A4233843CA638CAD38015E34F1D18A518EEF51AA9232583A6D40B8F03273097.
- OpenCode v3 SHA256: 462CA603D86E90150F3636181E064DFF04A512411E0D7AC1AFCB48AAE297862E.
- No app build/browser tests: no product code changes. No graph clean verdict claimed for unindexed PowerShell symbols.

## 10. Sự cố, rủi ro và blocker

- Anti Plan read_file requires an allow rule or interactive approval. No global grant applied. AcceptEdits creation works in the tested scope.
- OpenCode may report completion without a successful artifact; the bridge validates process output, not implementation semantics.
- Scoped OpenCode read/write path behavior differs; write/edit uses worktree-relative patterns. Provider diagnostics can include benign denied exploratory reads even when the assigned write succeeds.
- Index FTS unavailable and PowerShell impact UNKNOWN; no application changes based on these tooling failures.

## 11. Trạng thái bàn giao

- User need not run CMD or provide credentials to use the verified bounded AcceptEdits worker flow.
- Always run preflight, set exact worker file ownership, inspect artifact/diff, and execute meaningful acceptance checks.
- Anti read/edit follow-up and final cleanup recorded at session close below.

## 12. Tham chiếu

- docs/agent-cli-operations.md
- docs/work_logs/2026-09-06-worker-probe.md
- docs/superpowers/specs/2026-09-06-agent-worker-hardening-design.md
- docs/superpowers/plans/2026-09-06-agent-worker-hardening.md
- Installed agy --help/models; installed OpenCode help/debug/embedded permission implementation.
- https://opencode.ai/docs/permissions/

## 13. Kết thúc session

- No commit/PR created; application files preserved.
- Final checks, read/edit follow-up, and cleanup results appended before handoff.
