# Agent worker bridge hardening

The user approved bridge fixes and file-writing probes restricted to a dedicated synthetic test folder. Preserve canonical T:\Weav, existing CLI selection, explicit AcceptEdits, no permission-bypass CLI flags, and no automatic retry after a request starts.

The bridge must reject empty output even on child exit 0, surface bounded redacted stderr on success and failure, and pass an explicitly selected model to Antigravity. OpenCode Plan must map to its supported read-only agent/permissions rather than merely a launcher parameter. Do not alter global credentials or permissions.

Keep the existing launcher rather than introduce a second orchestration layer. Do not disable sandboxing to make probes succeed. Validate flags against installed CLI help, regression-test argument/result handling, then perform live Plan and AcceptEdits probes with external workers owning separate synthetic files. Independent Node acceptance tests, file diff review, and runtime results determine success; a CLI exit code alone does not.

Only scripts/agent-cli.ps1, a focused regression test, operations documentation, this spec/plan, and work logs are durable changes. Synthetic worker files remain outside production code and are removed only if created by this task and confirmed disposable. Repo-read permission for root package.json was explicitly granted in the preceding turn. No commit requested.
