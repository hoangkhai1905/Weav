# Task 4 Workspace Gateway Implementation Plan

## Scope

Implement only the nine public Workspace operations in the API Gateway. The
gateway will validate the public contract, require the existing access-token
guard, forward the original Bearer token and canonical request IDs, and proxy
the exact downstream `/workspaces...` paths. Internal Workspace authorization
routes, wildcard routes, client/database/business logic, and Task 5 remain out
of scope.

## Execution sequence

1. Add a failing Fastify E2E fixture covering all nine operations, exact
   upstream paths/query/body, status/body/204 preservation, header filtering,
   JWT rejection, invalid-input short-circuiting, route isolation, OCR route
   precedence, redirects, mutation non-retry, disconnect cancellation, and a
   response-body stall beyond the 10-second deadline.
2. Add `WorkspaceController` with explicit methods only. Validate UUIDs,
   contract query allow-lists/bounds, and strict JSON bodies before invoking
   the proxy.
3. Add `WorkspaceProxyService` and `WorkspaceModule`. Reuse the existing
   validated Workspace upstream configuration and request-context/abort/header
   helpers. Add a local response reader that observes the shared abort signal
   during and after body reads, so no successful response can be sent after a
   deadline or disconnect. Preserve downstream JSON/status/204 and reject
   redirects without retrying mutations.
4. Wire `WorkspaceModule` into `AppModule` after the pre-edit impact result.
5. Add a gateway-scoped OpenAPI document and README. Reference the existing
   Workspace schemas/parameters/responses externally; document only the nine
   gateway paths and the gateway-generated error envelope.
6. Run focused regression repeatedly, affected unit/E2E suites, typecheck,
   build, contract-operation/reference checks, formatting/diff checks, then
   update the Task 4 report and focused 2026-09-19 worklog with evidence,
   risks, blockers, and next steps.

## Acceptance evidence

- Exactly nine public method/path pairs are reachable through Fastify.
- Invalid UUID/query/body, missing/invalid JWT, internal/traversal paths, and
  unsupported methods do not reach the upstream fixture.
- The upstream sees only the original Bearer token, canonical IDs, valid
  traceparent, safe content headers, and allow-listed query values.
- Downstream business statuses and JSON, including 204, are preserved.
- Redirects are not followed; the 10-second deadline covers response-body
  reading; disconnect aborts the upstream; no retry occurs.
- Existing OCR/JWT behavior remains covered by the existing suites.

## Consolidation note — 2026-09-20

This historical Task 4 plan was compared with the source worktree copy and
preserved as a distinct main planning document. The implementation is
integrated in `api-gateway` at `a984069`; the source SDD report/ledger and the
original source copy remain recoverable in the external archive recorded by
the focused Task 6 worklog.
