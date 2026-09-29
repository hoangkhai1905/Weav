# AI Service V1 Implementation Plan

This plan implements AI Service and Workflow integration only. Gateway code, configuration, contracts, documentation, CI, and tests are owned by the user's partner and must not be changed here.

## Task 1 — Freeze contracts and fixtures

Create language-neutral OpenAPI/JSON Schema files and fixtures under `packages/contracts/http/ai/`. Define processing envelopes, `WorkflowIntent`, generation result unions, error codes, limits, Service JWT claims, and TypeScript/Java parity fixtures. Keep intent separate from canonical `WorkflowDefinition`.

Verify duplicate-key, unknown-field, invalid-number, Unicode, nested-schema, classification, summary, clarification, and error fixtures before implementation.

## Task 2 — Implement bounded JSON and schema validation

In `services/ai-service/src/domain` and `src/infrastructure`, implement strict JSON parsing, safe numeric handling, bounded JSON Schema validation, local-reference limits, prototype-key rejection, UTF-8/code-point limits, and output validation. Use Ajv 2020-12 with a deliberately bounded supported profile; do not allow remote or recursive references.

Add tests for nested objects, arrays, optional fields, enums, nullability, deep/ref-heavy schemas, literal `{{...}}`, fields named `token`, duplicate keys, and oversized input/output.

## Task 3 — Add the DeepSeek adapter

Create the `LlmProvider` port and native `fetch` DeepSeek adapter. Read API key, model, base URL, timeout, and token limits from validated configuration. Stream-read and cap the provider response, abort on deadline/disconnect, accept exactly one JSON completion, reject refusals/truncation/code fences/malformed JSON, and map failures to closed safe AI errors.

Test timeout, disconnect, body overflow, provider auth, 429/5xx, malformed JSON, empty content, truncated output, and no-retry behavior with a local HTTP fixture. Never call DeepSeek in ordinary tests.

## Task 4 — Implement four application use cases

Implement plain application services for generation interpretation, extraction, classification, and summarization. Use only domain types and outbound ports. Enforce output schemas, category membership, confidence bounds, Unicode summary length, prompt limits, and one provider call per request. Keep model-generated diagnostics out of public errors.

Add unit tests for success, invalid output, missing facts, unsupported capability, prompt injection text, multilingual content, and provider errors.

## Task 5 — Wire AI HTTP, Service JWT, admission, and health

Implement the Nest/Fastify presentation layer, early deadline hook, strict parsers, Service JWT verification, operation authorization, bounded local admission, safe error envelopes, readiness, liveness, and graceful shutdown. Keep the four-layer dependency direction and avoid business persistence, RabbitMQ, Redis, or conversation storage.

Test wrong tenant/scope/issuer/audience/expiry, request binding, malformed headers, body limits, cancellation, timeout, admission overflow, readiness without model/key, and safe logs. Run AI unit/E2E/typecheck/build checks.

## Task 6 — Preserve Workflow schema compatibility

In Workflow, make `ai.extract.outputSchema` static metadata for validation, mapping, and credential scanning. Preserve old `schemaDescription` definitions for reading/editing/publishing. Require `outputSchema` at execution time and return an actionable structured failure when it is absent. Do not migrate stored definitions or alter ordinary mappings.

Add regressions for legacy publish/read/edit, missing runtime schema, nested schema values, credential-like field names inside schemas, and ordinary credential rejection.

## Task 7 — Add Workflow AI client and executors

Create Workflow AI ports, Service JWT signing, HTTP client, response validators, deadline propagation, and executors for extract/classify/summarize. Map only recognized transient errors into the existing retry vocabulary. Carry workspace, actor, execution, node, attempt, request, trace, and deadline context without storing secrets.

Test three-attempt retry behavior, permanent failure single-attempt behavior, cancellation, heartbeat continuity, wrong tenant, invalid output, and disabled integration fail-closed behavior.

## Task 8 — Implement deterministic intent compilation

Add a pure `IntentCompiler`, typed intermediate values, capability catalog, and compilation result under Workflow's generation domain. Validate node types, ports, cycles, references, connections, schedules, URLs, required fields, and current `WorkflowDefinition` limits. Compile identical intents identically and return no partial definition on any failure.

Test valid graphs, cycles, bad ports, unsafe references, unknown capabilities, guessed connections, missing timezone, and deterministic serialization.

## Task 9 — Add authorized Workflow generation

Implement `POST /workspaces/{workspaceId}/workflows/generate` in Workflow. Require a verified user token and `WORKFLOW_CREATE`, validate workspace and selected aliases, fetch safe connection metadata through Workspace, call AI once, compile and validate ready intents, and return `ready`, `needs_input`, or `unsupported` without saving/publishing/running.

Use a 32 KiB body bound, 75-second generation budget, 5/minute local admission per authenticated user/workspace, safe correlation headers, and distinct public/private error envelopes. Test unauthorized access, foreign IDs, missing metadata, clarification, unsupported capability, invalid compiler output, timeout, malformed body, duplicate keys, and unchanged repository/outbox counts.

## Task 10 — Wire AI/Workflow configuration and CI

Update only AI and Workflow environment examples, Compose blocks, README files, OpenAPI documentation, and the old Workflow AI-output prose. Add placeholder-only keys, disabled caller flags, key-file mounts, timeout-order validation, health/readiness documentation, and an opt-in synthetic smoke overlay. Keep RabbitMQ/PostgreSQL for Workflow and absent from AI.

Add deterministic CI for AI tests/build/typecheck/lint, Workflow Maven verification, shared fixtures, and Compose validation. Do not add Gateway commands or files. Do not use live provider credentials in CI.

## Task 11 — Prove the direct Workflow → AI integration

Create a local DeepSeek-compatible provider fixture and an owned-process runner. Start the fixture, AI, and Workflow only; authenticate through the real Workflow endpoint; clean up only processes created by the runner. Exercise generation success, clarification, unsupported capability, wrong tenant, body overflow, timeout, invalid output, cancellation, two-tenant admission isolation, legacy extraction failure, schema metadata, node output mapping, and retry/lease recovery.

Run AI checks and Workflow Maven verification with UTC timezone configuration where needed. Record actual results in a work log. Live DeepSeek smoke is opt-in, synthetic-only, and skipped when credentials/model configuration are unavailable. Gateway integration is not part of this acceptance run.

## Delivery gates

- Before editing existing code, run GitNexus upstream impact and inspect `UNKNOWN` results manually.
- After each task, run focused tests, `git diff --check`, and update the work log.
- Before any commit, run complete GitNexus change detection and review the full diff.
- Keep real keys, JWTs, documents, provider bodies, and `.env` files out of the repository.
- Implementation starts only after contract review; all checkboxes above are future work.
