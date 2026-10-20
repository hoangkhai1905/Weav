# AI provider with your own key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `ai.summarize`, `ai.classify`, `ai.extract`, `ai.generate` run on OpenAI, Anthropic or Gemini with a workspace's own API key, keeping the Weav default (DeepSeek) when none is chosen.

**Architecture:** Three new `TOKEN` connection providers in workspace-service (key checked by a `GET models` call). workflow-service's `AiNodeExecutor` resolves an optional `connectionId` and sends `llm: {provider, apiKey, model?}` to ai-service, which builds a per-request adapter (`OpenAiCompatibleProvider` for OpenAI/Gemini/DeepSeek, `AnthropicProvider`) outside the circuit breaker. Web adds three connection cards and one `AiConnectionField` used by the four AI inspectors.

**Tech Stack:** Spring Boot (workspace-service, workflow-service), NestJS + zod + jest (ai-service), React + Vite + Playwright (web), JSON Schema (packages).

**Spec:** `docs/superpowers/specs/2026-10-20-ai-provider-byo-key-design.md` (read it with this plan).

## Global Constraints

- Branch `feature/ai-provider-byok` from `dev`; one commit per task (`git commit -m "summary" -m "description"`), ending with the attribution line from the session. Commit the spec and this plan in Task 1.
- GitNexus upstream `impact` before editing any existing symbol; warn on HIGH/CRITICAL; treat `UNKNOWN` as unresolved and confirm with a text search. `detect_changes --scope all` before every commit.
- Additive only: a request/definition without `connectionId`/`model`/`llm` behaves exactly as today.
- Providers: `OPENAI`, `ANTHROPIC`, `GEMINI`; auth type `TOKEN`; credential `{ "token": "<key>" }`; key 1..512 chars, no control characters.
- Model name rule: `^[A-Za-z0-9._:/-]{1,100}$`.
- Base URLs (constants, never user input): OpenAI `https://api.openai.com/v1`, Gemini `https://generativelanguage.googleapis.com/v1beta/openai`, Anthropic `https://api.anthropic.com`.
- New ai-service codes: `AI_PROVIDER_RATE_LIMITED` (429), `AI_MODEL_NOT_FOUND` (400).
- The key never appears in logs, error messages, stored step input/output or dedup entries. No `console.log`.
- Verify commands: ai-service `pnpm --dir services/ai-service test`, `test:e2e`, `build`; Java `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` from the service folder (known env-only failures listed in CLAUDE.md); web `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/web build`, `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium <spec>`.
- UI copy: plain Vietnamese first (English correct), friendly provider names "ChatGPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)".

## Review Focus

1. Key with leading/trailing whitespace pasted into the form → trimmed on the web before save; workspace-service rejects control characters (Task 4 test `rejectsKeyWithControlCharacters`, Task 6 trims).
2. Connection deleted or switched to another provider after the step was configured → run fails `CONNECTION_FORBIDDEN`/`CONNECTION_CONFIGURATION_INVALID`, not a crash or a call with the wrong key (Task 5 test `rejectsNonAiConnection`).
3. `model` filled while "Weav default AI" is selected (e.g. switched back after typing) → web clears `model` when the connection is cleared; publish rejects `model` without `connectionId` (Task 5 `modelWithoutConnectionIsRejected`, Task 7 Playwright case).
4. Provider returns 200 with JSON wrapped in prose or code fences (Anthropic) → `AI_OUTPUT_INVALID`, never a partial result (Task 2 test `anthropicRejectsNonJsonText`).
5. Retry of the same step (same `requestId`) after a provider 429 → dedup does not cache the failure and the key is not stored in the dedup entry (Task 3 test `byokFailureIsNotCachedAndKeyNotRetained`).

---

### Task 1: Schemas and contracts (+ loaders that read them)

**Files:**
- Modify: `packages/workflow-schema/nodes/ai.summarize.json`, `ai.classify.json`, `ai.extract.json`, `ai.generate.json`
- Modify: `packages/contracts/http/workflow/definition.schema.json` (ai.* entries ~687-906)
- Modify: `packages/contracts/http/ai/openapi.yaml`; Create: `packages/contracts/http/ai/examples/summarize-byok.json`
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/definition/ClasspathNodeSchemaSource.java:116-120`
- Modify: `apps/web/src/lib/nodeSchemas.ts:15`, `apps/web/src/pages/AiGeneratorPage.tsx:261`
- Test: `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/NodeConfigSchemasTest.java`
- Add: `docs/superpowers/specs/2026-10-20-ai-provider-byo-key-design.md`, this plan

**Interfaces:**
- Produces: node config fields `connectionId` (optional string, `x-weav-connection: {"provider": ["OPENAI","ANTHROPIC","GEMINI"]}`) and `model` (optional string, `minLength 1`, `maxLength 100`, `x-weav-ui: {advanced: true}`) on the four AI nodes; ai envelope field `llm` documented in openapi; web type `'x-weav-connection'?: { provider: string | string[] }`.

- [ ] **Step 1: Write the failing tests** in `NodeConfigSchemasTest`:
  - `aiNodesDeclareOptionalConnectionAndModel`: for each of the four types, `connectionFields()` contains `"connectionId"`, `required` does not contain `connectionId` or `model`.
  - `connectionProviderAcceptsArray`: a schema with `"x-weav-connection": {"provider": ["A","B"]}` loads.
  - `connectionProviderRejectsEmptyArrayOrBlank`: `[]`, `[""]`, `""` each throw.
- [ ] **Step 2:** `./mvnw -Dtest=NodeConfigSchemasTest test` → FAIL.
- [ ] **Step 3:** Add the two fields to the four node JSONs (titles "AI for this step", "Model name"); in `ClasspathNodeSchemaSource` accept a string or a non-empty array of non-blank strings and store a non-null marker (join with `,`) in the existing `String` slot — `connectionFields()` only tests non-null. Mirror the fields in `definition.schema.json` (with `"pattern": "^[A-Za-z0-9._:/-]{1,100}$"` on `model`). Document `llm` (spec §5.3) on extract/classify/summarize/prompt in `openapi.yaml`, add both new error codes, add the example. Web: widen the type; `AiGeneratorPage` shows `[provider].flat().join(', ')`.
- [ ] **Step 4:** `./mvnw -Dtest=NodeConfigSchemasTest test` → PASS; web `tsc` and `build` pass; full `./mvnw verify` for workflow-service.
- [ ] **Step 5:** Commit `feat(contracts): optional AI connection and model on AI nodes`.

### Task 2: ai-service provider adapters

**Files:**
- Rename: `services/ai-service/src/infrastructure/llm/deepseek/deepseek-provider.ts` → `services/ai-service/src/infrastructure/llm/openai-compatible-provider.ts` (+ its spec); update import in `src/main.ts`
- Create: `services/ai-service/src/infrastructure/llm/anthropic-provider.ts` + `anthropic-provider.spec.ts`
- Modify: `services/ai-service/src/domain/errors.ts`

**Interfaces:**
- Produces:
  ```ts
  interface OpenAiCompatibleConfig { apiKey: string; model: string; baseUrl: string; maxTokens: number;
    maxResponseBytes: number; tokenParam: 'max_tokens' | 'max_completion_tokens'; sendTemperature: boolean;
    userKey: boolean } // userKey=false keeps today's DeepSeek mapping
  class OpenAiCompatibleProvider implements LlmProvider
  interface AnthropicConfig { apiKey: string; model: string; maxTokens: number; maxResponseBytes: number }
  class AnthropicProvider implements LlmProvider
  ```
  Error codes `AI_PROVIDER_RATE_LIMITED` (429, "The AI provider rate limit or credit was exceeded."), `AI_MODEL_NOT_FOUND` (400, "The model was not found at the AI provider.").

- [ ] **Step 1: Write the failing tests** (fake `fetch`, no network):
  - existing DeepSeek specs pass unchanged with `userKey: false, tokenParam: 'max_tokens', sendTemperature: true` (429 → `AI_PROVIDER_UNAVAILABLE`, 404 → `AI_OUTPUT_INVALID`).
  - `userKey: true`: 401/402/403 → `AI_PROVIDER_AUTH`; 429 → `AI_PROVIDER_RATE_LIMITED`; 404 → `AI_MODEL_NOT_FOUND`; 400 whose body (read capped at 4 KiB) contains `model` → `AI_MODEL_NOT_FOUND`, other 400 → `AI_OUTPUT_INVALID`; 5xx → `AI_PROVIDER_UNAVAILABLE`.
  - `tokenParam: 'max_completion_tokens', sendTemperature: false` → body has `max_completion_tokens`, no `max_tokens`, no `temperature`.
  - `anthropicSendsMessagesRequest`: URL `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, top-level `system`, `redirect: 'error'`; JSON forced with a single tool `{name: "result", input_schema: {type: "object"}}` and `tool_choice: {type: "tool", name: "result"}`; returns the tool `input` object.
  - `anthropicMapsStatuses`: same mapping as `userKey: true` (Anthropic 529 → unavailable).
  - `anthropicRejectsNonJsonText`: response with only a text block → `AI_OUTPUT_INVALID`.
  - `keyNeverInErrorMessage`: for every error path, `String(error)` does not contain the key `sk-LEAKCHECK-1`.
- [ ] **Step 2:** `pnpm --dir services/ai-service test -- llm` → FAIL.
- [ ] **Step 3:** Implement. Rename the class and keep DeepSeek behaviour behind `userKey: false`; update `main.ts` to pass the DeepSeek values. Anthropic adapter reuses the same capped read and `isPlainObject` check.
- [ ] **Step 4:** `pnpm --dir services/ai-service test` and `build` → PASS.
- [ ] **Step 5:** Commit `feat(ai-service): OpenAI-compatible and Anthropic adapters`.

### Task 3: ai-service per-request provider selection

**Files:**
- Create: `services/ai-service/src/infrastructure/llm/provider-for.ts` + `provider-for.spec.ts`
- Modify: `services/ai-service/src/presentation/http/envelopes.ts`, `ai.controller.ts`, `src/config/ai-config.ts`, `src/ai-deps.ts`, `src/main.ts`, `.env.example`
- Test: `services/ai-service/test/ai.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 classes.
- Produces:
  ```ts
  type LlmSelection = { provider: 'OPENAI' | 'ANTHROPIC' | 'GEMINI'; apiKey: string; model?: string };
  function providerFor(llm: LlmSelection, defaults: ByokDefaults): LlmProvider
  interface ByokDefaults { openaiModel: string; anthropicModel: string; geminiModel: string; maxTokens: number; maxResponseBytes: number }
  // AiDeps gains: byok: ByokDefaults
  ```
  Env: `AI_OPENAI_DEFAULT_MODEL`, `AI_ANTHROPIC_DEFAULT_MODEL`, `AI_GEMINI_DEFAULT_MODEL` (code defaults chosen and checked against the live APIs in Task 8; placeholders in `.env.example`).

- [ ] **Step 1: Write the failing tests:**
  - envelopes: `llm` accepted on extract/classify/summarize/prompt; rejected on generate; `apiKey` > 512 chars, with `\n`, or `model` `"a b"` → parse failure; unknown `llm` key → failure (strict).
  - `providerFor`: OPENAI → `OpenAiCompatibleProvider` with OpenAI base URL and `userKey: true`; GEMINI → Gemini base URL; ANTHROPIC → `AnthropicProvider`; missing `model` → the default.
  - e2e: summarize with `llm` and fake fetch returns the result even when the default provider is `null` (DeepSeek not configured); without `llm` and `provider: null` → `AI_NOT_CONFIGURED` (unchanged).
  - e2e `byokFailureIsNotCachedAndKeyNotRetained`: first call 429 → `AI_PROVIDER_RATE_LIMITED`; retry with same `requestId` reaches fetch again; captured logger output contains no `sk-LEAKCHECK-1`.
- [ ] **Step 2:** `pnpm --dir services/ai-service test` and `test:e2e` → FAIL.
- [ ] **Step 3:** Envelope: shared `llm` zod strict object (provider enum, key 1..512 without control chars, optional model regex). Controller: keep authentication first; replace the early `if (!provider)` with, after parsing, `const selected = body.llm ? providerFor(body.llm, this.deps.byok) : provider; if (!selected) throw new AiError('AI_NOT_CONFIGURED')`; pass `selected` to the use case; add `llmProvider: body.llm?.provider ?? 'default'` to the existing log line (never the key). Confirm `RequestDedup` does not keep failures (add the fix if it does).
- [ ] **Step 4:** `test`, `test:e2e`, `build` → PASS.
- [ ] **Step 5:** Commit `feat(ai-service): per-request provider from llm selection`.

### Task 4: workspace-service AI connections

Paths below are under `services/workspace-service/src/main/java/com/weav/workspace/` unless they start with `src/test`.

**Files:**
- Modify: `domain/valueobject/ConnectionProvider.java`, `application/service/ConnectionProviderPolicy.java`, `application/service/CredentialPayloadCodec.java:148`, `application/dto/ResolvedConnectionCredential.java:41`, `infrastructure/config/WorkspaceApplicationConfig.java` (beans + `ConnectionProviderRegistry` args)
- Create: `infrastructure/provider/llm/LlmKeyConnectionProvider.java`
- Test: `src/test/java/com/weav/workspace/infrastructure/provider/llm/LlmKeyConnectionProviderTest.java`, `src/test/java/com/weav/workspace/application/service/AiCredentialTest.java`

**Interfaces:**
- Produces: enum values `OPENAI`, `ANTHROPIC`, `GEMINI`;
  ```java
  public final class LlmKeyConnectionProvider implements ConnectionProviderPort {
      public LlmKeyConnectionProvider(ConnectionProvider provider, URI modelsUrl,
              HttpTargetValidator targetValidator, PinnedHttpTransport transport)
  }
  ```
  Three beans: OpenAI `https://api.openai.com/v1/models` (`Authorization: Bearer`), Anthropic `https://api.anthropic.com/v1/models` (`x-api-key`, `anthropic-version: 2023-06-01`), Gemini `https://generativelanguage.googleapis.com/v1beta/openai/models` (`Authorization: Bearer`).

- [ ] **Step 1: Write the failing tests:**
  - `AiCredentialTest`: create each provider with `TOKEN` + `{token}` succeeds; `API_KEY`/`NONE` rejected; `rejectsKeyWithControlCharacters`; `ResolvedConnectionCredential` accepts `TOKEN` for the three.
  - `LlmKeyConnectionProviderTest` (fake transport, like `TelegramConnectionProviderTest`): 200 → ok; 401/403 → `authInvalid`; 408/429/500 → `dependencyFailure`; correct header per provider; `validateConfig` rejects non-empty config; key absent from any exception message.
- [ ] **Step 2:** `./mvnw -Dtest='AiCredentialTest,LlmKeyConnectionProviderTest' test` → FAIL.
- [ ] **Step 3:** Implement; header chosen by `provider` inside the class.
- [ ] **Step 4:** `./mvnw verify` → PASS (known env-only failures only).
- [ ] **Step 5:** Commit `feat(workspace): OpenAI, Anthropic and Gemini key connections`.

### Task 5: workflow-service executor, validation and error mapping

**Files:**
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java:52`
- Modify: `.../infrastructure/ai/AiNodeExecutor.java`, `AiClient.java` (`AI_CODES`, `errorFailure`), `AiClientConfiguration.java:34-51`
- Modify: `.../domain/definition/DefinitionValidator.java` (`validatePublishFieldValues`)
- Test: `.../infrastructure/ai/AiNodeExecutorTest.java`, `AiClientContractTest.java`, `.../domain/definition/DefinitionValidatorTest.java`

**Interfaces:**
- Consumes: Task 1 fields, Task 3 `llm` envelope, Task 4 provider names.
- Produces: `public AiNodeExecutor(String type, AiClient client, WorkspaceConnectionPort workspaceConnections)`; `AiClient.execute(context, operation, payload)` unchanged — the executor adds `"llm"` to `payload`, and `AiClient` uses `payload.containsKey("llm")` to pick the BYOK mapping.

- [ ] **Step 1: Write the failing tests:**
  - `withoutConnectionBodyIsUnchanged`: payload equals today's exact map for each type (regression).
  - `withConnectionSendsLlm`: resolved `OPENAI`/`TOKEN`/`{token}` + `model "gpt-x"` → payload `llm = {provider: "OPENAI", apiKey: <token>, model: "gpt-x"}`; `connection.close()` called.
  - `rejectsNonAiConnection`: resolved `DISCORD` → `CONNECTION_CONFIGURATION_INVALID`.
  - `invalidModelRejected`: `model "a b"` → `CONFIGURATION_ERROR`.
  - `AiClientContractTest`: with `llm` in payload, `AI_PROVIDER_AUTH` → `CONNECTION_AUTHENTICATION_REJECTED` (not retryable) and executor calls `reportAuthenticationRejected`; `AI_PROVIDER_RATE_LIMITED` → same code, retryable; `AI_MODEL_NOT_FOUND` → `CONFIGURATION_ERROR` with the model message. Without `llm`, `AI_PROVIDER_AUTH` still → `DEPENDENCY_NOT_CONFIGURED`.
  - `DefinitionValidatorTest.modelWithoutConnectionIsRejected`: AI node with `model` and no `connectionId` → issue on `config.model`, code `INVALID_FIELD_COMBINATION` (not `REQUIRED_FIELD_MISSING`, which would make the AI generator ask for a connection).
  - stored step input contains `connectionId` and never the token (assert on the step input the engine records, using an existing executor-engine test harness).
- [ ] **Step 2:** `./mvnw -Dtest='AiNodeExecutorTest,AiClientContractTest,DefinitionValidatorTest' test` → FAIL.
- [ ] **Step 3:** Implement; resolution and failure codes copied from `DiscordSendMessageNodeExecutor` (`resolveConnection`, `reportAuthenticationRejected`); add the three providers to `WorkspaceClient.PROVIDERS`; inject `WorkspaceConnectionPort` in the four beans.
- [ ] **Step 4:** `./mvnw verify` → PASS (known env-only failures only).
- [ ] **Step 5:** Commit `feat(workflow): AI steps can use a workspace AI connection`.

### Task 6: Web — connections page

**Files:**
- Create: `apps/web/src/lib/aiProviders.ts`
- Modify: `apps/web/src/api/connection.api.ts:7`, `apps/web/src/pages/ConnectionsPage.tsx` (labels ~72, short codes ~101, `TokenProvider` ~410, card list ~439, form ~470-500), `apps/web/src/components/connections/ConnectionGuide.tsx`, `apps/web/src/lib/i18n/translations.ts`
- Test: `apps/web/e2e/workspace-connections.spec.ts` (extend)

**Interfaces:**
- Produces (in `aiProviders.ts`): `export type AiProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI'`, `export const AI_PROVIDERS: readonly AiProvider[]`, `export const AI_PROVIDER_NAMES: Record<AiProvider, string>` ("ChatGPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)").

- [ ] **Step 1: Write the failing Playwright case** `adds a ChatGPT connection`: open Connections, pick "ChatGPT (OpenAI)", the field labelled "API key" is `type=password`, submit `  sk-test  ` → the stubbed POST body has `provider: "OPENAI"`, `authType: "TOKEN"`, credential token `"sk-test"`; a stubbed auth-invalid test result shows "Key không hợp lệ hoặc đã bị thu hồi".
- [ ] **Step 2:** run the spec → FAIL.
- [ ] **Step 3:** Add the three cards on the token form, guide topics (3 steps each; key pages `https://platform.openai.com/api-keys`, `https://console.anthropic.com/settings/keys`, `https://aistudio.google.com/apikey`), vi/en strings, trim the key.
- [ ] **Step 4:** spec PASS; `tsc`, `build` PASS.
- [ ] **Step 5:** Commit `feat(web): AI key connections`.

### Task 7: Web — AI step picker and friendly errors

**Files:**
- Create: `apps/web/src/components/builder/AiConnectionField.tsx`
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (AI inspectors ~2460-2500; `ai.generate` in `SCHEMA_FORMS` ~289 stays without `provider`), `apps/web/src/lib/executions/friendlyError.ts:13`, `apps/web/src/lib/i18n/translations.ts`
- Test: the existing unit test for `friendlyError` (create `friendlyError.test.ts` next to it if none), `apps/web/e2e/ai-provider-step.spec.ts` (create)

**Interfaces:**
- Consumes: `AI_PROVIDERS`, `AI_PROVIDER_NAMES` (Task 6).
- Produces: `AiConnectionField({ config, connections, onChange }: { config: Record<string, unknown>; connections: Connection[]; onChange: (patch: { connectionId?: string; model?: string }) => void })`.

- [ ] **Step 1: Write the failing tests:**
  - unit: `friendlyErrorKind('AI_PROVIDER_RATE_LIMITED') === 'limit'`; `friendlyErrorKind('CONNECTION_AUTHENTICATION_REJECTED') === 'connection'`.
  - Playwright (stubbed backend, one ACTIVE `OPENAI` connection "My OpenAI"): open an `ai.summarize` step → dropdown "AI dùng cho bước này" has "AI mặc định của Weav" first and "My OpenAI (ChatGPT)"; model field hidden; choose My OpenAI → Advanced shows "Tên model"; type a model, switch back to default → saved config has neither `connectionId` nor `model`. Same dropdown present on `ai.generate`, `ai.classify`, `ai.extract`. A step with no connection is not marked "not configured".
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement the component (only `ACTIVE` + `canAttach` connections whose provider is in `AI_PROVIDERS`), render it at the top of the four AI inspectors, add the code to the `LIMIT` regex, vi/en strings (including both new error codes).
- [ ] **Step 4:** unit + spec PASS; existing builder specs for AI nodes still pass (compare failures against `dev`); `tsc`, `build`, `pnpm --dir apps/web lint` PASS.
- [ ] **Step 5:** Commit `feat(web): choose the AI for each AI step`.

### Task 8: Live check, defaults, work log, merge

**Files:**
- Modify: `services/ai-service/src/config/ai-config.ts` (code defaults for the three models), `.env.example`
- Create: `docs/work_logs/T/ai/ai-provider-byok.md` (from `docs/work_logs/log_template.md`)

- [ ] **Step 1:** Ask the user for real keys (or which providers to skip). Start the dev stack with AI enabled (CLAUDE.md "AI Service"), Vite on `localhost:5173`.
- [ ] **Step 2:** For each available provider confirm the default model id works through the adapter (`summarize`, `classify`, `extract`, `prompt`); fix `tokenParam`/`sendTemperature` per provider if the API rejects them; set the code defaults.
- [ ] **Step 3:** In the Browser pane: create each connection, build "Manual → Summarize with AI", run → success; wrong key → run shows "Kết nối lại" and the connection is marked failing; wrong model → "Mở workflow". Check console and network for errors; screenshot as evidence.
- [ ] **Step 4:** Search the service logs of the run for the key prefix → no match.
- [ ] **Step 5:** Work log (decisions, files, commands with one-line results, evidence, skipped providers, risks; no secrets). `git diff --check`, `detect_changes --scope compare --base-ref dev`. Stop containers started for the check.
- [ ] **Step 6:** Commit `docs: AI provider BYO key live check`; after the user reviews, `git merge --no-ff feature/ai-provider-byok` into `dev` ("Merge branch 'feature/ai-provider-byok' into dev"). Report commits so the user can push.

Tasks 2–3 (ai-service) and Task 4 (workspace-service) touch disjoint files and can run in parallel after Task 1; Task 5 needs 1, 3 and 4; Tasks 6–7 need 1 (and 5 for the live run).
