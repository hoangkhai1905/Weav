# Workflows list request fan-out (N+1)

| Field | Value |
| --- | --- |
| Date | 2026-10-19 (Asia/Saigon) |
| Branch | `fix/workflows-list-fanout` from `dev` (`52192dda`) |
| Status | Done, not merged or pushed |
| Scope | Make `apps/web/e2e/request-budget.spec.ts` pass again without raising its budget (`< 25`) |

## Baseline (measured with the spec's own counter)

45 API requests for Dashboard -> Workflows -> run history -> Dashboard with 30 stubbed workflows:

| Request | Count | Cause |
| --- | --- | --- |
| `GET /workflows/:id` | 20 | `WorkflowsPage` loaded each of the first 20 rows' detail only to build the "what it does" sentence (step types) |
| `GET /workflows/:id/executions` | 12 | 10 from run stats (`fetchRecentExecutions`: one call per non-draft workflow, 3 at a time) + 2 on the run-history page |
| everything else | 13 | auth, workspaces, invitations, list, monitoring summary, workspace runs, run detail |

The spec also timed out at the row-menu click on this machine: the 20 detail answers and the stats re-rendered and re-sorted the rows while the menu was open (the menu closes on scroll).

## Fix

| Change | Why |
| --- | --- |
| workflow-service list (`GET /workspaces/{id}/workflows`) returns an additive `stepTypes` per summary: non-trigger node types in run order (BFS from the triggers along the edges, then unreached nodes in definition order, same as web `orderedStepTypes`) | The list response had no steps; per-row detail calls were the N+1. The SQL projects only node `{id,type}` and edge `{source,target}` pairs, never node configs. |
| Web list reads `stepTypes` from the summary; the `useQueries` per-row detail block is gone. Mock mode derives steps from its local graph. An older API without the field shows the trigger line alone (same as rows past 20 before). | Zero detail calls on the list. |
| Run stats use one `GET /workspaces/{id}/executions?size=100` (workspace run history, newest first) instead of one execution list per workflow; dead `executionApi.getRecentExecutions` removed | Same `WORKFLOW_MONITOR` authorization as the per-workflow list. Covers every workflow with a recent run (before: only the first 10). Ceiling (marked `ponytail:`): only the newest 100 runs count. |

Result: 16-17 requests (3/3 runs), `request-budget` passes with the budget unchanged.

## Files

- `services/workflow-service/.../aggregate/workflow/WorkflowSummary.java`: `stepTypes` component + `stepTypes(nodes, links)` ordering.
- `services/workflow-service/.../repository/WorkflowRepositoryAdapter.java`: list SQL projects node and edge pairs.
- `services/workflow-service/.../response/WorkflowResponse.java`: `Summary.stepTypes` (additive JSON field).
- Tests: `WorkflowResponseTest` (ordering: cycle, dangling edge, unreached, id-less, untyped), `WorkflowDraftPersistenceTest` (Postgres projection incl. malformed draft), `WorkflowDraftHttpTest` (list contract: `stepTypes`, no `definition`).
- `apps/web/src/api/workflow-v1.api.ts`, `src/types/workflow.types.ts`: optional `stepTypes`.
- `apps/web/src/lib/queries/workflows.ts`, `src/api/execution.api.ts`, `src/pages/WorkflowsPage.tsx`: one run-history call, no per-row queries.
- `apps/web/e2e/workflow-ui.spec.ts`: list stub returns `triggerTypes`/`stepTypes` like the service; asserts the sentence and that no per-workflow request is made.

## Verification

| Check | Result |
| --- | --- |
| `VITE_API_MODE=http playwright test e2e/request-budget.spec.ts --repeat-each=3` | 3 passed (16, 16, 17 requests) |
| `playwright test e2e/workflow-ui.spec.ts e2e/request-budget.spec.ts` | 29 passed |
| Full web suite (chromium) | Run 2: 418 passed, 1 failed (`notification-task10-live`, needs a live stack), 2 skipped. Run 1 also failed `workspace-connections` "schedule picker" once (builder test, untouched by this change); it passed 3/3 alone and in run 2: load flake |
| `pnpm --dir apps/web exec tsc --noEmit` / `build` | PASS / PASS |
| `eslint` on changed web files | 1 error, pre-existing on `dev` (`react-hooks/set-state-in-effect` at the untouched `useEffect(loadWorkflows)`) |
| workflow-service `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | 1168 tests, 0 failures, 3 errors = the known environment-only ones (`HttpTransportIntegrationTest` x2 TLS cert, `WorkflowNotificationLifecyclePersistenceIntegrationTest` needs notification-service `dist`) |
| `git diff --check`; GitNexus `detect_changes --scope all` | clean; 9 changed symbols, not partial/truncated. Rated critical (948 affected) because `WorkflowDefinition` (optional field added) and `executionApi` (unused method removed) are hub symbols; `tsc` and both suites cover them |

Not checked: the list against a live stack (needs the rebuilt workflow-service image); covered by the HTTP/persistence tests and the stubbed Playwright run.

## Risks / next

- A web build deployed before the new workflow-service shows trigger-only sentences until the service is updated (no errors).
- Run stats now depend on the workspace run-history endpoint (`/executions`); its 90-day default window and 100-row page are the limits.
- Pre-existing lint error above is a separate cleanup.
