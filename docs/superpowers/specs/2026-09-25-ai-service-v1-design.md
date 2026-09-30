# AI Service V1 Specification

**Status:** proposed implementation specification; implementation is not included in this document. Revised 2026-09-30 after plan review (see §10).

**Scope owner:** AI Service, Workflow Service, and the web builder's AI surfaces. API Gateway implementation, configuration, tests, CI, and documentation belong to the user's partner; the one Gateway change this feature needs is listed as a handoff in §9.

## 1. Goal

Build a stateless NestJS AI Service and integrate it with Workflow Service. V1 supports:

- natural-language workflow generation;
- `ai.extract` for unstructured text to flexible JSON;
- `ai.classify` for a bounded category result;
- `ai.summarize` for bounded Unicode-safe summaries.

`agent.task`, agent tool execution, RAG, embeddings, streaming, durable conversations, provider fallback, AI persistence, and mobile AI surfaces are deferred.

## 2. Architectural boundary

```text
Web builder
        |
        v
Public edge (partner-owned Gateway)
        |
        v
Workflow Service: auth, workspace checks, connection binding, intent compilation,
                  canonical WorkflowDefinition, persistence, execution
        |
        v
AI Service: interpretation and text processing
        |
        v
DeepSeek adapter
```

The AI Service never calls Workflow Service. Workflow owns the generation use case and calls AI through a private REST API using a Service JWT. AI returns a separate `WorkflowIntent`; it never creates or persists a canonical `WorkflowDefinition`. AI never receives connection IDs, connection metadata, or credentials.

Use pragmatic Clean Architecture consistent with the existing services:

```text
domain         pure models, policies, errors
application    use cases and ports
infrastructure HTTP provider, JWT, configuration, JSON/schema adapters
presentation   Nest/Fastify controllers, guards, parsing, health endpoints
```

Do not manufacture an interface for every class. Ports are required at the provider boundary (`LlmProvider`) and at Workflow's outbound AI boundary.

The Workflow → AI client follows the existing Workflow → OCR pattern (`OcrClient`, `WorkflowServiceJwtIssuer`, `OcrClientProperties`, `OcrNodeExecutor`). Service JWT key loading is shared, not duplicated.

## 3. AI operations

### Processing operations

Private routes use a closed envelope:

```json
{
  "requestId": "uuid",
  "workspaceId": "uuid",
  "operation": "extract",
  "text": "source text",
  "outputSchema": {
    "type": "object",
    "properties": {
      "person": {
        "type": "object",
        "properties": { "name": { "type": "string" } }
      },
      "items": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  },
  "instructions": "Extract only facts present in the text."
}
```

`extract` requires `text` and `outputSchema`; `instructions` is optional (at most 2,000 code points). The result is the validated object itself, with no wrapper. Properties the model returns that the schema does not declare are removed before validation succeeds, so downstream mappings see only declared fields.

**Output schema profile** (enforced identically by Workflow at save/publish time and by AI at request time; shared fixtures in `packages/contracts/http/ai/fixtures/output-schema-profile.json`):

- root is `{"type": "object", ...}`;
- allowed keywords: `type`, `properties`, `required`, `items`, `enum`, `description`, `additionalProperties` (boolean only);
- `type` is one of `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`, or an array of those (for nullable values);
- `$ref`, `$defs`, `default`, `const`, `examples`, `pattern`, `format`, and every other keyword are rejected. No references means no reference-depth limit;
- property names are 1–64 characters and never `__proto__`, `prototype`, or `constructor`;
- at most 32 KiB serialized, 256 schema objects, and nesting depth 8 (each schema level costs two JSON levels, which keeps a definition inside Workflow's 32-level JSON depth limit);
- `{{...}}` inside a schema is literal text; the schema is static metadata and is never mapping-resolved.

`classify` requires text and 2–50 unique categories, each 1–100 code points. The result is `{"category": "<one supplied category>", "confidence": <number 0..1>}`. Confidence is the model's self-report, not a calibrated probability.

`summarize` requires text and `maxLength` from 1 to 5,000 code points. The result is `{"summary": "...", "truncated": false}`. If the model exceeds `maxLength`, AI truncates at the last grapheme boundary (`Intl.Segmenter`) that fits within `maxLength` code points and sets `truncated: true`. It never cuts inside a Vietnamese combining sequence or a ZWJ emoji.

### Generation

Workflow sends:

```json
{
  "requestId": "uuid",
  "workspaceId": "uuid",
  "operation": "generate",
  "prompt": "When a webhook arrives, summarize the body and append it to a sheet",
  "timezone": "Asia/Ho_Chi_Minh",
  "capabilities": [
    { "type": "trigger.webhook", "configFields": [] },
    { "type": "ai.summarize", "configFields": ["inputText", "maxLength"] }
  ]
}
```

`timezone` is optional and comes from the user's browser. `capabilities` is derived by Workflow from `NodeCatalog` minus the types that `IntegrationReadiness` marks unavailable, and minus `connectionId` from every field list.

AI returns exactly one of:

```json
{ "status": "ready", "intent": { "...": "WorkflowIntent" } }
{ "status": "needs_input", "questions": [{ "code": "URL", "field": "fetch.config.url" }] }
{ "status": "unsupported", "reasons": [{ "code": "CAPABILITY_UNAVAILABLE" }] }
```

Question codes: `URL`, `SCHEDULE`, `TIMEZONE`, `VALUE`. Reason codes: `CAPABILITY_UNAVAILABLE`, `OUT_OF_SCOPE`, `AMBIGUOUS_REQUEST`. At most 10 questions and 5 reasons. AI never returns free-text questions or reasons; the web renders codes through i18n.

AI must ask for a missing URL, schedule, timezone (when the request has none), or required value. It must never guess a URL, timezone, credential, or provider.

### WorkflowIntent

```json
{
  "name": "Webhook summary to sheet",
  "nodes": [
    { "id": "start", "type": "trigger.webhook", "config": {} },
    { "id": "summary", "type": "ai.summarize",
      "config": { "inputText": "{{trigger.input.body}}", "maxLength": 300 } },
    { "id": "append", "type": "google.sheets",
      "config": { "operation": "append", "spreadsheetId": "abc", "range": "A1",
                  "values": [["{{nodes.summary.output.summary}}"]] } }
  ],
  "edges": [
    { "from": "start", "to": "summary" },
    { "from": "summary", "to": "append" }
  ]
}
```

- `name`: 1–120 code points.
- `nodes`: 2–20 entries. `id` matches `^[a-z][a-z0-9_]{0,31}$` and is unique. `type` must be one of the supplied capabilities. `config` keys must be in that capability's `configFields`.
- `edges`: 1–40 entries; `port` is optional and only `"true"` or `"false"`.
- Mapping references use the existing Workflow grammar unchanged: `{{trigger.input.<path>}}`, `{{variables.<path>}}`, `{{nodes.<id>.output.<path>}}`.
- `connectionId` never appears in an intent. An intent containing it is rejected.

Workflow compiles an intent by mapping it 1:1 to `WorkflowDefinition` (intent node id = definition node id), binding connections (§6), and running the existing `DefinitionValidator.validatePublish`. That validator already checks node types, config fields, required fields, ports, cycles, and upstream-only references. The compiler adds no second graph validator.

## 4. HTTP and security contract

AI is synchronous REST/JSON:

| Route | Operation | Scope claim |
| --- | --- | --- |
| `POST /v1/extract` | `extract` | `ai:extract` |
| `POST /v1/classify` | `classify` | `ai:classify` |
| `POST /v1/summarize` | `summarize` | `ai:summarize` |
| `POST /v1/generate` | `generate` | `ai:generate` |
| `GET /health/live`, `GET /health/ready` | — | none |

Success response: `{"requestId": "<uuid>", "result": {...}}`.

Every private request requires exactly one `Authorization: Bearer` Service JWT and a UUID `X-Request-ID`. The Service JWT is RS256 with a `kid`, verified against a local JWKS file (`AI_SERVICE_JWKS_FILE`). Required claims:

| Claim | Rule |
| --- | --- |
| `iss` | `weav-workflow` |
| `aud` | `weav-ai` |
| `scope` | exactly the route's scope |
| `workspace_id` | equals body `workspaceId` |
| `request_id` | equals the `X-Request-ID` header and body `requestId` |
| `mode` | `execution` or `generation`; `generation` only for `/v1/generate` |
| `execution_id`, `node_execution_id` | present when `mode=execution` |
| `iat`, `exp` | lifetime at most 120 seconds; 30 seconds clock skew |

Workflow creates a fresh private request UUID for every AI call and attempt, and keeps any public correlation ID separate.

Before provider invocation, AI rejects:
- unsupported media types;
- unknown envelope fields (strict schemas);
- prototype keys (`__proto__`, `prototype`, `constructor`) at any depth;
- malformed JSON;
- invalid UTF-8 (fatal decoding);
- JSON nesting deeper than 64;
- bodies over the size limit.

Duplicate-key detection is not implemented on the AI ingress in V1. The only caller is authenticated Workflow, which serializes the body itself. Workflow's public `/generate` route rejects duplicate keys with Jackson `STRICT_DUPLICATE_DETECTION`.

Never log user JWTs, cookies, credentials, arbitrary headers, prompts, documents, schema content, provider bodies, or model reasoning. Logs carry request ID, operation, workspace ID, duration, outcome code, and provider latency only.

AI errors use a closed code set with server-rendered safe messages: `{"error": {"code": "...", "message": "...", "requestId": "..."}}`.

| Code | HTTP | Workflow retries |
| --- | ---: | :---: |
| `INVALID_REQUEST` | 400 | no |
| `UNAUTHENTICATED` | 401 | no |
| `FORBIDDEN` | 403 | no |
| `PAYLOAD_TOO_LARGE` | 413 | no |
| `AI_SCHEMA_INVALID` | 422 | no |
| `AI_BUSY` | 429 | yes |
| `AI_NOT_CONFIGURED` | 503 | no |
| `AI_PROVIDER_UNAVAILABLE` | 503 | yes |
| `AI_PROVIDER_AUTH` | 502 | no |
| `AI_OUTPUT_INVALID` | 502 | no |
| `AI_TIMEOUT` | 504 | yes |
| `INTERNAL_ERROR` | 500 | no |

AI never retries the provider. Workflow decides retryability from the **AI error code**, never from the HTTP status: `AI_BUSY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, plus Workflow's own transport `TIMEOUT` and `NETWORK_ERROR`. A missing or unrecognized error envelope is non-retryable (`AI_RESPONSE_INVALID`).

## 5. Limits and configuration

Initial configurable limits:

| Resource | Default |
| --- | ---: |
| AI total request deadline | 60 seconds |
| Workflow AI call read timeout | 65 seconds |
| Workflow generation (AI call + Workspace checks) | bounded by the 65 s AI read timeout |
| AI request body | 256 KiB |
| Workflow generation request body | 32 KiB |
| Generation prompt | 4,000 code points |
| Processing text | 50,000 code points |
| Extraction schema | 32 KiB, 256 schema objects, depth 8 |
| Provider wire response | 1 MiB |
| Provider `max_tokens` | 4,096 |
| AI output envelope | 256 KiB |
| AI admission | 4 calls/replica, 2/workspace/replica, no queue |
| Generation rate | 5/minute per (user, workspace) per Workflow replica |

AI starts the deadline in a Fastify `onRequest` hook before body parsing. An `AbortSignal` combining the deadline and client disconnect is passed through validation and provider `fetch`. Admission is released exactly once in a `finally`. Limits are local per replica; no distributed quota is promised in V1.

Workflow node execution is safe beyond the 60-second worker lease: `ExecutionRunner` renews the lease on an independent scheduled heartbeat (15 s) while the node thread blocks. Worst-case AI node wall time is 3 × 65 s + 3 s backoff ≈ 198 s.

AI configuration:
- `AI_PROVIDER=deepseek`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL` (required, no default)
- `DEEPSEEK_BASE_URL`
- `AI_SERVICE_JWKS_FILE`
- `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_CONCURRENCY`, `AI_MAX_CONCURRENCY_PER_WORKSPACE`

Readiness is `503` until the key, model, and JWKS file are present and parse.

Workflow configuration:
- `WORKFLOW_AI_ENABLED` (default `false`)
- `WORKFLOW_AI_GENERATION_ENABLED` (default `false`)
- `AI_SERVICE_PRIVATE_URL`
- `WORKFLOW_AI_SIGNING_KEY_ID`, `WORKFLOW_AI_SIGNING_KEY_LOCATION` (may reference the same key file as OCR)
- `WORKFLOW_AI_READ_TIMEOUT` (65 s; no separate generation timeout — the AI read timeout bounds generation, and the Gateway allows at least 80 s)

`.env.example` contains placeholders only.

DeepSeek is accessed behind the `LlmProvider` port using native `fetch` against the OpenAI-compatible `POST {DEEPSEEK_BASE_URL}/chat/completions`:
- `response_format: {"type": "json_object"}`;
- no tools, no streaming, no SDK, and no retries;
- system prompts always contain the word "json", as JSON mode requires.

Accepted completions have `finish_reason = "stop"` and content that parses as one JSON object. `length`, `content_filter`, empty content, code fences, and malformed JSON map to `AI_OUTPUT_INVALID`. Model identifiers are deployment configuration and are not invented in examples.

## 6. Workflow integration

Workflow adds:

- a shared Service JWT signer extracted from `WorkflowServiceJwtIssuer` (OCR behavior unchanged);
- `AiClient` with typed response/error validation, modeled on `OcrClient`;
- executors for `ai.extract`, `ai.classify`, `ai.summarize`, which move these types out of `UnavailableNodeExecutor`. With `WORKFLOW_AI_ENABLED=false` they fail closed with `DEPENDENCY_NOT_CONFIGURED`, as OCR does;
- `outputSchema` as a static `ai.extract` config field;
- `IntentCompiler`;
- `POST /workspaces/{workspaceId}/workflows/generate`.

Node config → AI request mapping:

| Node | Config fields | AI request | Node output |
| --- | --- | --- | --- |
| `ai.extract` | `text`, `outputSchema`, `instructions`, legacy `schemaDescription` | `text`, `outputSchema`, `instructions` | the extracted object |
| `ai.classify` | `content`, `categories` | `text`, `categories` | `{category, confidence}` |
| `ai.summarize` | `inputText`, `maxLength` | `text`, `maxLength` | `{summary, truncated}` |

**Static schema metadata.** `NodeCatalog.staticFields("ai.extract") = {"outputSchema"}`. Static fields are:
- excluded from mapping validation and runtime mapping resolution (copied verbatim);
- excluded from credential key-name scanning, because property names such as `token` are legitimate schema fields;
- validated against the output schema profile instead. That profile rejects `default`, `const`, and `examples`, so no free-form value slot exists in which to smuggle a secret.

All other fields keep ordinary credential scanning.

Existing definitions stay readable, editable, and publishable. Legacy `schemaDescription` is preserved. Executing `ai.extract` without `outputSchema` fails non-retryably with `CONFIGURATION_ERROR` and the message "Add an output schema to this extract node." No automatic data migration is performed. Array indexing in mappings is outside V1.

### Generation endpoint

`POST /workspaces/{workspaceId}/workflows/generate` (user JWT, `WORKFLOW_CREATE`):

```json
{
  "prompt": "string, 1-4000 code points",
  "timezone": "IANA zone, optional",
  "connections": { "google.sheets": "uuid", "email.send": "uuid" }
}
```

`connections` maps a node type to a connection the user picked in the builder. Workflow calls the existing `WorkspaceConnectionPort.authorizeAttachment(workspaceId, connectionId, actorId)` for each entry before calling AI. No new Workspace endpoint is needed, and AI never sees connections. After compilation, Workflow sets `config.connectionId` on every node whose type has an entry. If `validatePublish` then reports `REQUIRED_FIELD_MISSING` on `config.connectionId`, the response asks for that connection.

Response `200`:

```json
{ "status": "ready", "name": "...", "definition": { "...": "WorkflowDefinition" },
  "layout": { "start": { "x": 100, "y": 100 } } }
{ "status": "needs_input", "questions": [{ "code": "CONNECTION", "field": "google.sheets" }] }
{ "status": "unsupported", "reasons": [{ "code": "INVALID_INTENT" }] }
```

- Workflow adds the question code `CONNECTION` and the reason code `INVALID_INTENT` to AI's sets.
- A compiled intent that fails `validatePublish` for any reason other than a missing connection becomes `unsupported`/`INVALID_INTENT`. Validator messages are not echoed.
- `layout` is a deterministic column layout: x = 100 + 300 × topological depth, y = 100 + 150 × index within that depth.
- Generation never saves, publishes, or runs a workflow.

Errors use the existing `ApiErrorResponse`:
- `400` malformed/duplicate keys/invalid fields;
- `403` missing `WORKFLOW_CREATE` or connection not attachable;
- `413` over 32 KiB;
- `429 GENERATION_RATE_LIMITED`;
- `503 AI_UNAVAILABLE` when the flag is off or AI returns a non-retryable dependency error;
- `504 AI_TIMEOUT`.

### Web builder

- `ai.extract` inspector: a JSON editor for `outputSchema`, validated client-side for parseability, an object root, and the 32 KiB limit. Server validation is authoritative. The legacy `schemaDescription` field is shown read-only when present.
- `nodeReadiness`: AI nodes are `ready` when configured, with no longer a blanket `unavailable`. `ai.extract` without `outputSchema` is `not-configured`.
- "Generate with AI" panel: prompt, optional connection pickers for connection-requiring node types, and the browser timezone. It renders `needs_input` codes via i18n and loads a `ready` result into the canvas as an unsaved draft.

## 7. Acceptance criteria

1. The four AI operations reject invalid envelopes, unknown fields, prototype keys, invalid UTF-8, oversized input, and invalid output before success.
2. The shared output-schema-profile fixtures pass identically in the TypeScript and Java test suites.
3. Classification labels stay within the supplied set; summaries respect code-point limits and never split a grapheme.
4. Wrong tenant, issuer, audience, scope, mode, expiry, or request binding never reaches the provider.
5. Cancellation, timeout, oversized provider output, and admission overflow release admission exactly once.
6. Identical intents compile to identical definitions and layouts. Cycles, unsafe references, unknown types, `connectionId` in an intent, and missing facts return no definition.
7. Legacy extraction definitions stay readable, editable, and publishable; execution without `outputSchema` fails with `CONFIGURATION_ERROR`.
8. AI node outputs reach downstream Workflow nodes. Only `AI_BUSY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, and transport timeout/network errors retry.
9. The authenticated local Workflow → AI → provider-fixture path passes success, clarification, unauthorized, invalid-output, timeout, and cancellation cases.
10. AI unit/e2e tests, typecheck, lint, and build pass; Workflow `mvnw verify` passes; the web builder AI flows pass Playwright against the running stack; `docker compose config` validates; `git diff --check` is clean.

## 8. Deferred from V1

- CI pipelines: the repository has none yet; adding the first one is a separate decision.
- Duplicate-key detection on the AI ingress (§4).
- JSON Schema `$ref`/`$defs` in extraction schemas.
- Mobile AI surfaces (the mobile app keeps its mocks).
- Distributed rate limits and quotas.

## 9. Partner handoff (Gateway)

One Gateway change is needed for the web generate flow. It is not part of these acceptance criteria except for the Playwright generate case:

- Route `POST /api/v1/workspaces/:workspaceId/workflows/generate` → Workflow `POST /workspaces/{workspaceId}/workflows/generate`, forwarding the user JWT like the other workflow routes. Allow a 32 KiB body and an upstream timeout of at least 80 seconds.
- Keep the AI Service off the public edge. The Gateway's `AI_SERVICE_URL` upstream must not route public traffic to `/v1/*` on AI.

## 10. Revision notes (2026-09-30)

- Connection metadata: Workspace has no metadata-list endpoint. Generation now uses user-picked connection IDs plus the existing `authorizeAttachment`, and AI never sees connections.
- `WorkflowIntent`, the generate request/response, Service JWT claims, request binding, error-to-HTTP mapping, and retry rules are now specified.
- The extraction schema profile drops `$ref` and rejects value-carrying keywords, closing the credential-smuggling gap.
- Summaries truncate at grapheme boundaries instead of failing.
- Web builder scope added; CI and AI-ingress duplicate-key detection deferred.
