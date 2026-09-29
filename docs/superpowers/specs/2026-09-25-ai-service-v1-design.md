# AI Service V1 Specification

**Status:** proposed implementation specification; implementation is not included in this document.

**Scope owner:** AI Service and Workflow Service. API Gateway implementation, configuration, tests, CI, and documentation belong to the user's partner and are excluded from this plan.

## 1. Goal

Build a stateless NestJS AI Service and integrate it with Workflow Service. V1 supports:

- natural-language workflow generation;
- `ai.extract` for unstructured text to flexible JSON;
- `ai.classify` for a bounded category result;
- `ai.summarize` for bounded Unicode-safe summaries.

`agent.task`, agent tool execution, RAG, embeddings, streaming, durable conversations, provider fallback, and AI persistence are deferred.

## 2. Architectural boundary

```text
Public edge (partner-owned Gateway)
        |
        v
Workflow Service: auth, workspace checks, intent compilation,
                  canonical WorkflowDefinition, persistence, execution
        |
        v
AI Service: interpretation and text processing
        |
        v
DeepSeek adapter
```

The AI Service never calls Workflow Service. Workflow owns the generation use case and calls AI through a private REST API using a Service JWT. AI returns a separate `WorkflowIntent`; it never creates or persists a canonical `WorkflowDefinition`.

Use pragmatic Clean Architecture consistent with the existing services:

```text
domain       pure models, policies, errors
application  use cases and ports
infrastructure HTTP provider, JWT, configuration, JSON/schema adapters
presentation Nest/Fastify controllers, guards, parsing, health endpoints
```

Do not manufacture an interface for every class. Ports are required at provider, JWT, clock/deadline, and outbound Workflow boundaries.

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

`extract` requires `text` and `outputSchema`; `instructions` is optional. The root schema is an object and may contain nested objects, arrays, optional fields, enums, nullable values, and string/number/boolean values. The result is the validated object itself, with no invoice-specific wrapper.

`classify` requires text and a non-empty finite category list. The result contains exactly one supplied category and a bounded confidence value. `summarize` requires text and a maximum length measured in Unicode code points, including emoji and Vietnamese characters.

### Generation

Workflow sends natural language plus authorized capability and connection metadata. AI returns one of:

```json
{ "status": "ready", "intent": { "steps": [] } }
{ "status": "needs_input", "questions": [{ "code": "CONNECTION", "field": "connection" }] }
{ "status": "unsupported", "reasons": [{ "code": "CAPABILITY_UNAVAILABLE" }] }
```

AI must ask for missing connection, URL, schedule timezone, or other required facts. It must never return an incomplete draft or guess a connection, timezone, credential, URL, or provider. Workflow compiles and validates a `ready` intent deterministically and returns no partial definition on failure.

## 4. HTTP and security contract

AI is synchronous REST/JSON. Every private request requires exactly one Service JWT and a UUID `X-Request-ID`. The token must bind issuer, audience, operation, workspace, and caller service. Workflow creates a fresh private UUID for every AI call/attempt and keeps any public correlation ID separate.

Reject unsupported media types, unknown envelope fields, duplicate keys, prototype keys (`__proto__`, `prototype`, `constructor`), malformed JSON, invalid UTF-8, invalid numbers, excessive nesting, and oversized bodies before provider invocation. Never forward user JWTs, cookies, credentials, arbitrary headers, prompts, documents, schema content, provider bodies, or model reasoning to logs.

AI errors use a closed code set and server-rendered safe messages. Examples: `INVALID_REQUEST`, `AI_NOT_CONFIGURED`, `AI_BUSY`, `AI_TIMEOUT`, `AI_PROVIDER_AUTH`, `AI_PROVIDER_UNAVAILABLE`, `AI_OUTPUT_INVALID`, `AI_SCHEMA_INVALID`.

AI must not retry the provider. Workflow may use its existing retry policy only after mapping recognized transient errors (`TIMEOUT`, `NETWORK_ERROR`, `HTTP_429`, `HTTP_503`). Invalid output, authentication, schema, authorization, and malformed responses are non-retryable.

## 5. Limits and configuration

Initial configurable limits:

| Resource | Default |
| --- | ---: |
| AI total request deadline | 60 seconds |
| Workflow AI call deadline | 65 seconds |
| Workflow generation deadline | 75 seconds |
| AI request body | 256 KiB |
| Generation body | 32 KiB |
| Processing text | 50,000 code points |
| Extraction schema | 32 KiB, 256 nodes, 16 reference depth |
| Provider wire response | 1 MiB |
| AI output envelope | 256 KiB |
| AI admission | 4 calls/replica, 2/workspace/replica, no queue |

Start the AI deadline in an early Fastify hook before expensive parsing. Propagate the remaining budget and AbortSignal through validation and provider fetch. Abort on timeout or disconnect and release admission exactly once. Limits are local per replica; no distributed quota is promised in V1.

AI configuration includes `AI_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, required `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `AI_SERVICE_JWKS_FILE`, timeout and admission settings. Workflow configuration includes the private AI URL, Service JWT key material, `WORKFLOW_AI_ENABLED`, `WORKFLOW_AI_GENERATION_ENABLED`, and 65/75-second budgets. `.env.example` contains placeholders only.

DeepSeek is accessed behind an `LlmProvider` port using bounded native `fetch`, JSON mode, no tools, no streaming, and no SDK retries. Model identifiers are deployment configuration and must not be invented in examples.

## 6. Workflow integration

Workflow adds:

- an AI REST client and Service JWT issuer;
- typed response/error validation;
- concrete executors for `ai.extract`, `ai.classify`, and `ai.summarize`;
- static schema handling for `ai.extract.outputSchema`;
- deterministic `WorkflowIntent` compilation;
- authorized `POST /workspaces/{workspaceId}/workflows/generate`.

Generation checks actor, workspace membership, `WORKFLOW_CREATE`, selected aliases, and connection attachment capability before calling AI. It reads only safe connection metadata through the existing Workspace API and never resolves credentials. Generation does not save, publish, or run a workflow.

Existing workflow definitions remain readable/editable/publishable. Legacy `schemaDescription` is preserved for compatibility, but execution of extraction requires `outputSchema` and fails with a clear structured error when it is missing. No automatic data migration is performed.

Static `outputSchema` metadata must survive mapping and credential scanning without weakening ordinary credential rejection. Existing object-path mapping semantics remain unchanged; array indexing is outside this V1 scope.

## 7. Acceptance criteria

1. Four operations reject invalid envelopes, duplicate keys, unknown fields, oversized input, and invalid output before success.
2. Flexible nested extraction schemas behave consistently in TypeScript and Java fixtures.
3. Classification labels remain within the supplied set and summaries respect Unicode code-point limits.
4. Wrong tenant, issuer, audience, scope, operation, expiry, or request binding never reaches the provider.
5. Cancellation, timeout, oversized provider output, and admission overflow release resources safely.
6. Identical intents compile deterministically; unsafe graphs, guessed connections, cycles, and missing facts return no definition.
7. Legacy extraction definitions remain readable/editable/publishable; execution without `outputSchema` fails clearly.
8. AI node outputs reach downstream Workflow nodes; only recognized transient failures retry.
9. The authenticated local Workflow → AI → provider fixture path passes success, clarification, unauthorized, invalid-output, timeout, and cancellation cases.
10. AI and Workflow architecture tests, unit tests, integration tests, typechecks, builds, Compose validation, and `git diff --check` pass.

The partner-owned Gateway integration is a separate deliverable and is not required to satisfy these criteria.
