# Weav agent CLI operations

This repository uses only `T:\Weav` as the canonical workspace for external agent CLI calls. The historical `T:\Weav_Alias` and `E:\WeavSub` paths are not valid inputs.

The launcher runs on Windows PowerShell 5.1 or newer and lives at `scripts\agent-cli.ps1`.

## Preflight

Check both installed CLIs without sending a task prompt:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Auto
```

The output is secret-free and includes the tool, readiness, version, exit code, and reason. `Auto` checks both tools but does not run a task.

## Run a task

Every task that can inspect or change this private repository must opt in explicitly:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool Antigravity -Mode Plan -TimeoutSec 300 -AllowRepoContext -Prompt 'Inspect the requested files and return a bounded implementation plan before making changes.'
```

For OpenCode, the launcher runs with `--pure` so the broken global `claude-mem` plugin cannot interfere. It uses `opencode/big-pickle` by default; pass `-Model 'provider/model'` only after that model appears in `opencode models`:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool OpenCode -Mode Plan -TimeoutSec 300 -AllowRepoContext -Prompt 'Inspect the requested files and return a bounded implementation plan before making changes.'
```

`Plan` is the default. `AcceptEdits` must be explicit:

```powershell
powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Run -Tool Antigravity -Mode AcceptEdits -TimeoutSec 600 -AllowRepoContext -Prompt 'Implement the approved change and report the exact files and verification results.'
```

The launcher never adds `--dangerously-skip-permissions` or OpenCode `--auto`. Antigravity keeps its sandbox restriction enabled.

## Selection and fallback

- `-Tool Auto` selects Antigravity first when its executable and `T:\Weav` trust check are ready; otherwise it selects OpenCode when its model catalog is ready.
- Selection happens before the child process starts. A started task is never automatically duplicated after a failure or timeout.
- `helper_unknown_error: setup refresh had errors` is a runner/environment failure, not evidence of a source failure. Retry the same bounded command once through the approved elevated runner, then switch to a subagent if the runner remains unavailable.
- Provider/account errors, policy rejection, and concurrency limits are infrastructure blockers. Stop retrying the same request and choose a ready provider/tool or fix the provider configuration.
- Review the worktree after every external agent call; an agent result is not proof that tests or the real user flow passed.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Check or request completed |
| 10 | Tool/provider/model unavailable; use the reported fallback |
| 20 | Workspace, trust, permission, or invocation precondition failed |
| 30 | Hard timeout; the launched process was terminated |
| 40 | Child CLI failed after it started |

The script does not persist prompts, tokens, cookies, raw environment values, or raw CLI logs.

## Current configuration note

The OpenCode global `claude-mem` plugin is intentionally disabled for now because it repeatedly reported `Plugin export is not a function`. Its file is preserved for a later explicit reconfiguration. Antigravity's unrelated user trust entry remains intact; this project uses the canonical `T:\Weav` entry only.
