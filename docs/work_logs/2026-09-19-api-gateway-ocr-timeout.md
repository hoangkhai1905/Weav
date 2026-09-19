# Work log 2026-09-19 — API Gateway OCR timeout follow-up

## Metadata

- Time zone: Asia/Saigon.
- Branch: `codex/api-gateway-v1`; worktree: `D:/End/Weav-worktrees/api-gateway-v1`.
- Baseline: `00cc5f8`; existing Task 0–3 changes were preserved and remain uncommitted.
- Operator: Luna max implementation/test worker.
- Scope: bounded diagnosis and fix for the Task 3 OCR JSON response-body stall.

## Result

- Resolved the intermittent `200` response after the 10-second OCR deadline.
- The gateway now owns and cancels the upstream response reader when the shared
  abort signal fires, returns sanitized `503 OCR_BUSY`, and satisfies the
  existing upstream-abort assertion.
- No timeout was increased, no assertion was weakened, and no shared abort
  helper was changed.

## Diagnosis and impact

The requested isolated command initially failed with expected 503/received 200.
Runtime diagnostics showed headers at roughly 74 ms, the shared abort at roughly
10,004 ms, and JSON completion at roughly 11,082 ms while `signal.aborted` was
already true. A standalone Node reproduction matched the behavior when the
upstream finished reading the request before starting a partial response:
`response.json()` could resolve after the abort instead of rejecting.

The first post-read signal check prevented the stale 200 but left the upstream
socket open; the existing fixture-abort assertion then timed out. A manual
`ReadableStream` reader reproduction showed that canceling the reader on abort
causes the body read to reject and the upstream response to close.

Mandated direct GitNexus impact was run before the edit with the fixed 1.6.12
CLI. `OcrService` and its file resolved LOW risk with four upstream impacted
nodes through controller/module/bootstrap callers and no indexed processes or
modules. The ambiguous method query included a LOW service candidate and an
UNKNOWN controller candidate; targeted search corroborated the controller and
module wiring. No HIGH/CRITICAL risk was reported.

## Change

- `services/api-gateway/src/ocr/ocr.service.ts`: added a local
  `readUpstreamResponseBody` helper that reads response chunks, cancels the
  reader on abort, rejects after an aborted read, and releases the reader. JSON
  and text response parsing now use this helper; the final signal check remains
  before returning an upstream result.
- No test file changed: the existing `transport.e2e-spec.ts` regression already
  failed before the fix and proves both the 503 envelope and upstream abort.
- Updated `.superpowers/sdd/2026-09-16-api-gateway-service/task-3-report.md`
  with the root cause, impact, verification, and handoff state.

## Verification

All commands ran from the specified worktree with Node v24.13.0 and pnpm 11.22.0.

| Command                                                                                                                   | Result                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent transport.e2e-spec.ts -t 'JSON body stalls'` before fix | RED: expected 503, received 200; diagnostics confirmed abort fired but JSON reader completed later |
| Same focused command after fix, three runs                                                                                | PASS each run; 1 test passed, upstream-abort assertion passed near the 10-second deadline          |
| `pnpm --dir services/api-gateway test -- --runInBand`                                                                     | PASS: 7 suites, 81 tests                                                                           |
| `pnpm --dir services/api-gateway test:e2e -- --runInBand`                                                                 | PASS: 3 suites, 48 tests                                                                           |
| `pnpm --dir services/api-gateway exec tsc --noEmit`                                                                       | PASS, exit 0                                                                                       |
| `pnpm --dir services/api-gateway build`                                                                                   | PASS, exit 0                                                                                       |
| `pnpm --dir services/api-gateway exec prettier --check src/ocr/ocr.service.ts`                                            | PASS                                                                                               |
| `git diff --check`                                                                                                        | PASS; existing `.env.example` line-ending warning only                                             |

## Risks, blockers, and handoff

- No `helper_unknown_error: setup refresh had errors`; no commits, merges,
  pushes, dependency installation, or subagents.
- No real upstream deployment or authenticated browser/UI verification was run.
- The pre-existing raw multipart upload-cap risk is unchanged.
- Task 4 Workspace was not started. Stop here until the user says `work done`
  and the parent dispatches the next task.

## Closing state

- Status: complete/tested for the assigned OCR timeout regression.
- Worktree: prior Task 1–3 changes plus this OCR edit and documentation remain
  uncommitted; no unrelated files were reverted.

## 2026-09-19 Workspace Task 4

### Status

Complete/tested for the dispatched Workspace gateway task. Implemented only in
`D:/End/Weav-worktrees/api-gateway-v1` on `codex/api-gateway-v1`; no commit,
merge, push, secret read, dependency installation, or subagent was used. Task 5
was not started.

### Graph impact before existing edit

Ran the mandated direct GitNexus CLI against `AppModule` and the exact
`services/api-gateway/src/app.module.ts` file. The name-only query was ambiguous
across four services and returned aggregate `UNKNOWN`; targeted import and
bootstrap inspection corroborated the API-gateway candidate. The file-specific
result was exact LOW risk with one direct caller (`main.ts`), zero indexed
processes/modules, and no HIGH/CRITICAL warning. This result was recorded in
`.superpowers/sdd/2026-09-16-api-gateway-service/task-4-report.md`.

### Changes

- Added `services/api-gateway/src/workspace/workspace.controller.ts` with the
  nine explicit protected `/api/v1/workspaces...` operations and strict
  UUID/query/body validation.
- Added `services/api-gateway/src/workspace/workspace-proxy.service.ts` and
  `workspace.module.ts`. The proxy maps only the public suffixes to the
  configured Workspace upstream, forwards the original Bearer and canonical
  IDs, filters unsafe headers, preserves downstream JSON/status/204, rejects
  redirects, sends mutations once, and aborts on deadline/disconnect.
- Added an abort-aware Workspace-local response reader. It cancels on abort and
  checks during/after body reading, so a delayed body cannot produce a late 200.
  OCR source and accepted OCR behavior were not modified.
- Wired `WorkspaceModule` into `src/app.module.ts` without changing the prior
  JWT/OCR behavior.
- Added `test/workspace.e2e-spec.ts`, a gateway-scoped
  `packages/contracts/http/gateway/openapi.yaml`, its README, and the Task 4
  implementation plan/report.

### Boundary evidence

The focused E2E fixture covers all nine method/path pairs; original Bearer and
canonical request/correlation IDs; safe/forbidden headers; UUID/query/body
validation with zero upstream calls; missing/invalid JWT; internal, traversal,
encoded-separator, and unsupported-method rejection; literal `members/me`
precedence; OCR precedence; redirect rejection; downstream response/status and
204 and 401/403/404/409 status/body preservation; no mutation retry; client
disconnect; and a response body stall beyond 10 seconds returning 503. The
contract test checks exactly nine gateway operations and each local/external
reference fragment.

### Commands and results

| Command                                                                                  | Result                             |
| ---------------------------------------------------------------------------------------- | ---------------------------------- |
| `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent workspace.e2e-spec.ts` | PASS, 10 tests; 3 consecutive runs |
| `pnpm --dir services/api-gateway test -- --runInBand --silent`                           | PASS, 7 suites / 81 tests          |
| `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent`                       | PASS, 4 suites / 58 tests          |
| `pnpm --dir services/api-gateway exec tsc --noEmit`                                      | PASS, exit 0                       |
| `pnpm --dir services/api-gateway build`                                                  | PASS, exit 0                       |
| Prettier on owned TypeScript/YAML/Markdown                                               | PASS                               |

### Risks and handoff

- No real Workspace deployment or authenticated browser flow was run; the
  evidence is a local HTTP-fixture gateway test.
- All Task 1–3 changes, including the OCR late-body fix, remain uncommitted and
  were preserved. No helper setup-refresh error occurred.
- Final `git diff --check` passed (with only the pre-existing `.env.example`
  LF/CRLF warning), and worktree status was recorded after the report/log
  edits. User must review and say `work done` before any new task; this worker
  must not start Task 5 or perform parent polling/review.
