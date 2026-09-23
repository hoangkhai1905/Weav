# Workflow Service M1 review log — 2026-09-21

## 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-21 (follow-up 2026-09-22) / Asia/Saigon |
| Repository / branch | `T:\Weav` / `feature/workflow-service` |
| Baseline | `c836de2` per coordinator plan |
| Owner / recipient | Fresh M1 review worker / root coordinator |
| Status | Scoped fixes verified; current dispositions await root triage |
| Scope | Initial read-only review of Workflow Tasks 1–7 and Task 9; bounded follow-up fixes in Section 7 |

## 2. Result

The initial 2026-09-21 review recorded three findings: the HEAD key-gate gap, the matrix-parameter body-limit claim, and provider-secret-shaped values accepted in editor state. Section 7 records the two scoped fixes and the matrix claim's later withdrawal after full-chain reproduction. Current dispositions are in `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/REPORT.md`. The cross-service attach/delete race remains an unverified integration concern because Workspace documents the check/commit window as advisory.

## 3. Review scope and decisions

- Used the Workflow V1 specification, implementation plan, progress record, Tasks 6–7 reports, and current service contracts.
- Applied the user decisions: all stored immutable versions count even for soft-deleted workflows; only deleted drafts are excluded; unknown scoped usage pairs return `200 false` without a Workspace lookup.
- Did not flag behavior explicitly deferred to Tasks 8–21. Did not touch `docs/work_logs/T` or any Task 8-owned source files.
- GitNexus `Weav` index was three commits behind and produced stale/unrelated results for the requested flows; source inspection corroborated the review. Index was not refreshed.

## 4. Initial evidence and verification (2026-09-21)

| Check | Result | Limit |
| --- | --- | --- |
| GitNexus query/context | Stale/unrelated; source corroboration used | Index remains behind HEAD |
| Spring HEAD/path probes | Confirmed GET matcher rejects HEAD while MVC `@GetMapping` accepts it; matrix paths match route patterns | Framework-path probe, no live service |
| Embedded Tomcat URI/path probe | `requestURI` retains matrix suffix; `servletPath` strips it | Isolated container probe |
| Workflow test suite | Coordinator reported 184/184 pass | Not run by this reviewer; Task 8 owned Maven slot |
| Workspace contract fixtures | Coordinator reported 20/20 pass | No live Compose/API run |
| DB/migration/runtime | Not run | Review-only assignment |

## 5. Initial findings and handoff (historical; see Section 7 for current disposition)

The initial review's exact paths/lines, triggers, impact, evidence, and recommendations are in the report. Its current dispositions are recorded in Section 7: two findings are fixed in the working tree and the matrix-path claim is withdrawn as confirmed. Root owns final severity triage and acceptance. Do not treat this report as M1 acceptance; the attach/delete race needs a product-level concurrency decision only if strict serialization is required.

## 6. Files and repository state

| Path | Change |
| --- | --- |
| `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/` | Added review report and isolated probe source/output artifacts |
| `docs/work_logs/K/2026-09-21-workflow-service-m1-review.md` | Added this review handoff log |

At the initial review, no product source, migration, configuration, or repository tests were edited. Only isolated probe sources/classes, the report, and this handoff log were added. No commits or staged changes were created.

## 7. Follow-up — 2026-09-22

### Result and disposition

Root accepted two findings for a bounded regression/fix round. The internal usage route now explicitly denies HEAD before permitting its GET contract. Draft save now applies the existing recursive, normalized credential-key scanner to frozen `editorState` before repository lookup or persistence. Secret values remain absent from validation issues and HTTP responses.

The matrix-parameter body-limit claim is withdrawn as a confirmed finding. The production embedded HTTP test, using a valid bearer on the canonical route first, observed the semicolon-suffixed oversized draft request rejected with 401 at `/error`, and the persisted draft remained unchanged. This proves current-chain rejection for the tested request, without identifying which upstream component rejected it. No firewall/body-limit configuration was changed.

### Changed files owned by this follow-up

| Path | Change |
| --- | --- |
| `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java` | Deny HEAD on the internal usage route before the GET permit matcher. |
| `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowDraftService.java` | Reject credential-shaped editor-state keys before persistence. |
| `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Reuse the recursive normalized credential scanner for editor state. |
| `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowDraftHttpTest.java` | Add nested mixed-case editor-state secret regression; retain valid UI-state round-trip coverage. |
| `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowInternalUsageEmbeddedHttpTest.java` | Add full-chain HEAD/key/quota test and matrix-path non-mutation test. |
| `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/REPORT.md` | Record confirmed fixes and corrected matrix-path disposition. |
| `docs/work_logs/K/2026-09-21-workflow-service-m1-review.md` | Record this follow-up. |

### Verification and limits

The pre-fix regressions reproduced HEAD returning 200 and editor state accepting the secret marker. Post-fix, the focused test invocation passed **4/4** with zero failures/errors/skips; main and test compilation covered 119 and 39 source files. Testcontainers started PostgreSQL and RabbitMQ and the HTTP test used the production Spring Security chain with embedded Tomcat. The exact command is recorded in the review report. The run required elevated execution because direct access to the local Maven cache had previously failed with `AccessDeniedException`.

`git diff --check` passed after the code and documentation edits; Git emitted only pre-existing line-ending warnings for the two `application.properties` files. Root reported the earlier full Workflow suite at 184/184 and Workspace contract fixtures at 20/20, but those full suites were not rerun after the scoped fixes. No live Compose/API run was performed. GitNexus remained three commits behind HEAD with stale or `UNKNOWN` path results; manual source inspection corroborated the changes. Execution/outbox/Task10 source and tests, migrations, `application.properties`, the root plan/ledger, and `docs/work_logs/T` were not edited by this follow-up.

Root retains final severity triage and M1 acceptance. No commit or staging was performed.
