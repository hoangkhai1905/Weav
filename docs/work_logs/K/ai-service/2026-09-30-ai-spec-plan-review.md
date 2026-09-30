# AI Service V1: spec and plan review

Date: 2026-09-30 (Asia/Saigon). Branch: `feature/ai-service`. The change is documentation only; no product code, configuration, database, or secret changed.

## What changed

- `docs/superpowers/specs/2026-09-25-ai-service-v1-design.md`: revised. §10 lists the decisions.
- `docs/superpowers/plans/2026-09-25-ai-service-v1.md`: rewritten as a file-level, test-first plan in 11 tasks.

## Why (gaps found against the code)

- **No connection-metadata endpoint.** Generation assumed Workspace could list safe connection metadata. It can't: `WorkspaceClient` only has `getAccess`, `authorizeAttachment`, `resolve` (returns credentials), and `reportAuthenticationRejected`. Decision: the user picks connection IDs in the builder, Workflow checks each with `authorizeAttachment`, and AI never sees connections. No Workspace change is needed.
- **The web app had no real AI wiring.**
  - `apps/web/src/api/ai.api.ts` was an unused mock.
  - The builder wrote `schemaDescription`, which would have become non-executable.

  Decision: the web builder is in scope; mobile keeps its mocks.
- **The OCR client pattern already existed.** `OcrClient`, `WorkflowServiceJwtIssuer`, and `OcrNodeExecutor` are the template. Decision: extract a shared `ServiceJwtSigner` rather than write a second signer.
- **Status-based retries were unsafe.** `RetryPolicy` has no `HTTP_429`/`HTTP_503` codes, and executors set `retryable` directly. Decision: Workflow decides retries from the AI error code, never the HTTP status, so `AI_OUTPUT_INVALID` behind a 5xx is not retried.
- **Schema keywords could carry secrets.** The credential scanner rejects any key containing `token`, `secret`, and similar. Decision: `outputSchema` is a static field, exempt from key scanning and mapping resolution, and limited to a keyword profile without `default`, `const`, `examples`, or `$ref`.
- **The schema depth limit was too high.** `WorkflowDefinition.MAX_JSON_DEPTH = 32` and each schema level costs two JSON levels, so the schema depth drops from 16 to 8.
- **The lease heartbeat is independent.** `ExecutionRunner` renews the 60 s lease on a scheduled 15 s heartbeat, so a 65 s AI call is safe.
- **Deferred:** CI (the repo has none), duplicate-key detection on the AI ingress, and `$ref` in schemas.
- **Undefined contracts are now specified:** `WorkflowIntent` (1:1 with `WorkflowDefinition`, compiled through the existing `validatePublish`), the `/generate` response, Service JWT claims, and request binding.

## Handoff

- Implementation starts from a new branch `feature/ai-service-impl`, cut from `fix/workspace-connection` with this branch merged in.
- Gateway partner: one route, `POST /api/v1/workspaces/:id/workflows/generate`, with an upstream timeout of at least 80 s (spec §9).
- No tests were run because only documentation changed. `git diff --check` is clean.
