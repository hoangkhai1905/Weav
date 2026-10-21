# AI nodes: choose a provider with your own API key (design)

Date: 2026-10-20. Owner: T. Status: approved in chat section by section, spec under review. Branch: `feature/ai-provider-byok` from `dev`.

## 1. Goal

A workspace member can run the existing AI steps (summarize, classify, extract, prompt) on ChatGPT (OpenAI), Claude (Anthropic) or Gemini (Google) with their own API key, picked from a dropdown, without knowing anything about models or endpoints. Steps that pick nothing keep using the Weav default AI (DeepSeek, server key from `.env`) exactly as today.

Purpose (agreed): thesis demo plus a clean extension point for more providers. Not a full production BYO-key product.

Success test: the same "Manual → Summarize with AI" workflow runs once per provider with a real key and returns a schema-valid result; a wrong key shows "Reconnect" on the run, a wrong model name shows "Open workflow".

## 2. Scope

In:

- Three new connection providers: `OPENAI`, `ANTHROPIC`, `GEMINI` (auth type `TOKEN`), key checked when the connection is saved.
- Optional `connectionId` and `model` on `ai.summarize`, `ai.classify`, `ai.extract`, `ai.generate` (prompt).
- Per-request provider selection in ai-service; one default model per provider, overridable in the step's "Advanced" section.
- Friendly errors for bad key, rate limit/out of credit, unknown model.

Out (YAGNI): the AI Assistant chat and workflow generation (`/v1/generate`) stay on DeepSeek; no model list fetched from providers; no quota or cost tracking; no DeepSeek BYO key; mobile is not changed (its run views already group error codes).

Constraints: every contract change is additive; requests without the new fields behave byte-for-byte as before. Service boundaries unchanged: workspace-service owns credentials, workflow-service resolves them, ai-service owns prompts and provider calls.

## 3. Current state (`dev` @ `0ffc7247`)

- Node schemas `packages/workflow-schema/nodes/ai.*.json` have no `connectionId`. Connection pickers use `x-weav-connection: { "provider": "<ONE>" }` (e.g. `discord.send_message.json`); advanced fields use `x-weav-ui: { "advanced": true }`. workflow-service loads schemas through `ClasspathNodeSchemaSource`, which refuses unknown keywords and reads `x-weav-connection.provider` as a required string (line ~118) into `NodeConfigSchema.Property.connectionProvider`; that value is only used as a "this is a connection field" flag (`connectionFields()`), the provider itself is checked by each executor at run time; the web bundles them in `apps/web/src/lib/nodeSchemas.ts` (`'x-weav-connection'?: { provider: string }`).
- workflow-service: `infrastructure/ai/AiNodeExecutor.java` builds the payload and calls `AiClient.execute`, which POSTs to ai-service `/v1/{operation}` with a service JWT (scope `ai:<op>`). `AiClient.errorFailure` maps `AI_PROVIDER_AUTH` to `DEPENDENCY_NOT_CONFIGURED` (it meant the server key). Connection resolution pattern: `DiscordSendMessageNodeExecutor` → `WorkspaceConnectionPort.resolve(workspaceId, connectionId)` → `ResolvedConnection` (`close()` after use), failures `CONNECTION_FORBIDDEN` / `CONNECTION_UNAVAILABLE` / `CONNECTION_CONFIGURATION_INVALID`, `reportAuthenticationRejected` on 401.
- workspace-service: `ConnectionProvider` enum, `ConnectionProviderPolicy` (allowed auth types), `CredentialPayloadCodec.validateShape` (`TOKEN_FIELDS = {token}`), `ResolvedConnectionCredential`, key checks per provider under `infrastructure/provider/*` (`TelegramConnectionProvider.test()`: 401/404 → `authInvalid`, 408/429/5xx → `dependencyFailure`).
- ai-service: `LlmProvider.completeJson(request, signal)`; `AiDeps.provider` is one `DeepSeekProvider` (OpenAI-style `chat/completions`, `response_format: json_object`, `redirect: 'error'`) wrapped in a circuit breaker; `presentation/http/envelopes.ts` (zod strict objects); error codes in `domain/errors.ts` (already has `AI_PROVIDER_AUTH`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `AI_OUTPUT_INVALID`).
- web: connection picker filtering with `connection.provider === provider` at `WorkflowBuilderPage.tsx:~2146` and `AiGeneratorPage.tsx:~186`; token form in `ConnectionsPage.tsx` (`TokenProvider`); help in `ConnectionGuide.tsx`; error grouping in `lib/executions/friendlyError.ts`.

## 4. Architecture and data flow

1. The user adds a "ChatGPT (OpenAI)", "Claude (Anthropic)" or "Gemini (Google)" connection and pastes an API key. workspace-service encrypts it (existing mechanism) and checks it with one cheap call (`GET` models list).
2. In an AI step, "AI for this step" offers "Weav default AI" (empty) or an active AI connection. Advanced → "Model name" (optional, only when a connection is chosen).
3. At run time `AiNodeExecutor`, when `connectionId` is set, resolves the connection like the Discord executor and adds `llm: { provider, apiKey, model? }` to the ai-service request body.
4. ai-service builds a provider adapter for that request when `llm` is present, otherwise uses the default DeepSeek provider. Prompts, JSON output validation, `Admission` (per-workspace concurrency), `RequestDedup` and timeouts are shared by all providers.

| Area | Change |
| --- | --- |
| contracts / schema | `connectionId` + `model` on the four `ai.*` nodes; `x-weav-connection.provider` may be a string or an array; optional `llm` in four ai-service envelopes. |
| workspace-service | `OPENAI`, `ANTHROPIC`, `GEMINI` in the enum, policy allows `TOKEN`, codec uses `TOKEN_FIELDS`, one key-check class per provider. |
| workflow-service | `WorkspaceClient.PROVIDERS` allow-list gains the three providers; `AiNodeExecutor` gets `WorkspaceConnectionPort` and checks the provider; `ClasspathNodeSchemaSource` accepts the array form; `DefinitionValidator` rejects `model` without `connectionId`; error mapping when `llm` was sent. |
| ai-service | `DeepSeekProvider` generalized to `OpenAiCompatibleProvider`; new `AnthropicProvider`; `providerFor(llm)`; two new error codes. |
| web | three connection cards + guides, `AiConnectionField` ("AI for this step" dropdown + model field) in the four AI inspectors, i18n, friendlyError. |

## 5. Contracts

### 5.1 Connections (workspace-service)

Providers `OPENAI`, `ANTHROPIC`, `GEMINI`; auth type `TOKEN`; credential `{ "token": "<api key>" }`. `TOKEN` (not a new `API_KEY` shape) reuses `TOKEN_FIELDS`, `ResolvedConnectionCredential` and the encryption path; the UI labels the field "API key". Key length 1..512, no control characters.

### 5.2 Node schemas

Added to `ai.summarize`, `ai.classify`, `ai.extract`, `ai.generate`:

```json
"connectionId": {
  "type": "string", "minLength": 1,
  "title": "AI for this step",
  "x-weav-connection": { "provider": ["OPENAI", "ANTHROPIC", "GEMINI"] }
},
"model": {
  "type": "string", "minLength": 1, "maxLength": 100,
  "title": "Model name",
  "x-weav-ui": { "advanced": true }
}
```

Both optional. The node-schema loader does not support `pattern`, so the character rule `^[A-Za-z0-9._:/-]{1,100}$` is enforced by `AiNodeExecutor` (`CONFIGURATION_ERROR`) and by the ai-service envelope; `definition.schema.json` may carry the `pattern`. `model` without `connectionId` is a validation error (the Weav default model is server-controlled). The same fields go into `packages/contracts/http/workflow/definition.schema.json`. `x-weav-connection.provider` accepts a string (all existing nodes) or a non-empty array of non-blank strings. workflow-service: only `ClasspathNodeSchemaSource` changes (accept the array; keep a non-null marker for `connectionFields()`); `AiNodeExecutor` checks at run time that the resolved connection's provider is one of the three. The web must accept both forms (section 9).

### 5.3 ai-service request

Optional on `/v1/extract`, `/v1/classify`, `/v1/summarize`, `/v1/prompt` (strict object):

```json
"llm": {
  "provider": "OPENAI | ANTHROPIC | GEMINI",
  "apiKey": "1..512 chars, no control characters",
  "model": "optional, ^[A-Za-z0-9._:/-]{1,100}$"
}
```

`/v1/generate` rejects `llm` (`INVALID_REQUEST`). Without `model`, ai-service uses a per-provider default from env (`AI_OPENAI_DEFAULT_MODEL`, `AI_ANTHROPIC_DEFAULT_MODEL`, `AI_GEMINI_DEFAULT_MODEL`, with code defaults); exact model ids are chosen and verified against the live APIs during implementation, not fixed in the contract. Update `packages/contracts/http/ai/openapi.yaml` and add an example.

## 6. Error mapping

The workflow-service mapping below applies only when the request carried `llm`; without it `AiClient` keeps its current mapping.

| Provider response | ai-service code | Step failure (workflow-service) | Web kind (`friendlyError`) |
| --- | --- | --- | --- |
| 401 / 403 | `AI_PROVIDER_AUTH` (existing) | `CONNECTION_AUTHENTICATION_REJECTED`, not retryable; calls `reportAuthenticationRejected` | connection → "Reconnect" |
| 429 (rate limit or no credit) | `AI_PROVIDER_RATE_LIMITED` (new, 429) | `AI_PROVIDER_RATE_LIMITED`, retryable under the existing policy | limit (add to `LIMIT` regex) |
| 404, or 400 for an unknown model | `AI_MODEL_NOT_FOUND` (new, 400) | `CONFIGURATION_ERROR`, "The model "…" was not found at this provider." | config → "Open workflow" |
| 5xx, network | `AI_PROVIDER_UNAVAILABLE` (existing) | unchanged, retryable | temporary |
| timeout | `AI_TIMEOUT` (existing) | unchanged | temporary |
| non-JSON / wrong shape | `AI_OUTPUT_INVALID` (existing) | unchanged | data |

Connection resolution failures reuse the Discord codes. Both new codes are added to `AI_CODES` in `AiClient`. The DeepSeek default path keeps mapping its own 429 to `AI_PROVIDER_UNAVAILABLE` (unchanged).

Connection key check (workspace-service): 2xx → valid; 401/403 → `authInvalid`; 408/429/5xx → `dependencyFailure`.

## 7. Provider adapters (ai-service)

| Provider | Adapter | Base URL (fixed in code) |
| --- | --- | --- |
| DeepSeek (default) | `OpenAiCompatibleProvider` (today's `DeepSeekProvider`, renamed and parameterized) | existing env |
| OpenAI | `OpenAiCompatibleProvider` | `https://api.openai.com/v1` |
| Gemini | `OpenAiCompatibleProvider` (Gemini's OpenAI-compatible endpoint) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Anthropic | new `AnthropicProvider`: `POST /v1/messages`, top-level `system`, `x-api-key` + `anthropic-version` headers, JSON forced via structured output or a single tool, result still through `parseStrictJson` | `https://api.anthropic.com` |

- `OpenAiCompatibleProvider` takes a small per-provider option for the token-limit parameter (`max_tokens` vs `max_completion_tokens`) and whether `temperature` is sent, because some newer OpenAI models reject `max_tokens`/`temperature: 0`. Verify with each default model before fixing the option.
- Base URLs are constants, never user input (no SSRF surface); `redirect: 'error'` and the response size cap stay.
- `providerFor(llm)` builds a fresh adapter per request and does not use the circuit breaker: a bad key in one workspace must not trip AI for everyone. `Admission` and the request timeout still apply.
- The renamed provider keeps DeepSeek behaviour identical (existing DeepSeek tests must pass unchanged apart from the class name).

## 8. Security

- Key encrypted at rest in workspace-service; plaintext only between `resolve` and `ResolvedConnection.close()` in workflow-service, and inside one ai-service request.
- The key never appears in logs (any service), error messages, stored step input/output, or the ai-service dedup entry (keyed by `workspaceId:requestId`, result only). Logs carry `provider`, `connectionId` and status code only.
- workflow-service records the step input with `connectionId`, never `llm.apiKey`.
- Leak test: a sentinel key (`sk-LEAKCHECK-…`) is pushed through the flow in tests; assertions check logs and persisted step data do not contain it.
- Authorization unchanged: `resolve` enforces that the connection belongs to the run's workspace.

## 9. Web UI

- Connections page: cards "ChatGPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)" on the existing token form (password-type field labelled "API key"); `ConnectionGuide` topics with three "where to get the key" steps and a link to each provider's key page; invalid key → "The key is invalid or was revoked."
- Builder: "AI for this step" dropdown, first option "Weav default AI" (empty value), then active AI connections labelled with the provider name. Advanced → "Model name", placeholder = the provider's default model, hidden when the default AI is selected.
- The builder does not filter connections from `x-weav-connection`: `SCHEMA_FORMS` carries its own single `provider` and marks a missing connection as "not configured", and `ai.extract/classify/summarize` use hand-written inspector blocks. So the AI picker is one new component, `AiConnectionField`, filtering active `OPENAI | ANTHROPIC | GEMINI` connections, used in all four AI inspectors; `ai.generate` stays in `SCHEMA_FORMS` without a `provider` (an optional connection must not mark the step "not configured"). `nodeSchemas.ts` type becomes `provider: string | string[]`, and `AiGeneratorPage`'s provider display joins an array. The AI generator only asks for connections on `REQUIRED_FIELD_MISSING`, so the optional field adds no question.
- vi/en i18n for every new label and both new error codes; `AI_PROVIDER_RATE_LIMITED` added to the `LIMIT` regex.

## 10. Testing

| Area | Tests | Command |
| --- | --- | --- |
| ai-service | envelope: no `llm` unchanged, malformed `llm` → `INVALID_REQUEST`, `llm` on generate rejected; adapters with a fake `fetch` (URL, headers, body; 401/403, 429, 404/400 model, 5xx, timeout); key leak; controller e2e with `llm` | `pnpm --dir services/ai-service test`, `test:e2e`, `build` |
| workspace-service | create the three providers with `TOKEN`, other auth types rejected; key-check classes against a fake HTTP server (200/401/429/5xx); existing connections unaffected | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` |
| workflow-service | executor without `connectionId` sends the exact current body (regression); with it, body has `llm`; auth mapping + `reportAuthenticationRejected`; `model` without `connectionId` rejected; array `x-weav-connection` loads and validates; stored input has no key | same |
| contracts | updated schemas and example; consumers' contract tests pass | consumers' tests |
| web | unit: `friendlyErrorKind('AI_PROVIDER_RATE_LIMITED') === 'limit'`; Playwright (stubbed backend): add an OpenAI connection, pick it in an AI step, model field shows/hides | `tsc -p tsconfig.app.json`, `build`, Playwright chromium |

Live check on the dev stack (thesis evidence): "Manual → Summarize with AI" run once per provider with a real key the user provides (a provider without a key is reported as skipped); wrong key → run shows "Reconnect" and the connection is marked failing; wrong model → "Open workflow". The real-key test runs only with `AI_BYOK_E2E=1`, so CI needs no keys.

## 11. Delivery order

One branch `feature/ai-provider-byok` from `dev`, one commit per step:

1. contracts: node schemas, ai envelope, openapi + example.
2. ai-service: `OpenAiCompatibleProvider`, `AnthropicProvider`, `providerFor`, new error codes.
3. workspace-service: enum, policy, codec, three key-check classes.
4. workflow-service: schema loader array form, `model`-needs-`connectionId` rule, executor (provider check + `llm`), error mapping.
5. web: connections, picker helper, model field, i18n, friendlyError.
6. Live check, work log `docs/work_logs/T/ai/ai-provider-byok.md`, GitNexus `detect_changes`, `git merge --no-ff` into `dev` after review.

Steps 2 and 3 are independent and can run in parallel lanes.

## 12. Acceptance criteria

- AI steps without a connection behave exactly as today (regression tests pass).
- With a valid key, each provider runs all four AI node types and returns schema-valid output.
- Bad key, rate limit/no credit, and unknown model each show a friendly message with the right action button.
- The key never appears in logs, stored step input/output, or error messages.

## 13. Risks

- Provider parameter drift (newer OpenAI models, Gemini compatibility layer limits on `response_format`): mitigated by the per-provider option and live verification of each default model.
- Anthropic JSON reliability: structured output/tool forcing plus the existing strict parse; `AI_OUTPUT_INVALID` if it still fails.
- Array-valued `x-weav-connection` touches the workflow-service schema loader and two web call sites (plus any other reader of the hint found by GitNexus impact at implementation time, e.g. template sharing or AI generation capabilities); covered by tests on both sides.
- A connection of the wrong provider attached to an AI step is only caught at run time (`CONNECTION_CONFIGURATION_INVALID`), as for every other node today.
- Live check depends on the user supplying keys; missing providers are reported, not faked.
