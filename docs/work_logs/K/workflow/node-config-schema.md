# Node config JSON Schema (Week 1, Lane 1)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon) |
| Branch | `feat/node-config-schema`, merged into `feat/week1-nodes` (98e2f65), then `staging` (bab11b8) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging` |
| Scope | One JSON Schema file per node type in `packages/workflow-schema/nodes`, loaded by workflow-service to drive the catalog and config validation |

## 2. Summary

- 13 node files (`nodes/<type>.json`, JSON Schema 2020-12 subset plus `x-weav-*` extensions) are the single source of truth for supported types, config fields, static fields, publish-required fields, field shapes and non-blank rules. Later lanes add one file per node.
- `NodeCatalog` public static API is unchanged. `DefinitionValidator` private tables (`hasValidFieldShape`, `isBlankRequiredString`, `requiredFields`) were replaced by schema checks; issue codes, paths and messages are unchanged.
- `packages/workflow-schema/README.md` is the contract note for the FE partner (mapping strings bypass type, enum and minLength checks; `maximum`, `maxLength`, `default` are informational).
- Review: 1 round; restored the blank check for `email.send.connectionId` and `google.sheets.connectionId` (`minLength: 1`), the e2e Docker workflow image now copies the `workflow-schema` context, and more parity tests.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| Domain holds a pure model (`NodeConfigSchema`, `NodeConfigSchemas`, `NodeSchemaSource`); the Jackson/Spring loader `ClasspathNodeSchemaSource` lives in infrastructure and is found by `ServiceLoader` (`META-INF/services`) | `WorkflowCleanArchitectureTest` forbids domain depending on Jackson/Spring and must stay unmodified; a static install hook would break plain `new DefinitionValidator()` tests |
| Registry initializes statically and `NodeSchemaStartupCheck` touches it at startup | A broken schema set stops the service at boot, not on the first request |
| Enums are not part of the shape check; `validateCatalogEnum` keeps its codes (`INVALID_SHEETS_OPERATION`, `INVALID_CONDITION_OPERATOR`) but reads allowed values from the schema | A shape check would report `INVALID_FIELD_TYPE` instead |
| `minLength: 1` means non-blank and applies only to fields in `required` at publish | Matches the old `isBlankRequiredString`; `ocr.extract` blank sources still give `OCR_SOURCE_REQUIRED` |
| Keywords beyond the brief: `minItems` (empty email `to`), `additionalProperties` as a schema (http headers are string maps), `x-weav-mutually-exclusive` (informational, OCR rule stays in Java) | Needed for exact parity |
| `definition.schema.json` is untouched; a test checks it agrees with the node files | Public contract, additive changes only |

## 4. Changed files

| Area | Files |
| --- | --- |
| Schema package | `packages/workflow-schema/nodes/*.json` (13), `README.md`; `nodes/.gitkeep` removed |
| workflow-service domain | `NodeConfigSchema`, `NodeConfigSchemas`, `NodeSchemaSource` (new); `NodeCatalog`, `DefinitionValidator` (derived from the registry) |
| workflow-service infrastructure | `ClasspathNodeSchemaSource` (rejects unsupported keywords), `NodeSchemaStartupCheck`, `META-INF/services/...NodeSchemaSource` |
| Build | `services/workflow-service/pom.xml` (extra resource dir `../../packages/workflow-schema/nodes`); `Dockerfile`, `Dockerfile.dev`, `compose.dev.yml`, `compose.workflow-smoke.yml`, `apps/web/e2e/docker/task10-runtime.compose.yml` and its Dockerfile (new `workflow-schema` build context) |
| Tests | `NodeConfigSchemasTest` (registry, required parity, providers, sideEffect, loader rejection, contract parity) |

CI does not build this Docker image; Maven runs from the repo checkout, so the relative resource path works and `packages/**` already triggers the Java job.

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| workflow-service | `./mvnw verify` (UTC) | 499 tests, 0 failures, 3 errors, all known environment-only; `NodeConfigSchemasTest` green, existing tests unmodified |
| workspace-service | `./mvnw -Dtest=WorkflowContractValidationTest test` | 2/2 pass |
| GitNexus impact | `NodeCatalog` / `DefinitionValidator` upstream | UNKNOWN (index locked); callers confirmed with `git grep` (ExecutionRunner, WorkflowGenerationService, IntentCompiler, GenerateWorkflowRequest); replaced validator methods are private; DefinitionValidator known CRITICAL |

Not checked: Docker image builds and a compose boot were not run.

## 6. Risks and next steps

- Dev and smoke compose files that build workflow-service need the `workflow-schema` additional context (prod: `--build-context workflow-schema=../../packages/workflow-schema`); any other external build must add it.
- `ClasspathNodeSchemaSource` lists the directory with Spring's resource resolver (works in a fat jar); verify once in a built image.
- Next: FE renders forms from these files; consider generating the node section of `definition.schema.json` from them; a new node is a new file plus a Java executor.
