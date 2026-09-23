# Workflow Service V1 release review — 2026-09-24

## 1. Metadata and scope

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-24 / Asia/Saigon |
| Repository / branch / base commit | Weav / `feature/workflow-service` / `c836de2` |
| Owner | Codex coordinator |
| Status | Workflow-only release review completed; pre-commit gate checked |
| Reviewed scope | Workflow authoring, publication, execution, persistence, security, Workspace connection contract, and V1 web catalog/builder |
| Excluded by user | API Gateway and Notification source/release gates; OCR production activation review |

## 2. Outcome and decisions

- No concrete Workflow-core defect was found in the reviewed publication, admission, execution, security, connection-usage, and migration paths. This is a review result, not proof that every possible provider or production path works.
- The direct Workflow live smoke from `2026-09-23-workflow-service-direct-smoke.md` passed against isolated schemas on the shared project database. It covered create, save, list/get, publish, manual admission, persisted execution success, and expected branch skips with zero outbound HTTP calls. Those test schemas remain for explicit cleanup; this review did not modify them.
- The V1 builder work is catalog/configuration alignment. The existing local-storage builder is not connected to the Workflow backend in Task 20; do not claim browser authoring-to-server publication is delivered.
- No code or migration was changed during the review. The two new-document whitespace findings were corrected before staging. No PR was created.

## 3. Verification

| Check | Result | Limit |
| --- | --- | --- |
| Workflow Surefire reports from fresh test run | 354 tests, 0 failures/errors/skips across 56 suites | Full Maven `verify` process output was not retained; a separate `mvn -DskipTests package` completed successfully and produced the executable JAR. |
| Workspace focused inter-service/security suite | 63 tests, 0 failures/errors/skips, Maven BUILD SUCCESS | First attempt failed because Docker Desktop was stopped; rerun after Docker started passed. |
| Web TypeScript and Vite build | `tsc -b` PASS; `vite build` PASS | Direct installed binaries were used because pnpm attempted a noninteractive dependency purge. |
| Web focused lint | ESLint PASS on changed non-OCR builder/catalog/types and Workflow E2E files | Repository-wide lint was not rerun. |
| Browser | Playwright Chromium 30 passed for Workflow catalog/UI with OCR cases excluded | Real browser in mock API mode; not backend-connected authoring. |
| Direct service live smoke | PASS (prior 2026-09-23 session, cited above) | Controlled fixture did not call real providers. |
| Staged diff whitespace | `git diff --cached --check` PASS | All 241 intended files staged; the Gateway handoff log remains untracked. |
| GitNexus `detect_changes(scope=all)` and CLI rerun | 3,216 changed symbols, 157 affected processes, 241 files, `critical` | Symbol listing was capped at 1,000, but summary counts covered the full staged set. Publication, admission, mapping, execution, and security paths were manually inspected and tested. |
| Staged file/secret scan | No Gateway/Notification paths, `.env`, build output, or known credential shapes staged | PEM markers found only in parser code and tests generating temporary keys. OCR client remains disabled by default. |

## 4. Review evidence and risks

- Publication validates and authorizes the draft, locks the workflow, snapshots an immutable version, updates the current pointer and trigger registrations in one transaction; concurrent publication/version pinning has a dedicated integration test.
- Manual/automatic admission locks the owning workflow, checks published/active registration and current version, and writes execution, node rows, and outbox intent atomically. Runner writes use a fenced lease and persisted node/attempt transitions. The direct smoke and Testcontainers suite exercise this path.
- JWT and internal-key boundaries, bounded Workspace responses, fail-closed connection authorization/resolution, and connection-usage semantics were inspected. V2–V4 migrations are additive; V4 explicitly fails on pre-existing duplicate webhook keys instead of silently changing them.
- Stored immutable versions count as connection usage even after workflow soft deletion, matching the user's decision. An unknown connection with no references returns `200 {"inUse":false}` under the clarified contract.
- Real Google Sheets provider acceptance, production observability counters/dashboards, and backend-connected browser authoring remain unverified or outside the V1 builder slice. Gateway and Notification were excluded. The staged Workflow OCR adapter is disabled by default; OCR production activation was not reviewed at the user's request.
- GitNexus reports `critical` blast radius because this milestone adds major execution paths; this is not evidence of a failing test or concrete defect. The listing cap prevents claiming every changed symbol was individually inspected. Preserve the excluded Gateway handoff file and any user-owned files.

## 5. Handoff

1. Commit the staged Workflow milestone after confirming the final staged log update; do not push automatically.
2. If production activation is desired, separately verify real provider credentials and monitoring; the current evidence covers the controlled runtime and closed dependency gates.
3. Preserve the retained shared-database test schemas until their exact ownership and cleanup are approved.

No secrets, token values, raw connection strings, or personal data were recorded.
