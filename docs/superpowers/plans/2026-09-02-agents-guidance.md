# Plan: Add Weav agent guidance

## Goal

Document the approved project context, architecture boundaries, safe implementation workflow, skill routing, testing policy, logging rules, and Git policy in both AGENTS.md and CLAUDE.md.

## Steps

1. Preserve the existing GitNexus instructions in both root guidance files.
2. Add the shared Weav guidance and verified multi-client, multi-service stack.
3. Add approved rules for bounded refactoring, compatibility, parallel work, Ponytail, relevant skills, Playwright, secrets, and work logs.
4. Record the change in a focused same-day work log without sensitive data.

## Verification

- Compare the shared guidance sections in AGENTS.md and CLAUDE.md.
- Run git diff --check.
- Run GitNexus detect-changes --scope all before any commit.
