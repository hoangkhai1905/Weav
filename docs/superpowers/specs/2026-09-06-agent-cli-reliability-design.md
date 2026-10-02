# Agent CLI Reliability Design

## Goal

Make OpenCode CLI and Antigravity CLI predictable to invoke from the Weav repository, with explicit workspace selection, preflight checks, bounded execution, and actionable fallback signals.

## Current findings

- The only supported Weav checkout for this workflow is `T:\Weav`.
- `agy 1.1.27` is installed and completed a bounded read-only smoke prompt.
- OpenCode `1.18.21` is installed; the current environment has no configured OpenCode credentials and no `agentrouter` provider, but its built-in `opencode/big-pickle` model completed a bounded smoke prompt with `--pure`.
- OpenCode's global `claude-mem.js` plugin repeatedly fails with `Plugin export is not a function`.
- The old `T:\Weav_Alias` trusted-workspace entry is stale and must not be used.

## Chosen design

Add one repository-owned PowerShell launcher at `scripts/agent-cli.ps1`.

The launcher exposes two actions:

- `check`: validate the canonical workspace, executable, version, trust/configuration, and (when requested) provider/model readiness without sending a task prompt.
- `run`: execute one CLI request with a hard timeout, explicit tool, explicit mode, and stable exit codes. It never retries a request after the child process has started.

`Auto` selection is allowed only before execution. It prefers Antigravity when its local preflight is ready, then OpenCode when its model catalog preflight is usable. A failed or timed-out started request is reported to the caller; it is never duplicated automatically.

The launcher defaults to:

- canonical working directory `T:\Weav`;
- Antigravity `plan` mode and `--sandbox`;
- no `--dangerously-skip-permissions` and no OpenCode `--auto`;
- OpenCode model `opencode/big-pickle` unless an explicitly configured model is supplied;
- a bounded timeout;
- an explicit `-AllowRepoContext` gate for prompts that may read or modify this private repository.

OpenCode's broken global `claude-mem` plugin is disabled by removing its config entry and renaming the auto-discovered file to `claude-mem.js.disabled`; the file and MCP configuration remain available for a later reconfiguration. The stale Antigravity trusted-workspace alias is removed; unrelated global trust entries are preserved.

## Error contract

The launcher prints short, secret-free diagnostics and returns:

| Exit code | Meaning |
| ---: | --- |
| 0 | Request or check completed successfully |
| 10 | Tool/provider/model is unavailable; use the reported fallback |
| 20 | Workspace or permission precondition failed |
| 30 | Child process exceeded the hard timeout |
| 40 | Child CLI failed after it started |

Known provider failures such as missing credentials, removed AgentRouter, policy rejection, and concurrency limits are surfaced as distinct diagnostic reasons. The launcher does not expose tokens, prompts, cookies, or raw environment values.

## Verification

- Parse the PowerShell script before execution.
- Run `check` for both tools against `T:\Weav`.
- Run one bounded Antigravity smoke prompt through the launcher.
- Run OpenCode preflight and confirm it sees `opencode/big-pickle` without hanging.
- Confirm direct OpenCode startup no longer logs the claude-mem export error.
- Confirm the stale alias is absent from Antigravity's trusted-workspace settings and `T:\Weav` remains trusted.
- Run `git diff --check` and inspect the final diff while preserving the pre-existing `.env.example` and identity planning files.
