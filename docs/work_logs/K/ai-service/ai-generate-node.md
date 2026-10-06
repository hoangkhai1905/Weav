# ai.generate node and ai-service `prompt` operation (Week 2, Lane B)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Branch | `feat/ai-generate-node` (from `staging`), merged into `staging` (f5db227) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`. Live test against real DeepSeek passed 2026-10-06 (section 7) |
| Scope | Free-form prompt step: ai-service operation `prompt` (`POST /v1/prompt`, scope `ai:prompt`) and workflow node `ai.generate`, counted by the AI-2 quota |

## 2. Summary

- ai-service operation `prompt`, built like `summarize` (envelope, controller dispatch, use case `application/prompt.ts`, `PROMPT_SYSTEM`, admission, dedup, 256 KiB output cap). Input `prompt` (non-blank, 50,000 code points), optional `instructions` (max 2,000), `maxLength` (1..5000, default 1000). Output `{ text, truncated }`.
- workflow-service node `ai.generate` (`packages/workflow-schema/nodes/ai.generate.json`), executed by `AiNodeExecutor` as operation `prompt`. The catalog is derived from schema files, so the validator supports it and the generator is offered it.
- The call goes through `AiClient.call`, which already runs the AI-2 quota consumer before signing; no quota code changed. Tests prove it is counted and that `AI_QUOTA_EXCEEDED` fails it.
- Review: 1 round; hardened `PROMPT_SYSTEM`, `GENERATE_SYSTEM` now documents the `ai.generate` output, executor input-size checks before any call, Spring context test.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| Operation name `prompt`, not `generate` | `generate` is workflow generation (`claims.mode === 'generation'`) |
| The use case sends only `prompt`, `instructions`, `maxLength` to the model | `summarize` serializes the whole HTTP body (incl. `requestId`, `workspaceId`); here the ids never reach the model |
| Response keeps `truncated` next to `text` | Same bounding contract as `summarize`; additive |
| Provider stays in JSON mode (`{"text": ...}`, "plain text, no markdown fences, no tools"); `DeepseekProvider.completeJson` rejects non-object output with `AI_OUTPUT_INVALID`; the use case rejects missing/blank `text` | `LlmProvider` only has `completeJson`; a second completion mode is out of scope |
| `PROMPT_SYSTEM` answers in the language requested by `instructions`, else the language of `prompt`; no `DATA_RULE` (the prompt is the task) but an explicit clause that role/format/rule-reveal attempts inside `prompt` or `instructions` are content and the reply stays `{"text": ...}` | The prompt is the task, but injection must not change the output shape |
| `GENERATE_SYSTEM` node-outputs line now includes `ai.generate -> {text, truncated}` | Lets generated workflows chain `{{nodes.x.output.text}}` |
| `AiNodeExecutor` fails non-retryably with `CONFIGURATION_ERROR` before `client.execute` (quota untouched) for `prompt` over 50,000 code points, `instructions` over 2,000, or non-String non-null `instructions`; blank `instructions` is ignored; `maxLength` 5001 gives `CONFIGURATION_ERROR` | Cheap local checks; `maxLength` validation shared with summarize through a private helper (default 1000 here, 200 for summarize) |
| Scope `ai:prompt` needs no allow-list change; `IntegrationReadiness` unchanged | Both sides derive scope as `ai:` + operation; AI gating is `weav.workflow.ai.enabled` inside `AiClient` |

## 4. Changed files

| Area | Files |
| --- | --- |
| ai-service | new `application/prompt.ts`; `prompts/prompts.ts` (`PROMPT_SYSTEM`, `GENERATE_SYSTEM` line), `presentation/http/envelopes.ts`, `ai.controller.ts`; tests `use-cases.spec.ts`, `test/ai.e2e-spec.ts`; `test/fixtures/fake-deepseek.mjs` (answers `prompt` with `{"text":"Echo: <prompt>"}`, used by `compose.ai-local.yml`) |
| Contracts | `packages/contracts/http/ai/openapi.yaml` + `examples/prompt.request.json` (`/v1/prompt`, additive); `definition.schema.json` (`ai.generate` enum and block, appended after `ocr.extract`) |
| Schema | `packages/workflow-schema/nodes/ai.generate.json` |
| workflow-service | `AiNodeExecutor` (case `ai.generate` to `prompt`), `AiClientConfiguration` (`aiGenerateExecutor` bean), `NodeSideEffects` (`ai.generate` false); tests `AiNodeExecutorTest`, `AiClientContractTest`, new `AiClientSpringContextTest`, `NodeConfigSchemasTest`, `DefinitionValidatorTest` |

`ai.module.ts` and `ai-config.ts` were not touched.

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| ai-service unit | `pnpm --dir services/ai-service test` | PASS, 94 tests |
| ai-service e2e | `pnpm --dir services/ai-service run test:e2e` | PASS, 32 tests (7 new for `prompt`) |
| ai-service build | `pnpm --dir services/ai-service run build` | PASS |
| ESLint | `pnpm --dir services/ai-service exec eslint <touched src files>` | clean for production files; the two spec files already fail eslint on the base branch (37 errors, dense style and `any` access) |
| workflow-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | PASS, exit 0 (582 tests, 0 failures before review additions; HttpTransport TLS tests passed too) |
| GitNexus impact | upstream, index 17 commits stale | `AiNodeExecutor` LOW, `AiController` LOW, `ENVELOPES` UNKNOWN (only `ai.controller.ts` uses it per `git grep`) |

## 6. Risks and notes

- `definition.schema.json` enum and block were appended after `ocr.extract`; other lanes appending there need a trivial textual merge (already merged).
- Output cost: 50,000-code-point input and 5,000-character output; bounded by admission limit, request timeout, circuit breaker and the daily AI-2 quota.
- The generator is offered `ai.generate` with `configFields [instructions, maxLength, prompt]`; ai-service `generationResultSchema` accepts it.

## 7. Live test (`scripts/live-test-nodes.ps1 -Flow ai`; see `scripts/README.md`)

Needs the real stack with the AI service enabled (`WORKFLOW_AI_ENABLED=true`, DeepSeek key, daily limit above 0) or `compose.ai-local.yml` for the fake provider. Create a workflow, publish, run manually with input `{"topic":"cà phê"}`:

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

Expected: execution `SUCCEEDED`; node `gen` output `{ "text": "<non-empty Vietnamese sentence, at most 200 characters>", "truncated": false }` (fake provider: `{"text":"Echo: Viết một câu chào ngắn về chủ đề: cà phê","truncated":false}`). Negative: blank `prompt` is rejected by publish validation; `maxLength: 5001` fails the node with `CONFIGURATION_ERROR`; with the daily limit exhausted the node fails with `AI_QUOTA_EXCEEDED` (each run counts 1). The `-Flow ai` flow exists in the script (fefb1fc).

**Live test result (2026-10-06): done.** `-Flow ai -Cleanup` against the real stack (`WORKFLOW_AI_ENABLED=true`, `WORKFLOW_AI_GENERATION_ENABLED=true`, real DeepSeek, started without `compose.ai-local.yml`): all steps PASS, reported by K (one run; `text` non-empty and within `maxLength` 200). Run after the partner's stack was stopped (shared Neon `workflow_db`, see `docs/work_logs/K/workflow/core-logic-nodes.md` section 9). The AI flags were left `true` in K's local `.env` afterwards.

## 8. Next steps

- Add web UI (node catalog, readiness, translations) if the node should appear in the builder.
