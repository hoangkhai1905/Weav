# Work Log — 2026-09-10 — Agent guidance update

## Metadata

- Project: Weav
- Scope: repository agent guidance and collaboration rules
- Branch: `feat/identity-service`
- Owner: AI agent
- Status: Complete; documentation changes are uncommitted

## Summary

Updated `AGENTS.md` with the requested execution and communication rules:

- Stop immediately on `helper_unknown_error: setup refresh had errors` and wait for the user.
- Allow small logical-batch or milestone commits and report them briefly for user push.
- Keep updates concise.
- Ask the user when anything is unclear; do not infer or invent facts.

## Changed files

- `AGENTS.md`: added communication/execution rules and adjusted commit guidance.
- `docs/work_logs/2026-09-10-agents-guidance.md`: recorded this change.

## Verification

| Check | Result |
| --- | --- |
| `git diff --check` | PASS |
| Runtime tests | Not applicable; documentation-only change |
| Secrets or `.env` values recorded | None |

## Handoff

- Changes are not committed yet; commit them together or as the next small documentation batch when requested.
- Worktree status should be checked before the next commit.
