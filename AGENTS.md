<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Weav** (2503 symbols, 3813 relationships, 62 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/Weav/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Weav/clusters` | All functional areas |
| `gitnexus://repo/Weav/processes` | All execution flows |
| `gitnexus://repo/Weav/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Weav Project Guidance

## Project mission and verified stack

Weav is a graduation-thesis project for automating and monitoring work processes, with a user experience comparable to Zapier or n8n. The primary users are working professionals. The product must support both web and mobile clients.

- `apps/web`: React + Vite.
- `apps/mobile`: React + Expo.
- Spring Boot services: Identity, Workflow, and Workspace.
- NestJS services: API Gateway, AI, Bot, and Notification.
- `services/ocr`: FastAPI.
- Database: PostgreSQL hosted on Neon.
- Development orchestration: Docker Compose and Docker Compose Watch (`develop.watch`) where configured.
- Package manager: pnpm; use the repository's declared package-manager version.

Verify the current repository configuration before relying on this summary. If the code and this file disagree, the code, package manifests, compose files, and current documentation are the source of truth.

## Repository boundaries

- Each service owns its domain model, persistence schema, migrations, and business rules.
- A service must not read or write another service's database tables directly.
- Cross-service communication goes through a documented API or message broker contract.
- Shared packages are for contracts, schemas, clients, and genuinely generic utilities. Do not move service-specific business logic into shared packages.
- Keep public API and database changes backward-compatible by default. Prefer additive migrations and additive fields/endpoints.
- Do not rename or drop persisted data, break an API contract, or remove compatibility behavior without a migration/rollback plan and explicit user confirmation.
## Required workflow

1. Read this file, relevant service/app documentation, the applicable work log, and `git status` before changing anything.
2. Diagnose the concrete error or requirement first. For non-trivial work, state scope, acceptance criteria, risks, and verification before editing.
3. Before editing an existing code symbol, run GitNexus upstream impact analysis. Use MCP `impact` when available; otherwise use the CLI in the GitNexus section above. Report callers, processes, and risk.
4. Treat `risk: UNKNOWN` as unresolved. Confirm it with targeted search and manual inspection; an empty caller set is not proof a symbol is unused. Warn the user before HIGH or CRITICAL risk changes.
5. For a feature, multi-step change, or design with meaningful alternatives, use brainstorming and writing-plans before implementation.
6. Implement the smallest safe change that meets the requirement. Preserve working behavior and avoid unrelated cleanup.
7. Run affected tests and builds. If an inter-service contract changes, add or update an integration test.
8. For user-facing web behavior, verify the real running application with Playwright. Use Playwright for Expo Web where applicable; native mobile uses unit/integration tests unless a native E2E harness is explicitly introduced.
9. Review the diff, run `git diff --check`, update `docs/work_logs/YYYY-MM-DD.md` (or a focused same-day file), and state any blocker.
10. Before committing, run GitNexus `detect_changes`. Commit only a complete, tested logical milestone.

## Refactoring policy

Refactoring is allowed when it materially improves architecture, maintainability, correctness, or performance, but it must remain bounded and behavior-preserving unless a behavior change is explicitly requested.

- Define the refactor boundary before editing.
- Do not combine broad cleanup with an unrelated feature or fix.
- Preserve API/data compatibility, validation, authorization, accessibility, error handling, and observability.
- Add or update tests for affected behavior.
- Prefer incremental changes that can be reviewed and reverted independently.

## Skill routing

Use only skills relevant to the current task. If a skill is unavailable or not callable, say so and use the closest documented fallback rather than pretending it ran.

- Apply Ponytail principles by default to coding tasks: YAGNI, reuse existing code, prefer standard-library/native solutions, keep diffs minimal, and leave a runnable check for non-trivial logic. Ponytail never authorizes removing validation, security, accessibility, logging, error handling, or tests for simplicity.
- Use brainstorming before meaningful implementation alternatives and writing-plans for multi-step work.
- Use GitNexus exploration, impact analysis, debugging, refactoring, and CLI guidance for architecture questions, symbol changes, bugs, refactors, and index operations.
- Use parallel-execution-optimizer and dispatching-parallel-agents whenever independent investigation, implementation, or verification lanes exist. Assign ownership before parallel writes; never let agents edit the same file concurrently. Use isolated branches/worktrees for large, multi-service, or multi-agent work and merge only after review and verification.
- For larger service work, use available subagent-driven-development or equivalent team orchestration with explicit merge gates.
- Route stack-specific work to applicable skills: `react-patterns`, `react-performance`, `react-testing` for web; `react-native-patterns` for Expo/mobile; `springboot-patterns` for Spring Boot; `nestjs-patterns` for NestJS; `fastapi-patterns` for OCR; `docker-patterns` for containers/Compose; and `postgres-patterns` plus `database-migrations` for PostgreSQL/schema work.
- For performance work, establish a baseline, measure the bottleneck, preserve correctness, and use a bounded optimization loop. Do not claim an optimization from intuition or a build-only result.
- For completion, use verification-before-completion and browser-QA guidance when available. A passing mock, static check, or build does not prove a real user flow works.
- Use context-budget/strategic-compact only when context pressure makes it useful.
## Testing and verification

- Discover the exact command from the affected package's `package.json`, Maven/Gradle wrapper, or Python configuration instead of guessing.
- Run focused tests first, then the relevant package build/typecheck/lint when practical.
- Test service boundaries with integration or contract tests when requests, events, schemas, authentication, or response shapes change.
- Test the real authenticated UI path for user-visible behavior. Capture the actual browser/runtime result and console/network failure when something still does not work.
- Do not use generated snapshots, mocked renderers, or build success as the only evidence for a runtime UI claim.

## Logging, secrets, and security

- Use the existing framework logger and include request/correlation context where supported.
- Never log or paste passwords, tokens, JWT secrets, API keys, cookies, raw connection strings, `.env` contents, or unnecessary personal data.
- Keep production `console.log` usage out of new code; use structured application logging.
- Validate input at service boundaries, preserve authorization checks, and apply rate/size limits to expensive work such as OCR or workflow execution.
- Never commit `.env` files, credentials, generated build output, temporary files, or user data.

## Work logs

After every meaningful task or before handoff, update the work log using `docs/work_logs/log_template.md`. Normally append to `docs/work_logs/YYYY-MM-DD.md`; use a focused same-day file when the main log is owned by another workstream.

Record decisions, changed files, commands and results, runtime/browser evidence, risks, blockers, and next steps. Keep raw output short and reproducible. Clearly distinguish complete/tested, in progress, and blocked work. Redact all secrets, tokens, connection strings, cookies, and sensitive personal data.

## Git and workspace policy

- Small tasks stay on the current branch.
- Large, multi-service, or multi-agent tasks use a separate branch/worktree with clear file ownership.
- Auto-commit is allowed only after a complete, tested logical milestone, with a clear message. Never include secrets, `.env`, build output, or unrelated user changes.
- If the managed runner reports `helper_unknown_error`, distinguish environment/setup failure from source failure. Verify the resolved workspace path and use a working junction/worktree only when it resolves to this repository; do not "fix" source code based only on runner setup errors.

## External agent CLI bridge

- For OpenCode or Antigravity calls from this repository, use `powershell.exe -NoProfile -File .\scripts\agent-cli.ps1` and use `T:\Weav` only. Do not use `T:\Weav_Alias` or `E:\WeavSub`.
- Run `-Action Check -Tool Auto` before a task. Use `-Action Run` with an explicit timeout; `-Tool Auto` selects only before the child starts and never duplicates a started request.
- Add `-AllowRepoContext` when the external CLI may inspect or modify this private repository. Keep `Plan` as the default; use `AcceptEdits` only when explicitly requested.
- Never add `--dangerously-skip-permissions` or OpenCode `--auto`. Treat provider/account/policy/concurrency failures and `helper_unknown_error` as infrastructure signals, not source evidence.

## Completion checklist

Before reporting completion:

- The requested behavior or documentation is present.
- Existing behavior and service boundaries are preserved.
- Relevant tests/builds and, for UI work, real Playwright/runtime verification are recorded.
- `git diff --check` is clean.
- Work log is updated without sensitive data.
- GitNexus change detection has been run before any commit.
- Remaining risks, skipped checks, and next steps are stated plainly.
