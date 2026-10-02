# Weav agent CLI operations

This repository uses only `T:\Weav` as the canonical workspace for external agent CLI calls. The historical `T:\Weav_Alias` and `E:\WeavSub` paths are not valid inputs.

The launcher runs on Windows PowerShell 5.1 or newer and lives at `scripts\agent-cli.ps1`.

If Windows blocks local `.ps1` execution, add `-ExecutionPolicy Bypass` to this one PowerShell process (before `-File`). This does not change the machine/user execution policy. A managed sandbox without a Windows user profile returns code 20 (`windows-user-profile-unavailable`); use the approved runner with the real profile rather than changing repository paths.

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

### Modes and models

- Antigravity receives `--mode plan` or `--mode accept-edits`. An explicit `-Model` is forwarded as `--model`; the verified catalog includes `gemini-3.8-flash-high`. Omitting it leaves selection to Antigravity.
- OpenCode receives `--agent plan` or `--agent build`. In Plan, the bridge supplies a child-process-only `OPENCODE_PERMISSION` policy denying all tools except read/glob/grep. This also denies shell, writes, delegation, and MCP tools; the built-in plan agent alone does not guarantee that boundary. Read rules deny `.env` and `.env.*`; this is a mutation boundary, not a comprehensive data-isolation sandbox (grep has separate semantics).
- OpenCode AcceptEdits retains existing permissions, including any caller-supplied process permission policy. It does not automatically approve every tool.
- When restricting OpenCode writes with `OPENCODE_PERMISSION`, the installed CLI checks `edit` against a **worktree-relative** path (for example `.agent-tests/your-probe/worker.cjs`), not the absolute path. `edit` covers the write tool. Include the Windows separator form where needed; grant only the intended paths and any required directory reads. Live synthetic writes passed after this correction.
- Antigravity Plan can deny `read_file` in headless mode even in a trusted workspace. A live AcceptEdits probe successfully created a synthetic file without changing global settings. Do not assume a workspace trust entry grants every headless permission; inspect the returned diagnostic.

Example from CMD for an explicitly authorized coding task:

```bat
cd /d T:\Weav
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Action Check -Tool Auto
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\agent-cli.ps1 -Action Run -Tool Antigravity -Model gemini-3.8-flash-high -Mode AcceptEdits -TimeoutSec 300 -AllowRepoContext -Prompt "Implement only the approved task and report changed files and test results."
```

Replace the example prompt with the actual approved file scope and acceptance criteria before running it.

## Selection and fallback

- `-Tool Auto` selects Antigravity first when its executable and `T:\Weav` trust check are ready; otherwise it selects OpenCode when its model catalog is ready.
- Selection happens before the child process starts. A started task is never automatically duplicated after a failure or timeout.
- `helper_unknown_error: setup refresh had errors` is a runner/environment failure, not evidence of a source failure. Retry the same bounded command once through the approved elevated runner, then switch to a subagent if the runner remains unavailable.
- Provider/account errors, policy rejection, and concurrency limits are infrastructure blockers. Stop retrying the same request and choose a ready provider/tool or fix the provider configuration.
- Review the worktree after every external agent call; an agent result is not proof that tests or the real user flow passed.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Check ready, or child completed with nonempty stdout; not proof of a correct implementation |
| 10 | Tool/provider/model unavailable; use the reported fallback |
| 20 | Workspace, trust, permission, or invocation precondition failed |
| 30 | Hard timeout; the launched process was terminated |
| 40 | Child CLI failed, or exited 0 with empty stdout (`empty-response`) |

The script does not persist prompts, tokens, cookies, raw environment values, or raw CLI logs.

Up to five stderr lines (240 characters each) are emitted as redacted diagnostics, including when the child succeeds or times out. Common credential/header patterns are masked; this is best-effort redaction, so keep prompts and requested output free of credentials. Check the actual artifact and execute independent tests: one live OpenCode probe claimed a write succeeded while no file existed after a tool permission denial.

Run the local regression checks without provider calls:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\agent-cli.tests.ps1
```

## Current configuration note

The OpenCode global `claude-mem` plugin is intentionally disabled for now because it repeatedly reported `Plugin export is not a function`. Its file is preserved for a later explicit reconfiguration. Antigravity's unrelated user trust entry remains intact; this project uses the canonical `T:\Weav` entry only.
