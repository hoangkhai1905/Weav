# Core logic nodes (logic.switch, data.set, text coercion) (Week 2, Lane A)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Branch | `feat/core-logic-nodes` (from `staging`), merged into `staging` (a6f4164) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`. Live-test flow exists in `scripts/live-test-nodes.ps1 -Flow logic` (fefb1fc); a live run result is not recorded here |
| Scope | `logic.switch`, `data.set`, named edge ports, number/boolean to text coercion in `ExecutionRunner.resolveConfig` (workflow-service, `packages/workflow-schema`, `packages/contracts`) |

## 2. Summary

- `logic.switch`: multi-way branch. Each case string is an output port; `default` is reserved and taken when nothing matches. `logic.condition` is unchanged. Output `{"value": resolved value, "port": selected port}` (null value kept).
- `data.set`: builds an object from `fields`; mappings resolve recursively in nested objects/arrays.
- Edge `sourcePort` in the contract is now any string of 1..64 chars or null (additive).
- A mapped number or boolean becomes text before config re-validation when the target is a string-only template field.
- Review: 1 round; runtime key checks for `data.set`, null guard in coercion, `logic.switch` filtered out of AI generation, switch `value` description.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| `cases` is a plain array of strings, not a template and not `x-weav-static`; cases containing `{{`/`}}` are rejected at publish (`INVALID_SWITCH_CASES`) | `x-weav-static` is validated as an AI output schema (`OutputSchemaPolicy`); `resolveConfig` resolves every non-static field |
| Case rules at publish only: 1..20, non-blank, at most 64 chars, unique, none equal to `default`, no mapping delimiters. Empty list is `REQUIRED_FIELD_MISSING` (existing minItems check); the rest is `INVALID_SWITCH_CASES` | Drafts may be partial (README rule) |
| Draft edge check: any non-blank port of at most 64 chars, else `INVALID_SOURCE_PORT` (a draft edge with port `next` is now valid; the old test used `" "` instead) | Per brief |
| Publish edge check by source type: condition true/false only (same code and message), switch case or `default`, every other node no port. Fan-out to the same port and unused ports are allowed | Mirrors condition |
| A condition edge with a null port used to throw NullPointerException in `validatePublishGraph`; now reports `INVALID_SOURCE_PORT` | Found while testing "condition unchanged" |
| `ReadinessPlanner.outgoingStates` treats `logic.switch` like condition (selected port ACTIVE, others INACTIVE; a selected port without an edge makes all edges INACTIVE; a switch edge without a port or no selected port throws `IllegalArgumentException`) | Reuses branch-skip propagation |
| Text rule `JsonValues.scalarText` in domain (so executor and `resolveConfig` share it without breaking `WorkflowCleanArchitectureTest`): strings as is, booleans `true`/`false`, integral numbers without point/exponent (12.0 gives `12`, 1e20 gives `100000000000000000000`), other numbers via `BigDecimal` plain string; null, objects, arrays, NaN give null | One place for the rule |
| Switch comparison is exact text (case and whitespace sensitive); null/object/array value goes to `default`; a string `"1.0"` does not match case `1`, a number 1.0 does | Per brief |
| Coercion only for `NodeConfigSchema.stringOnlyFields()` (new accessor: `template` true, `type: string`, no `oneOf`), top-level only, after mapping resolution and before `validateDraft`; skipped when the node type has no schema. Whole-value mappings coerce 12.0 to "12"; interpolation (`"id-{{x}}"`) keeps `MappingResolver`'s rendering ("12.0"), unchanged because changing it is not additive. A `ponytail:` comment names the nested-value ceiling | Literal non-strings are already rejected at publish, so only mapped values are affected |
| `data.set` key rules at publish (`INVALID_DATA_SET_FIELDS`): 1..100 keys, non-blank, at most 128 chars. The executor repeats them at runtime (non-retryable `CONFIGURATION_ERROR`) because `fields = "{{ trigger.input.fields }}"` skips publish checks; a non-object value fails the runner's shape re-check | `fields` is `x-weav-template`, so a whole-object mapping is accepted in a draft |
| Both nodes `category: logic`, `sideEffect: false`; added to the `NodeSideEffects` false list (default for unknown types is side-effecting) | README allows `logic` |
| Executors are small private classes in `NodeExecutorRegistry`, registered with `putIfAbsent` like condition | Same pattern, no new main files |
| `WorkflowGenerationService.capabilities()` no longer lists `logic.switch` (test added); `data.set` is still offered | ai-service generation edge `port` is `z.enum(['true','false'])`, so a generated switch would be rejected. Week 3: widen the port enum in `services/ai-service/src/domain/workflow-generation/generation-result.ts` and the prompt, then remove the filter |
| `data.set` field names that look like credentials (token, password, secret, ...) are still refused by the existing credential-key scan | Existing behaviour |

String-only template fields now covered by coercion: ai.classify `content`; ai.extract `text`, `instructions`, `schemaDescription`; ai.summarize `inputText`; email.send `subject`, `body`; google.calendar `calendarId`, `summary`, `description`, `location`, `start`, `end`, `timeZone`; google.drive `name`, `content`, `mimeType`, `folderId`, `nameContains`; google.sheets `operation` (enum, a number then fails the enum check), `spreadsheetId`, `range`; http.request `method`, `url`; logic.condition `operator` (enum); ocr.extract `artifactId`, `fileUrl`, `language`; telegram.send_message `text`; trigger.manual `buttonLabel`; trigger.schedule `cron`, `timezone`. Not covered: all `connectionId`, `google.drive.operation`, `telegram.send_message.chatId` and `email.send.to` (`oneOf`), array items and nested object values.

## 4. Changed files

| Area | Files |
| --- | --- |
| Schemas and contract | new `logic.switch.json`, `data.set.json`; `definition.schema.json` (type enum, two node blocks appended, `sourcePort` string 1..64 or null) |
| workflow-service domain | `DefinitionValidator` (port rules, switch cases, data.set keys, null-safe condition port), `JsonValues.scalarText`, `NodeConfigSchema.stringOnlyFields()`, `NodeSideEffects`, `WorkflowDefinition` (Edge javadoc), `ReadinessPlanner` (switch routing) |
| workflow-service application | `NodeExecutorRegistry` (switch and data.set executors), `ExecutionRunner` (coercion), `WorkflowGenerationService` (switch filter) |
| Tests | `DefinitionValidatorTest`, `ReadinessPlannerTest`, `ExecutionRunnerTest`, `NodeConfigSchemasTest`, `WorkflowGenerationServiceTest`; new `CoreLogicNodeExecutorsTest` |

Web and mobile were not edited (frontend partner).

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| workflow-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | 607 tests, 0 failures, 0 errors (known environment-only errors did not occur) |
| workspace-service | `./mvnw -Dtest=WorkflowContractValidationTest test` | 2 tests pass |
| GitNexus impact | upstream, index 17 commits stale | `DefinitionValidator` MEDIUM (35 impacted, 13 direct); `ExecutionRunner`, `ReadinessPlanner`, `NodeExecutorRegistry`, `NodeSideEffects` LOW; `NodeConfigSchema` not indexed (callers confirmed with `git grep`); public signatures unchanged |

Coverage: switch ports (draft/publish, invalid cases, default, unused, missing), planner, end-to-end switch routing and skipped branches, `data.set` output used downstream incl. nested values, coercion of int/12.0/1e20/2.5/true/false into `email.send`, object into a string field still `CONFIGURATION_ERROR`.

## 6. Live test (`scripts/live-test-nodes.ps1 -Flow logic`, see `scripts/README.md`; manual equivalent)

1. `trigger.manual` (input `{"plan": 2}`), `logic.switch` (`value = {{ trigger.input.plan }}`, `cases = ["1","2"]`), three `http.request` or `data.set` nodes on edges with `sourcePort` `"1"`, `"2"`, `"default"`. Publish OK; run: only `"2"` succeeds, others SKIPPED, switch output `{"value":2,"port":"2"}`. Input `{"plan":"gold"}`: `default` runs.
2. Edge port `"bronze"` from the switch: `INVALID_SOURCE_PORT`. Cases `["a","a"]` or `["default"]`: `INVALID_SWITCH_CASES`.
3. `data.set` with `fields = {"name":"{{ trigger.input.user.first }}","n":"{{ trigger.input.count }}"}` then `email.send` with `subject = {{ nodes.shape.output.n }}`: subject is the number as text, run succeeds (previously `CONFIGURATION_ERROR`).

## 7. FE handoff (not done here)

- Edge `sourcePort` can be any case string or `default` for `logic.switch` sources: the builder needs one handle per case plus `default`, and a `cases` list editor (1..20, unique, no `default`). `workflow.types.ts` `sourcePort` is true/false only today.
- Node catalog entries and icons for `logic.switch` and `data.set` (`data.set.fields` is a key/value editor with a mapping picker per value, any JSON value).

## 8. Next steps

- Run `-Flow logic` live and record the result.
- ai-service follow-up for switch ports (section 3, generation row); frontend work (section 7).
