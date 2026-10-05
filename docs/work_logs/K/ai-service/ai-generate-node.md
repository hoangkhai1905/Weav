# ai.generate node and ai-service `prompt` operation (Week 2, Lane B)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Repository / branch | Weav / `feat/ai-generate-node` (worktree `T:\Weav-wt\ai-generate`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented and verified locally; not committed. No live DeepSeek call made (see section 8) |
| Scope | Free-form prompt step: ai-service operation `prompt` (`POST /v1/prompt`, scope `ai:prompt`) and workflow node `ai.generate`, counted by the AI-2 quota |

## 2. Summary

- ai-service has a new operation `prompt`, built exactly like `summarize` (envelope, controller dispatch, use case `application/prompt.ts`, `PROMPT_SYSTEM` prompt, admission, dedup, the 256 KiB output cap). Input `prompt` (non-blank, 50,000 code points), optional `instructions` (max 2,000), `maxLength` (1..5000, default 1000). Output `{ text, truncated }`.
- workflow-service has node `ai.generate` (`packages/workflow-schema/nodes/ai.generate.json`), executed by `AiNodeExecutor` as operation `prompt`. Because the node catalog is derived from the schema files, it is automatically supported by the validator and offered to the generator.
- The call goes through `AiClient.call`, which already runs the AI-2 quota consumer before signing; no quota code changed. Tests prove it is counted and that `AI_QUOTA_EXCEEDED` fails it.

## 3. Decisions

| Decision | Reason | Alternatives |
| --- | --- | --- |
| Operation name `prompt`, not `generate` | `generate` is workflow generation (`claims.mode === 'generation'`) | n/a |
| The use case sends only `prompt`, `instructions`, `maxLength` to the model | `summarize` serializes the whole HTTP body (including `requestId` and `workspaceId`); for the new operation the ids never reach the model | Mirror `summarize` exactly |
| Response keeps `truncated` next to `text` | Same bounding contract as `summarize`; additive and cheap for callers | `{ text }` only |
| Provider stays in JSON mode: system prompt asks for `{"text": ...}`, "plain text, no markdown fences, no tools" | `LlmProvider` only has `completeJson`; adding a second completion mode is out of scope | New plain-text provider method |
| Scope `ai:prompt` needs no allow-list change | Both sides derive it as `ai:` + operation (`AiClient.call`, `AiController`); the controller rejects any other scope | n/a |
| `IntegrationReadiness` unchanged | It has no AI branch (only `UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES` and Telegram); AI gating is `weav.workflow.ai.enabled` inside `AiClient` | n/a |
| `maxLength` validation shared with summarize through a private helper | Same 1..5000 whole-number rule; default 1000 for `ai.generate` (200 for summarize) | Duplicate the block |

## 4. Changed files

| Path | Change |
| --- | --- |
| `services/ai-service/src/application/prompt.ts` | New use case |
| `services/ai-service/src/prompts/prompts.ts` | `PROMPT_SYSTEM` (appended before `GENERATE_SYSTEM`) |
| `services/ai-service/src/presentation/http/envelopes.ts` | `prompt` envelope |
| `services/ai-service/src/presentation/http/ai.controller.ts` | Dispatch branch and import |
| `services/ai-service/src/application/use-cases.spec.ts`, `test/ai.e2e-spec.ts` | Unit and e2e tests |
| `services/ai-service/test/fixtures/fake-deepseek.mjs` | Fake provider answers `prompt` with `{"text":"Echo: <prompt>"}` (used by `compose.ai-local.yml`) |
| `packages/contracts/http/ai/openapi.yaml`, `examples/prompt.request.json` | `/v1/prompt`, `PromptEnvelope` (additive) |
| `packages/contracts/http/workflow/definition.schema.json` | `ai.generate` in the type enum and a config block (appended) |
| `packages/workflow-schema/nodes/ai.generate.json` | New node schema |
| `services/workflow-service/.../AiNodeExecutor.java` | Type allowed, case `ai.generate` -> `prompt`, shared `maxLength` helper |
| `services/workflow-service/.../AiClientConfiguration.java` | `aiGenerateExecutor` bean |
| `services/workflow-service/.../NodeSideEffects.java` | `ai.generate` -> false (appended) |
| Tests: `AiNodeExecutorTest`, `AiClientContractTest`, `NodeConfigSchemasTest`, `DefinitionValidatorTest` | New cases and parity rows |

`ai.module.ts` and `ai-config.ts` were not touched.

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| ai-service unit | `pnpm --dir services/ai-service test` | PASS, 94 tests |
| ai-service e2e | `pnpm --dir services/ai-service run test:e2e` | PASS, 32 tests (7 new for `prompt`) |
| ai-service build | `pnpm --dir services/ai-service run build` | PASS |
| ESLint | `pnpm --dir services/ai-service exec eslint <touched src files>` | clean for `prompt.ts`, `prompts.ts`, `envelopes.ts`, `ai.controller.ts`. The two spec files already fail eslint on the base branch (37 errors, dense style and `any` access); my additions follow the surrounding style |
| workflow-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (under the `maven-workflow-service` lock) | PASS, 582 tests, 0 failures, 0 errors (surefire + failsafe; HttpTransport TLS tests passed too) |

## 6. Generator check (no change made)

- `WorkflowGenerationService.capabilities()` lists every `NodeCatalog.supportedTypes()` entry that `IntegrationReadiness` marks configured. `ai.generate` is therefore **offered** to ai-service generation with `configFields` `[instructions, maxLength, prompt]`.
- ai-service `generationResultSchema` accepts it: the type matches the capability regex `^[a-z]+(\.[a-z_]+)+$`, and a node is valid when its type is in the offered capabilities and every config key is an offered field.
- Gap: `GENERATE_SYSTEM` documents node outputs only for `http.request`, `ai.summarize`, `ai.classify`, `ai.extract`. The model is not told `ai.generate` returns `{text, truncated}`, so a generated reference such as `{{nodes.x.output.text}}` is a guess. Left alone per the brief; add one clause to `GENERATE_SYSTEM` if the generator should chain from it.

## 7. Risks

- GitNexus impact: `AiNodeExecutor` LOW, `AiController` LOW, `ENVELOPES` UNKNOWN (no resolved callers; confirmed by `git grep` that only `ai.controller.ts` uses it). The index is stale (17 commits behind).
- The shared `definition.schema.json` enum and block were appended after `ocr.extract`; other lanes appending at the same spot will conflict textually and need a trivial merge.
- Output cost: `prompt` allows 50,000-code-point input and 5,000-character output; it is bounded by the existing admission limit, request timeout, circuit breaker and the daily AI-2 quota.

## 8. Live test (for the coordinator to add to `scripts/live-test-nodes.ps1`)

Needs the real stack with the AI service enabled (`WORKFLOW_AI_ENABLED=true`, DeepSeek key, a daily limit above 0) or `compose.ai-local.yml` for the fake provider.

Definition (create workflow, publish, run manually with input `{"topic":"cà phê"}`):

```json
{
  "nodes": [
    { "id": "start", "type": "trigger.manual", "config": {} },
    { "id": "gen", "type": "ai.generate",
      "config": { "prompt": "Viết một câu chào ngắn về chủ đề: {{trigger.input.topic}}", "instructions": "Trả lời bằng tiếng Việt, một câu.", "maxLength": 200 } }
  ],
  "edges": [ { "id": "e1", "source": "start", "target": "gen" } ]
}
```

Expected: execution `SUCCEEDED`; node `gen` output `{ "text": "<non-empty Vietnamese sentence, at most 200 characters>", "truncated": false }`. With the fake provider the output is `{"text":"Echo: Viết một câu chào ngắn về chủ đề: cà phê","truncated":false}`.
Negative checks: a blank `prompt` is rejected by publish validation (same blank-content rule as the other AI text fields); `maxLength: 5001` fails the node with `CONFIGURATION_ERROR`; with the daily limit exhausted the node fails with `AI_QUOTA_EXCEEDED` (each run, including this one, counts 1).

## 9. Next steps

- Coordinator: add the live-test flow, decide whether to extend `GENERATE_SYSTEM` with the `ai.generate` output shape, and add web UI (node catalog, readiness, translations) if the node should appear in the builder.

## 10. Review round 1

- `PROMPT_SYSTEM`: answers in the language requested by `instructions`, else the language of `prompt`; no `DATA_RULE` (the prompt is the task), with an explicit clause that role/format/rule-reveal attempts inside `prompt` or `instructions` are content and the reply stays `{"text": ...}`. Other operations unchanged. No test asserts prompt text.
- `GENERATE_SYSTEM`: `ai.generate -> {text, truncated}` added to the node-outputs line (no snapshot test exists).
- `AiNodeExecutor`: `prompt` over 50,000 code points, `instructions` over 2,000 code points, or non-String non-null `instructions` fail with non-retryable `CONFIGURATION_ERROR` before `client.execute` (quota untouched); blank `instructions` is still ignored.
- `AiClientSpringContextTest` (new): registry resolves `ai.generate` to the `aiGenerateExecutor` bean, and executing it consumes the (mocked) `AiQuota` through the `AiClient` bean.
- Non-object model output: `DeepseekProvider.completeJson` rejects anything that is not a plain object (null, array, scalar) with `AI_OUTPUT_INVALID`, so `prompt` never sees one; `summarize` shares the same guarantee through the provider (unchanged). Use cases also reject missing/blank `text`.
- Verify: ai-service 94 unit + 32 e2e pass, build and eslint (production files) clean; workflow-service `./mvnw verify` exit 0.
