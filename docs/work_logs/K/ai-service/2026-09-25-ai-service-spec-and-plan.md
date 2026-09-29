# AI Service V1 specification and plan handoff

Date: 2026-09-25. Repository: `T:\Weav`. This handoff contains documentation only; no product code, configuration, database, secret, or runtime flag was changed.

The approved V1 direction is a stateless NestJS AI Service using a replaceable DeepSeek provider adapter, Service JWT authentication, strict bounded JSON, and four operations: workflow generation, `ai.extract`, `ai.classify`, and `ai.summarize`. Workflow owns authorization, deterministic `WorkflowIntent` compilation, canonical definitions, persistence, execution, and retry policy.

The plan preserves old extraction definitions for reading/editing/publishing while requiring `outputSchema` for execution. Missing generation facts must produce clarification questions; incomplete or guessed workflows are never returned. AI has a configurable 60-second deadline, with 65 seconds for a Workflow AI call and 75 seconds for Workflow generation.

The user's latest ownership decision is recorded explicitly: Gateway implementation, contracts, configuration, documentation, CI, tests, and public-edge acceptance belong to their partner. The implementation plan therefore contains 11 tasks for AI Service and Workflow only, and the local acceptance path starts at authenticated Workflow ingress.

No runtime tests were run because this deliverable is documentation-only. Before implementation, recheck repository status and current contracts, run GitNexus impact for changed symbols, review the existing Identity/Workspace/Workflow Clean Architecture conventions, then execute the plan task by task.
