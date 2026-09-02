# Work Log"��y��y� 2026-09-02+�u���T Agent guidance

## 1. Metadata

- Project: Weav
- Scope: root agent guidance and work-process documentation
- Date: 2026-09-02
- Owner: AI agent

## 2. Summary

Added the approved project context and collaboration rules to AGENTS.md, then mirrored the guidance in CLAUDE.md. Added a small implementation plan for traceability.

## 3. Decisions

- Keep the existing GitNexus block in both files.
- Treat Ponytail as the default coding-quality policy while retaining validation, security, accessibility, logging, error handling, and tests.
- Require bounded refactoring, backward-compatible API/schema evolution, affected-service tests, real Playwright verification for web/Expo Web, and work-log updates.
- Use focused same-day logging so the existing docs/work_logs/2026-09-02.md remains untouched.

## 4. Changed files

- AGENTS.md: added project, architecture, workflow, skill, testing, security, logging, Git, and completion guidance.
- CLAUDE.md: mirrored the same guidance.
- docs/superpowers/plans/2026-09-02-agents-guidance.md: recorded the implementation plan.

## 5. Verification

| Check | Result |
| --- | --- |
| GitNexus impact for AGENTS.md | UNKNOWN; file is not a graph symbol. Confirmed by targeted text search; no code caller path. |
| Existing worktree status | Clean before edits on dev. |
| Runtime tests | Not applicable; documentation-only change. |
| git diff --check | PASS. |
| GitNexus detect-changes | PASS: No changes detected. |

## 6. Risks and handoff

- The GitNexus index currently reports zero indexed symbols for this repository; future code edits must still follow the UNKNOWN handling rule in the guidance.
- The stack summary is a current project decision and should be updated if repository manifests or architecture change.

## 7. End session

- Status: complete; documentation checks passed and the tracked plan/log were committed.
- Commit: d63777a (docs: add agent workflow guidance)
- Note: AGENTS.md and CLAUDE.md are local ignored files and were intentionally not force-added.
- No secrets, credentials, tokens, connection strings, or personal data recorded.
