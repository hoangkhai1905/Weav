# Node config JSON Schema (Week 1, Lane 1)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon) |
| Repository / branch | Weav / `feat/node-config-schema` (worktree `T:\Weav-wt\schema`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented and verified locally; not committed |
| Scope | One JSON Schema file per node type in `packages/workflow-schema/nodes`, loaded by workflow-service to drive catalog and config validation |

## 2. Summary

- 13 node files (`nodes/<type>.json`, JSON Schema 2020-12 subset plus `x-weav-*` extensions) are the single source of truth for supported types, config fields, static fields, publish-required fields, field shapes and non-blank rules.
- `NodeCatalog` public static API is unchanged; `DefinitionValidator` private tables `hasValidFieldShape`, `isBlankRequiredString`, `requiredFields` were replaced by schema checks. Issue codes, paths and messages are unchanged.
- `packages/workflow-schema/README.md` is the contract note for the FE partner.

## 3. Decisions

| Decision | Reason | Alternatives |
| --- | --- | --- |
| Domain holds a pure model (`NodeConfigSchema`, `NodeConfigSchemas`, `NodeSchemaSource`); the Jackson/Spring loader `ClasspathNodeSchemaSource` lives in infrastructure and is found by `ServiceLoader` (`META-INF/services`) | `WorkflowCleanArchitectureTest` forbids domain depending on Jackson/Spring, and that test must stay unmodified | Loader in domain (breaks arch test); static install hook (breaks plain `new DefinitionValidator()` tests) |
| Registry initializes statically and `NodeSchemaStartupCheck` touches it at startup | A broken schema set stops the service at boot instead of failing the first request | Lazy load only |
| Enums are not part of the shape check; `validateCatalogEnum` keeps its own codes (`INVALID_SHEETS_OPERATION`, `INVALID_CONDITION_OPERATOR`) but reads the allowed values from the schema | Preserves today's issue codes | Shape check on enum would report `INVALID_FIELD_TYPE` instead |
| `minLength: 1` means non-blank and is applied only to fields in `required` at publish | Matches the old `isBlankRequiredString` (called only in the required loop); `ocr.extract` blank sources are still reported as `OCR_SOURCE_REQUIRED` | Apply to every present field (new issues, parity break) |
| Added keywords beyond the brief: `minItems` (email `to` empty list), `additionalProperties` as a schema (http headers are string maps), `x-weav-mutually-exclusive` (informational, OCR rule stays in Java) | Needed for exact parity | Keep these rules in Java |
| `definition.schema.json` is untouched; a test checks it agrees with the node files | Public contract, additive changes only | Generate it from node files (later) |

## 4. Changed files

| Type | Path | Note |
| --- | --- | --- |
| Add | `packages/workflow-schema/nodes/*.json` (13), `README.md` | `nodes/.gitkeep` removed |
| Add | `domain/definition/NodeConfigSchema.java`, `NodeConfigSchemas.java`, `NodeSchemaSource.java` | Pure model, registry, port |
| Add | `infrastructure/definition/ClasspathNodeSchemaSource.java`, `NodeSchemaStartupCheck.java`, `META-INF/services/...NodeSchemaSource` | Loader (rejects unsupported keywords), startup check |
| Edit | `domain/definition/NodeCatalog.java`, `DefinitionValidator.java` | Derived from the registry |
| Edit | `services/workflow-service/pom.xml` | Extra resource dir `../../packages/workflow-schema/nodes` to `workflow-schema/nodes`; default resources kept |
| Edit | `Dockerfile`, `Dockerfile.dev`, `compose.dev.yml`, `compose.workflow-smoke.yml`, `apps/web/e2e/docker/task10-runtime.compose.yml` | New `workflow-schema` build context (prod needs `--build-context workflow-schema=../../packages/workflow-schema`) |
| Add | `.../infrastructure/definition/NodeConfigSchemasTest.java` | Registry, required parity, providers, sideEffect, loader rejection, contract parity |

CI (`.github/workflows/ci.yml`) does not build this Docker image; Maven runs from the repo checkout, so the relative resource path works and `packages/**` already triggers the Java job. No change needed.

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| GitNexus impact | `node .gitnexus/run.cjs impact NodeCatalog / DefinitionValidator --direction upstream --repo Weav` | UNKNOWN (index DB locked by another process); callers confirmed with `git grep`: ExecutionRunner, WorkflowGenerationService, IntentCompiler, GenerateWorkflowRequest, DefinitionValidator; the replaced validator methods are private. DefinitionValidator is known CRITICAL |
| workflow-service | `./mvnw verify` (UTC) | 499 tests, 0 failures, 3 errors, all known environment-only (HttpTransportIntegrationTest x2, WorkflowNotificationLifecyclePersistenceIntegrationTest bridge); new `NodeConfigSchemasTest` 5/5; existing tests unmodified and green |
| workspace-service | `./mvnw -Dtest=WorkflowContractValidationTest test` | 2/2 pass |

Not checked: Docker image builds (`Dockerfile`, `Dockerfile.dev`) and a compose boot were not run.

## 5b. Review fixes

- Restored blank check for `email.send.connectionId` and `google.sheets.connectionId` (`minLength: 1`): blank publish again reports REQUIRED_FIELD_MISSING plus INVALID_CONNECTION_ID.
- `apps/web/e2e/docker/Dockerfile.task10-workflow` now copies the `workflow-schema` context.
- `NodeConfigSchemasTest` now pins the old non-blank field list, integer edge cases, blank `to` cases and a validator-level blank connection test.
- README documents that mapping strings bypass type, enum and minLength checks.

## 6. Risks and next steps

- Dev and smoke compose files that build workflow-service now require the `workflow-schema` additional context; any other external build must add it.
- `ClasspathNodeSchemaSource` uses Spring's resource resolver to list the directory (works in a Spring Boot fat jar); verify once in a built image.
- Next: FE renders forms from these files; consider generating the node section of `definition.schema.json` from them; add new nodes by adding a file (plus a Java executor).
