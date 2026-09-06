# Agent CLI Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a bounded, preflighted launcher for OpenCode and Antigravity that always uses `T:\Weav` and reports reliable fallback states.

**Architecture:** A repository-owned PowerShell script validates the canonical workspace and CLI prerequisites, then starts exactly one child process with captured output and a hard timeout. A short operations document defines safe commands and fallback semantics; global configuration only disables the known-broken OpenCode plugin and removes the stale trusted alias.

**Tech Stack:** Windows PowerShell 5.1-compatible script, installed `opencode 1.18.21`, installed `agy 1.1.27`, Markdown documentation, existing Windows user-level JSON configuration.

---

### Task 1: Add the bounded launcher

**Files:**
- Create: `scripts/agent-cli.ps1`

- [ ] **Step 1: Add explicit parameters and stable exit codes.**

Define `-Action Check|Run`, `-Tool Auto|Antigravity|OpenCode`, `-Prompt`, `-Model`, `-Mode Plan|AcceptEdits`, `-TimeoutSec`, and `-AllowRepoContext`. Reject missing prompts for `Run`, reject non-positive timeouts, and reject any path other than the resolved `T:\Weav` root.

- [ ] **Step 2: Add secret-free preflight checks.**

Check `agy`/`opencode` with `Get-Command`, collect only executable names and versions, verify `T:\Weav` exists, reject `T:\Weav_Alias` and `E:\WeavSub`, verify Antigravity trust, and reject removed `agentrouter/*` models. For OpenCode, query the model catalog without printing credential contents; use `opencode/big-pickle` when no model is supplied and classify a missing provider/model as exit code `10`.

- [ ] **Step 3: Add one-shot child-process execution.**

Use `System.Diagnostics.ProcessStartInfo.Arguments` with a Windows CRT-safe quoting helper so prompts and paths are passed as arguments rather than interpolated shell text. Redirect stdout/stderr, wait for `TimeoutSec`, terminate only the launched process tree on timeout, and map success/failure/timeout to codes `0`, `40`, and `30`.

- [ ] **Step 4: Add safe CLI arguments.**

Use `agy --print ... --output-format text --mode plan --sandbox --print-timeout ...` for the default mode; allow `accept-edits` only when explicitly requested. Use `opencode run --pure --dir T:\Weav -m opencode/big-pickle ...` unless `-Model` supplies another catalog model, and never add `--auto`. Do not retry after process start.

- [ ] **Step 5: Run script syntax and preflight checks.**

Run:

```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\scripts\agent-cli.ps1), [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw ($errors | Out-String) }
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Antigravity
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool OpenCode
```

Expected: no parse errors; Antigravity check succeeds; OpenCode reports `opencode/big-pickle` as available rather than relying on the removed AgentRouter provider.

### Task 2: Add operator documentation

**Files:**
- Create: `docs/agent-cli-operations.md`

- [ ] **Step 1: Document the canonical commands.**

Document these exact examples:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Antigravity
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool Antigravity -Mode Plan -AllowRepoContext -Prompt "Inspect the requested files and return a bounded implementation plan before making changes."
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool OpenCode -Mode Plan -AllowRepoContext -Prompt "Inspect the requested files and return a bounded implementation plan before making changes."
```

Explain that `Auto` chooses only before starting a request, timeout/failure is not retried automatically, and `helper_unknown_error` is a runner failure that should receive one bounded elevated retry before switching to a subagent.

- [ ] **Step 2: Document safety and fallback rules.**

State that the launcher uses only `T:\Weav`, never uses the historical aliases, never logs secrets or raw prompts, never uses dangerous auto-approval flags, and treats provider/account/policy/concurrency failures as infrastructure blockers rather than code failures.

### Task 3: Apply the approved global configuration cleanup

**Files:**
- Modify: `C:\Users\nhoan\.config\opencode\opencode.json`
- Modify: `C:\Users\nhoan\.gemini\antigravity-cli\settings.json`

- [ ] **Step 1: Disable only OpenCode's broken plugin.**

Remove the ineffective OpenCode plugin key and rename the auto-discovered `plugins\claude-mem.js` to `plugins\claude-mem.js.disabled`; preserve the file contents, `opencode.jsonc`, and the GitNexus MCP entry for a later explicit reconfiguration.

- [ ] **Step 2: Remove only the stale trusted alias.**

Keep `C:\Users\nhoan` and `T:\Weav` in Antigravity's trusted workspace list; remove `T:\Weav_Alias`. Do not remove unrelated user data or settings.

- [ ] **Step 3: Verify resolved configuration.**

Run:

```powershell
opencode debug config
agy --version
Get-Content -Raw 'C:\Users\nhoan\.gemini\antigravity-cli\settings.json'
```

Expected: resolved OpenCode `plugin` is empty, `plugins\claude-mem.js.disabled` exists, GitNexus MCP remains configured, Antigravity reports `1.1.27`, and only `T:\Weav` is retained for this project.

### Task 4: End-to-end smoke and handoff log

**Files:**
- Create: `docs/work_logs/2026-09-06-agent-cli-reliability.md`

- [ ] **Step 1: Run bounded runtime checks.**

Run:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool Antigravity -Mode Plan -TimeoutSec 60 -AllowRepoContext -Prompt "Reply exactly AGENT_BRIDGE_SMOKE_OK"
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool OpenCode
opencode debug config
git diff --check
```

Expected: Antigravity returns the marker within 60 seconds; OpenCode preflight sees its built-in model; no claude-mem export error appears; diff check passes.

- [ ] **Step 2: Record evidence and limits.**

Use the existing work-log template. Record changed files, commands, versions, exit classifications, the pre-existing worktree changes preserved, and the fact that OpenCode remains unavailable until a provider credential is configured. Do not record any secret, token, raw prompt, or raw CLI log.

- [ ] **Step 3: Review scope before handoff.**

Run `git status --short --untracked-files=all`, `git diff --stat`, `git diff --name-status`, and `git diff --check`. Do not commit; the user did not request a commit and existing changes must remain untouched.
