# AI Service

> Status: V1 target Implemented for the four stateless operations (extract, classify, summarize, generate); `agent.task`/Agent Runtime and the public generate route are Planned/pending. Owner: K. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

The AI Service is a private, stateless NestJS (Fastify) reasoning service. Workflow Service calls it for AI nodes and for natural-language workflow generation. It validates every request strictly, calls one LLM provider (DeepSeek), validates the model output, and returns JSON. Source: [README](../../../services/ai-service/README.md), [V1 design](../../superpowers/specs/2026-09-25-ai-service-v1-design.md).

Not responsible for:
- Persisting workflows, prompts, documents, or results (no database, no cache).
- Compiling `WorkflowIntent` into `WorkflowDefinition`, validating or publishing it (Workflow `IntentCompiler` + validator own that).
- Running tools or side effects, resolving credentials/connections, authorizing users (Workflow and Workspace do this; AI never sees `connectionId`).
- Public ingress: AI stays off the public edge; the Gateway must not route public traffic to `/v1/*`.
- OCR (see [ocr-service.md](./ocr-service.md)).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC014 | Generate workflow from natural language | Partial | AI side `POST /v1/generate` Implemented ([ai.controller.ts](../../../services/ai-service/src/presentation/http/ai.controller.ts)); Workflow `IntentCompiler` exists ([IntentCompiler.java](../../../services/workflow-service/src/main/java/com/weav/workflow/domain/generation/IntentCompiler.java)). Public Gateway route is a pending partner handoff (design §9). |
| UC018 | Run workflow (AI nodes) | Implemented (AI side) | `ai.extract`, `ai.classify`, `ai.summarize` served by `/v1/extract|classify|summarize`; Workflow executor: [AiNodeExecutor.java](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ai/AiNodeExecutor.java), gated by `WORKFLOW_AI_ENABLED`. |
| Agent tasks (`agent.task`) | n/a | Planned | Deferred from V1 (design §1). |

## Business rules

| Rule | How AI enforces it |
| --- | --- |
| BR08 | Generation returns only a `WorkflowIntent` proposal (`ready` / `needs_input` / `unsupported`); AI has no publish/run capability. Service JWT `mode=generation` is accepted only for `/v1/generate`. |
| BR03 | Tenant binding: JWT `workspace_id` must equal body `workspaceId`; AI receives no credentials or connection IDs (prompt says "Never output connectionId"). |
| BR01 | No user identity reaches AI; only Workflow-issued Service JWTs are accepted. |

Component rules (from code):
- Intent nodes may only use capability types and `configFields` supplied in the request; unknown or unsafe output returns `AI_OUTPUT_INVALID` ([generation-result.ts](../../../services/ai-service/src/domain/workflow-generation/generation-result.ts)).
- Classification label must be one of the supplied categories; summaries are truncated at grapheme boundaries and return `truncated` ([summarize.ts](../../../services/ai-service/src/application/summarize.ts)).
- The extraction `outputSchema` must satisfy the schema profile (object root, allowed keywords only, max 32 KiB, 256 nodes, depth 8; no `$ref`, `default`, `const`, `examples`) ([output-schema-profile.ts](../../../services/ai-service/src/domain/schema/output-schema-profile.ts)); it is mirrored by Workflow `OutputSchemaPolicy.java` and a shared fixture ([fixtures](../../../packages/contracts/http/ai/fixtures/output-schema-profile.json)).
- Prompts treat every string in the request as data, never instructions ([prompts.ts](../../../services/ai-service/src/prompts/prompts.ts)).

## Domain model and data

None persisted. The service owns no database, schema, or migrations. In-memory state is limited to the admission counters ([admission.ts](../../../services/ai-service/src/infrastructure/admission.ts)). Types: request envelopes ([envelopes.ts](../../../services/ai-service/src/presentation/http/envelopes.ts)), `WorkflowIntent` result union, closed error code set ([errors.ts](../../../services/ai-service/src/domain/errors.ts)).

## API

Internal only (caller: Workflow Service). OpenAPI: [openapi.yaml](../../../packages/contracts/http/ai/openapi.yaml), examples in [examples](../../../packages/contracts/http/ai/examples).

| Method | Path | Purpose | Auth | Main errors |
| --- | --- | --- | --- | --- |
| POST | `/v1/extract` | Structured extraction against `outputSchema` (text <= 50,000 code points, instructions <= 2,000) | Service JWT scope `ai:extract` | 400, 401, 403, 413, 422 `AI_SCHEMA_INVALID`, 502 |
| POST | `/v1/classify` | Pick one of 2-50 categories, returns `{category, confidence}` | scope `ai:classify` | as above |
| POST | `/v1/summarize` | Summary up to `maxLength` (1-5,000), returns `{summary, truncated}` | scope `ai:summarize` | as above |
| POST | `/v1/generate` | Prompt (<= 4,000 code points) + 1-40 capabilities to `WorkflowIntent` | scope `ai:generate`, `mode=generation` | as above |
| GET | `/health/live` | Liveness | none | none |
| GET | `/health/ready` | 200 only if provider and JWKS verifier are configured, else 503 | none | 503 |

Common: `X-Request-ID` (UUID) required and equal to JWT `request_id` and body `requestId`. Success: `{requestId, result}`. Error: `{error: {code, message, requestId}}`.

| Code | HTTP | Workflow retries |
| --- | ---: | :---: |
| INVALID_REQUEST / UNAUTHENTICATED / FORBIDDEN | 400 / 401 / 403 | no |
| PAYLOAD_TOO_LARGE / AI_SCHEMA_INVALID | 413 / 422 | no |
| AI_BUSY | 429 | yes |
| AI_NOT_CONFIGURED / AI_PROVIDER_UNAVAILABLE | 503 | not-configured no, unavailable yes |
| AI_PROVIDER_AUTH / AI_OUTPUT_INVALID | 502 | no |
| AI_TIMEOUT | 504 | yes |
| INTERNAL_ERROR | 500 | no |

Public Gateway route `POST /api/v1/workspaces/:id/workflows/generate` (to Workflow, not AI): Planned, partner handoff (design §9). No Gateway generate route found in `services/api-gateway/src`.

## Events and messaging

None. AI is synchronous REST/JSON only.

## Dependencies

| Direction | Component | Purpose |
| --- | --- | --- |
| Calls | DeepSeek `POST {DEEPSEEK_BASE_URL}/chat/completions` | LLM completion, `response_format=json_object`, temperature 0, redirects disabled ([deepseek-provider.ts](../../../services/ai-service/src/infrastructure/llm/deepseek/deepseek-provider.ts)) |
| Called by | Workflow Service ([AiClient.java](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ai/AiClient.java)) | AI nodes and generation |
| Reads | JWKS file from the Workflow key pair | Service JWT verification |
| Not used | Neon, R2, Valkey, RabbitMQ, Workspace, Identity | n/a |

## Security

- Service JWT (RS256, `kid` required) verified locally against a JWKS file; `alg` must be `RS256`, unknown `kid` rejected ([service-jwt-verifier.ts](../../../services/ai-service/src/infrastructure/auth/service-jwt-verifier.ts)).
- Claims: `iss=weav-workflow`, `aud=weav-ai` (single audience), `scope=ai:<operation>`, `workspace_id`, `request_id`, `mode` in `execution|generation`; `execution_id` and `node_execution_id` required for `execution`; `exp - iat <= 120 s`, 30 s clock skew. Header limit 8,192 chars.
- Authorization checks in the controller: scope equals route, `workspace_id` equals body, `request_id` equals header and body, `generation` mode only for `generate`; otherwise `FORBIDDEN`.
- Key handling: `node scripts/ai-dev-keys.mjs` writes `tmp/service-keys/private/workflow-service.pem` and `tmp/service-keys/public/workflow-service.jwks.json` (kid `workflow-dev-1`). Compose mounts only `public/` into ai-service at `/run/weav-keys` (read-only) and only the private key into workflow-service. `tmp/` is never committed.
- Input validation: strict Zod envelopes (unknown fields rejected), strict JSON parser (64 nesting depth, prototype keys rejected, invalid UTF-8 rejected), only `application/json`, body <= 256 KiB, output <= 256 KiB.
- Secrets: `DEEPSEEK_API_KEY` from env only; logs carry request ID, operation, workspace ID, duration, outcome (no prompts, documents, JWTs, provider bodies).
- Errors use fixed safe messages; provider detail is never echoed.

## Configuration

Names and defaults from [ai-config.ts](../../../services/ai-service/src/config/ai-config.ts); blank values count as unset.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | Listen port (compose maps host 3001) |
| `AI_PROVIDER` | `deepseek` | Only value supported |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | unset | Both required for readiness |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Provider URL |
| `DEEPSEEK_MAX_TOKENS` | 4096 | 256-8192 |
| `AI_SERVICE_JWKS_FILE` | unset (compose: `/run/weav-keys/workflow-service.jwks.json`) | JWKS path; unreadable keeps service not-ready |
| `AI_REQUEST_TIMEOUT_MS` | 60000 | 1000-120000, deadline starts before body parsing |
| `AI_MAX_CONCURRENCY` | 4 | Global in-flight cap (1-64), not set in compose |
| `AI_MAX_CONCURRENCY_PER_WORKSPACE` | 2 | Per-workspace cap (1-64), not set in compose |

Related Workflow settings ([.env.example](../../../.env.example)): `WORKFLOW_AI_ENABLED=false`, `WORKFLOW_AI_GENERATION_ENABLED=false`, `AI_SERVICE_PRIVATE_URL` (default `http://ai-service:3000`), `WORKFLOW_AI_SIGNING_KEY_ID` (default `workflow-dev-1`), `WORKFLOW_AI_SIGNING_KEY_LOCATION`.

Fake provider overlay: [compose.ai-local.yml](../../../compose.ai-local.yml) adds a `fake-deepseek` container ([fake-deepseek.mjs](../../../services/ai-service/test/fixtures/fake-deepseek.mjs)), points ai-service at it with fixture key/model, and sets both Workflow AI flags to `true`. Real provider: run `node scripts/ai-dev-keys.mjs`, set the DeepSeek vars and Workflow flags in `.env`, start without the overlay, then `curl http://localhost:3001/health/ready`.

## Non-functional requirements

| Aspect | Value (source) |
| --- | --- |
| Request deadline | 60 s default, aborts provider call; client disconnect aborts the same signal ([app.ts](../../../services/ai-service/src/app.ts)) |
| Concurrency | Local per-replica admission: 4 global, 2 per workspace, no queue; overflow returns `AI_BUSY` 429; release is idempotent |
| Provider retries | None in AI; Workflow retries only `AI_BUSY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT` and transport timeout/network errors |
| Provider response cap | 1 MiB read cap; provider 429/5xx map to `AI_PROVIDER_UNAVAILABLE` |
| Idempotency | None; Workflow uses a fresh request UUID per attempt |
| Observability | JSON console logs; `/health/live`, `/health/ready`; startup never crashes on missing key/model/JWKS |
| Rate limits | Per-workspace concurrency only; distributed quotas deferred |

## Status and known gaps

- Planned: `agent.task`, agent tool execution, RAG, embeddings, streaming, durable conversations, provider fallback, mobile AI surfaces (design §8).
- Planned: Gateway generate route (partner handoff, design §9); Playwright generate case depends on it.
- Partial: duplicate-key detection on AI ingress not implemented (design §4; Workflow public route covers it).
- Planned: JSON Schema `$ref`/`$defs`, distributed rate limits, CI pipeline.
- Limitation: single provider, no fallback; admission counters are per replica.
- Limitation: `AI_MAX_CONCURRENCY*` not exposed in compose files.

## Testing

- `pnpm --dir services/ai-service test` (unit, Jest) and `pnpm --dir services/ai-service test:e2e`; `pnpm --dir services/ai-service build`.
- Lint without rewriting: `pnpm --dir services/ai-service exec eslint "{src,test}/**/*.ts"` (the `lint` script runs `--fix`).
- No test calls DeepSeek: fake `LlmProvider`, local `node:http` fixture, [ai.e2e-spec.ts](../../../services/ai-service/test/ai.e2e-spec.ts), [deepseek-provider.spec.ts](../../../services/ai-service/src/infrastructure/llm/deepseek/deepseek-provider.spec.ts), [use-cases.spec.ts](../../../services/ai-service/src/application/use-cases.spec.ts), strict-JSON and schema-profile specs.
- Last result (2026-09-30, `dev`): 66/66 unit, 21/21 e2e. No environment-only failures known.

## Open questions

1. **Decided (2026-09-30):** owner is K.
2. Notion routes Gateway directly to AI; the V1 design keeps AI private and routes generation through Workflow. Suggested: follow the design (code has no public AI route).
3. Gateway has an `AI_SERVICE_URL` upstream in [compose.dev.yml](../../../compose.dev.yml) while the design says it must not route public traffic to AI. Suggested: confirm in the partner handoff that the Gateway only uses it for health, not public proxying.
4. UC014 is Partial only because of the Gateway route; confirm whether Workflow's generate controller is complete (not verified in this spec, Workflow spec owns it).
5. Should `AI_MAX_CONCURRENCY` and `AI_MAX_CONCURRENCY_PER_WORKSPACE` be added to compose/.env.example? Suggested: yes, defaults are fine for dev.

## References

- Code: [services/ai-service](../../../services/ai-service), [scripts/ai-dev-keys.mjs](../../../scripts/ai-dev-keys.mjs)
- Design and plan: [design](../../superpowers/specs/2026-09-25-ai-service-v1-design.md), [plan](../../superpowers/plans/2026-09-25-ai-service-v1.md)
- Contract: [packages/contracts/http/ai](../../../packages/contracts/http/ai)
- Compose: [compose.dev.yml](../../../compose.dev.yml), [compose.ai-local.yml](../../../compose.ai-local.yml)
- Rules: [rulebook](../../rulebook.md), [specs index](../README.md)
