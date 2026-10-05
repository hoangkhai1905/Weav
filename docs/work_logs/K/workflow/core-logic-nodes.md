# Work log: core logic nodes (logic.switch, data.set, text coercion)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Week 2, Lane A) |
| Repository | Weav, workflow-service + packages/workflow-schema + packages/contracts |
| Branch | `feat/core-logic-nodes` (from `staging`), worktree `T:\Weav-wt\core-logic` |
| Status | In review: implemented and tested, uncommitted (the coordinator commits) |
| Scope | `logic.switch`, `data.set`, named edge ports, number/boolean to text coercion in `ExecutionRunner.resolveConfig` |

## 2. Summary

- `logic.switch`: multi-way branch. Each case string is an output port; `default` is reserved and taken when nothing matches. `logic.condition` is unchanged.
- `data.set`: builds an object from `fields`; mappings resolve recursively in nested objects/arrays (`MappingResolver` already did this).
- Edge `sourcePort` in the contract is now any string of 1..64 characters or null (additive).
- A mapped number or boolean is turned into text before the config re-validation when the target field is a string-only template field.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| `cases` is a plain array of strings, not a template and not `x-weav-static` | `x-weav-static` is validated as an AI output schema (`OutputSchemaPolicy`), so it cannot hold a case list. `resolveConfig` resolves every non-static field, so cases containing `{{`/`}}` are rejected at publish (`INVALID_SWITCH_CASES`). |
| Case rules checked at publish only: 1..20, non-blank, at most 64 chars, unique, none equal to `default`, no mapping delimiters. Empty list is reported by the existing required/minItems check (`REQUIRED_FIELD_MISSING`), more than 20 or the other problems by `INVALID_SWITCH_CASES` | Drafts may be partial (README rule). |
| Draft edge check: any non-blank port of at most 64 chars, else `INVALID_SOURCE_PORT` | Per brief. Consequence: a draft edge with port `next` is now valid in a draft (the old test used it as invalid; changed to `" "`). |
| Publish edge check by source type: condition true/false only (same code and message), switch case or `default`, every other node no port. Fan-out to the same port stays allowed (nothing forbids it for condition either). Not every port needs an edge | Mirrors condition. |
| Condition edge with a null port used to throw NullPointerException in `validatePublishGraph` (`Set.of().contains(null)`); now it reports `INVALID_SOURCE_PORT` | Found while testing "condition unchanged". |
| `ReadinessPlanner.outgoingStates` treats `logic.switch` like condition (selected port ACTIVE, others INACTIVE). A selected port without an edge makes all edges INACTIVE. A switch edge without a port or a switch without a selected port throws `IllegalArgumentException`. Condition and generic messages unchanged | Branch skipping reuses the existing propagation. |
| Text rule `JsonValues.scalarText` (domain, so both the switch executor in application and `resolveConfig` use it without breaking `WorkflowCleanArchitectureTest`): strings as is, booleans `true`/`false`, integral numbers without point/exponent (12.0 gives `12`, 1e20 gives `100000000000000000000`), other numbers via `BigDecimal` plain string; null, objects, arrays, NaN give null | One place for the rule. |
| Switch output `{"value": resolved value, "port": selected port}`; null value is kept. Value null/object/array matches no case so goes to `default`; comparison is exact (case and whitespace sensitive) | Per brief. |
| Coercion only for fields where `NodeConfigSchema.stringOnlyFields()` (new accessor: `template` true, `type: string`, no `oneOf`), top-level only. The check runs after mapping resolution and before `validateDraft` | Literal non-strings are already rejected at publish, so only mapped values are affected. `ponytail:` comment names the nested-value ceiling. |
| `data.set` key rules (1..100 keys, non-blank, at most 128 chars) at publish, `INVALID_DATA_SET_FIELDS`; empty `fields` is reported by this check | Per brief. `fields` is `x-weav-template` so a whole-object mapping string is also accepted in a draft; the runner then requires an object (else `CONFIGURATION_ERROR`). |
| Both nodes `category: logic`, `sideEffect: false`; added to `NodeSideEffects` false list (the default for unknown types is side-effecting) | README allows `logic`. |
| Executors are small private classes in `NodeExecutorRegistry` registered with `putIfAbsent`, like the condition executor | Same pattern, no new files in main. |

Review round 1 additions:

- The private data.set executor repeats the key checks at runtime (empty, more than 100 entries, blank key or key over 128 chars give a non-retryable `CONFIGURATION_ERROR`), because a whole-object mapping (`fields = "{{ trigger.input.fields }}"`) skips the publish-only checks. A non-object value already fails the runner's shape re-check.
- `resolveConfig` skips coercion when the node type has no schema (null guard).
- Whole-value mappings coerce 12.0 to "12", but interpolation (`"id-{{x}}"`) keeps `MappingResolver`'s existing rendering (`appendScalar`, so 12.0 stays "12.0"). Unchanged on purpose: changing it is not additive.
- `WorkflowGenerationService.capabilities()` no longer lists `logic.switch` (test added; `data.set` is still offered), because ai-service generation only allows true/false edge ports. Week 3 can re-enable it by widening the port enum in `services/ai-service/src/domain/workflow-generation/generation-result.ts` and the generation prompt, then removing the filter. This replaces the "offered to the AI" statement in section 7.
- logic.switch `value` description now states exact, case- and whitespace-sensitive text matching and the no-trailing-".0" rule.

## 4. Changed files

| Type | Path | Change |
| --- | --- | --- |
| Add | `packages/workflow-schema/nodes/logic.switch.json`, `data.set.json` | Node schemas |
| Edit | `packages/contracts/http/workflow/definition.schema.json` | Type enum + two node blocks (appended); `sourcePort` string 1..64 or null |
| Edit | `domain/definition/DefinitionValidator.java` | Port rules, switch cases, data.set keys, null-safe condition port |
| Edit | `domain/definition/JsonValues.java` | `scalarText` |
| Edit | `domain/definition/NodeConfigSchema.java` | `stringOnlyFields()` |
| Edit | `domain/definition/NodeSideEffects.java`, `WorkflowDefinition.java` | New types listed as side-effect free; Edge javadoc |
| Edit | `domain/execution/ReadinessPlanner.java` | Switch routing |
| Edit | `application/node/NodeExecutorRegistry.java` | Switch and data.set executors |
| Edit | `application/execution/ExecutionRunner.java` | Coercion in `resolveConfig` |
| Tests | `DefinitionValidatorTest`, `ReadinessPlannerTest`, `ExecutionRunnerTest`, `NodeConfigSchemasTest`; new `application/node/CoreLogicNodeExecutorsTest` | See section 6 |

Web and mobile code was not edited (frontend partner).

## 5. String-only template fields now covered by the coercion

ai.classify: content. ai.extract: text, instructions, schemaDescription. ai.summarize: inputText. email.send: subject, body. google.calendar: calendarId, summary, description, location, start, end, timeZone. google.drive: name, content, mimeType, folderId, nameContains. google.sheets: operation (enum, a number then fails the enum check), spreadsheetId, range. http.request: method, url. logic.condition: operator (enum). ocr.extract: artifactId, fileUrl, language. telegram.send_message: text. trigger.manual: buttonLabel. trigger.schedule: cron, timezone.
Not covered (not template or not string-only): all `connectionId`, `google.drive.operation` (not template); `telegram.send_message.chatId` and `email.send.to` (`oneOf`); array items and nested object values.

## 6. Evidence

| Check | Command | Result |
| --- | --- | --- |
| Focused tests | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw -Dtest='DefinitionValidatorTest,ReadinessPlannerTest,ExecutionRunnerTest,CoreLogicNodeExecutorsTest,NodeConfigSchemasTest' test` (workflow-service) | PASS (104 tests) |
| Full verify | `./mvnw verify` (workflow-service) | PASS (607 tests, 0 failures, 0 errors; the known env-only errors did not occur) |
| Contract | `./mvnw -Dtest=WorkflowContractValidationTest test` (workspace-service) | PASS (2 tests) |

Test coverage: validator (switch ports draft/publish, invalid cases, condition unchanged, data.set keys, type list, null condition port), planner (selected/default/unused port, missing port), runner end to end (switch routing with a number value, default port with string/number/decimal, skipped branches, data.set output used by a downstream mapping incl. nested values, coercion of int/12.0/1e20/2.5/true/false into email.send subject and body, object into a string field still `CONFIGURATION_ERROR`), executors, schema parity rows.

## 7. AI generator check (no ai-service change)

- `WorkflowGenerationService.capabilities()` offers every catalog type that `IntegrationReadiness` marks configured, so `logic.switch` (configFields `cases`, `value`) and `data.set` (`fields`) are now offered to the AI. The ai-service envelope accepts them (type regex `^[a-z]+(\.[a-z_]+)+$`, at most 40 capabilities; 17 now).
- ai-service `generation-result.ts` accepts any offered type with its config fields, but its edge `port` is `z.enum(['true','false'])`, so a generated switch with case ports (or `default`) is rejected at ai-service validation; a switch with no port fails publish. `data.set` is accepted. Follow-up for ai-service: widen the edge port to a bounded string and mention switch ports in the prompt, or filter `logic.switch` out of `capabilities()` until then.

## 8. Risks and notes

- Impact (stale GitNexus index, 17 commits behind): DefinitionValidator MEDIUM (35 impacted, 13 direct), ExecutionRunner LOW (4), ReadinessPlanner LOW (4), NodeExecutorRegistry LOW (9), NodeSideEffects LOW (4); NodeConfigSchema not found in the index (callers confirmed with `git grep`). Public signatures unchanged.
- `data.set` field names that look like credentials (token, password, secret, ...) are still refused by the existing credential-key scan.
- Case values are compared as text, so a switch on `1.0` (string) does not match case `1`, while a number 1.0 does.

## 9. What the frontend needs (not done here)

- Edge `sourcePort` can be any case string or `default` for `logic.switch` sources; the builder needs one handle per case plus a `default` handle, and a `cases` list editor (1..20, unique, no `default`). Types in `workflow.types.ts` (`sourcePort`) are true/false only today.
- Node catalog entries and icons for `logic.switch` and `data.set` (`data.set.fields` is a key/value editor with mapping picker per value, any JSON value).

## 10. Live test

1. Create a workflow: `trigger.manual` (input `{"plan": 2}`), `logic.switch` (`value = {{ trigger.input.plan }}`, `cases = ["1","2"]`), three `http.request` or `data.set` nodes on edges with `sourcePort` `"1"`, `"2"`, `"default"`. Publish (expect success), run: only the `"2"` branch succeeds, the others are SKIPPED, switch output `{"value":2,"port":"2"}`. Run with `{"plan":"gold"}`: the `default` branch runs.
2. Publish with an edge port `"bronze"` from the switch: expect `INVALID_SOURCE_PORT`. Cases `["a","a"]` or `["default"]`: `INVALID_SWITCH_CASES`.
3. `data.set` with `fields = {"name":"{{ trigger.input.user.first }}","n":"{{ trigger.input.count }}"}` followed by `email.send` with `subject = {{ nodes.shape.output.n }}`: the email subject is the number as text and the run succeeds (previously `CONFIGURATION_ERROR`).

## 11. Next steps

- Coordinator: review, commit, merge into `staging`; add the flows above to `scripts/live-test-nodes.ps1`.
- ai-service follow-up for switch ports (section 7); frontend work (section 9).
