# Design proposal: messaging nodes, a richer node catalog, and an AI assistant

Status: proposed (2026-10-04), not implemented. Owner: K (backend). Needs agreement with the FE owner before coding, because every item has a UI part.

Context: the backend hardening and RS256 work are merged (`docs/reviews/2026-10-01-backend-review.md`, `docs/architecture/jwt-asymmetric-signing-design.md`). Today's node catalog (`services/workflow-service/.../domain/definition/NodeCatalog.java`) has 4 triggers (`trigger.manual`, `trigger.schedule`, `trigger.webhook`, `trigger.telegram`), 4 actions (`http.request`, `email.send`, `google.sheets`, `telegram.send_message`), one binary `logic.condition`, three AI nodes (`ai.extract`, `ai.classify`, `ai.summarize`) and `ocr.extract`. The two Telegram nodes are listed but gated as not ready (`IntegrationReadiness`). `services/bot-service` is an unwired scaffold planned for UC022–UC024 (`docs/rulebook.md`, `docs/specs/services/bot-service.md`).

## 1. Replace bot-service with messaging nodes

**Decision (proposed):** drop the standalone bot-service. Telegram, Discord and Slack become workflow nodes, like any other app in a Zapier/n8n-style catalog.

Why: a separate always-on bot service needs its own deployment, auth, database and an account-linking flow, and duplicates what the workflow engine already does (triggers, execution, retries, notifications).

| Node | How | Connection (workspace credential) |
| --- | --- | --- |
| `trigger.telegram` | Variant of the webhook trigger. Weav calls Telegram `setWebhook` for the user's bot with a `secret_token`; the `X-Telegram-Bot-Api-Secret-Token` header is verified in constant time; `update_id` is the idempotency key (reuses WF-1). | Telegram bot token (the user creates the bot with @BotFather) |
| `telegram.send_message` | Bot API `sendMessage` | same bot token |
| `discord.send_message` | Discord incoming webhook (no OAuth) | webhook URL |
| `slack.send_message` | Slack incoming webhook, or bot token + `chat.postMessage` | webhook URL or bot token |

- Credentials use the existing encrypted connection model (WS-7 key ring + AAD). Outbound calls go through the existing SSRF-safe HTTP stack with fixed provider hosts.
- Discord/Slack **triggers** are out of scope for now (they need a registered app, event subscriptions and request-signature verification).
- notification-service keeps its own Telegram delivery: that is system notifications to users, not user-defined workflow actions.
- Follow-ups: update UC022–UC024 in `docs/rulebook.md` and `docs/specs/services/bot-service.md`; remove `services/bot-service` and its compose block.

## 2. A richer node catalog

The biggest gap is flow control and data shaping, not more integrations: without them users cannot build non-trivial workflows.

| Tier | Nodes | Notes |
| --- | --- | --- |
| 1. Core (no external API) | `logic.switch` (multi-way branch), `data.set` (map/rename fields, templates), `flow.delay` (wait N minutes), `flow.loop` (for-each over a list) | `flow.delay` and `flow.loop` change the execution engine's state model (run states, leases, WF-9 recovery cap, retention) and need their own short design before coding. |
| 2. Messaging | the four nodes from section 1 | Highly visible in a demo. |
| 3. Reuse the Google connection | `google.calendar` (create event), `google.drive` (upload/list), `trigger.gmail` (new email, polling) | Mostly new OAuth scopes and executors; the polling trigger reuses the schedule scanner. |
| 4. AI | `ai.generate` (free-form prompt inside a workflow), `ai.translate` | Small additions to ai-service operations; counted by the AI-2 quota. |

**Enabler (do first):** declare each node's configuration as a JSON Schema in `packages/workflow-schema` (field types, required fields, enums, which fields accept templates, which take a `connectionId` of which provider). The web editor then renders config forms generically, so each new node costs the FE almost nothing. Workflow-service keeps validating configs server-side against the same schema.

## 3. AI assistant (chat) in ai-service

A chat assistant inside the product, separate from workflow nodes:

- **Ask:** "which workflows failed today?", "why did run X fail?", "who is in this workspace?"
- **Explain:** "what does this node do?", "how do I connect Gmail?"
- **Build:** "make a workflow that emails me new Sheets rows" uses the existing workflow-generation capability and returns a **draft**; the user reviews it in the editor and saves or publishes it.

`ai.generate` (section 2) is a different thing: an unattended step inside a workflow.

### Data and storage

- **No copy of workspace or workflow data in ai-service.** The assistant reads live data through tools that call the existing workspace and workflow APIs with the **user's own access token**, so answers only include what that user may see, and the owning services keep enforcing authorization (CLAUDE.md: never read another service's tables).
- **A small `ai_db` (Neon, one database per service)** for:
  - `conversations` and `messages`: history survives reloads and works across web and mobile; retention purge like the other services.
  - per-workspace usage counters: chat calls arrive through the gateway, not through workflow-service, so the AI-2 quota in workflow-service does not see them.
- **No vector database / RAG for now:** the data is structured and fetched through APIs; a few pages of product help text fit in the prompt.

### Rules

1. **Prompt injection:** workflow names, emails and logs can contain instructions. Tools are read-only by default; anything that writes (create or run a workflow) is only *proposed* and needs an explicit user confirmation in the UI.
2. **Never expose credentials:** the assistant never calls internal `/resolve` endpoints and never sees tokens or secrets.
3. **Data minimisation:** send DeepSeek only the fields an answer needs.
4. **Auth:** ai-service today only accepts workflow's service JWTs. Chat adds user access tokens through the gateway, verified via identity's JWKS (ID-6).
5. **Streaming:** responses stream (SSE) through the gateway.
6. **Limits:** per-user and per-workspace rate limits and the daily quota; bounded conversation length sent to the model.

## Estimate (backend, with Claude doing most of the coding)

Assumes the current workflow: Sonnet agents implement per lane, the coordinator reviews and re-runs tests, and K tests against real providers. Calendar time depends on available hours, review and live-provider testing. FE work (partner) is separate.

| Item | Backend estimate |
| --- | --- |
| Node config JSON Schema in `workflow-schema` (+ server-side validation) | 1–2 days |
| Messaging nodes (Telegram trigger + send, Discord, Slack) and removing bot-service | 3–4 days |
| `logic.switch`, `data.set` | ~2 days |
| `ai.generate`, `ai.translate` nodes | 1–2 days |
| `flow.delay` (engine change) | 2–3 days |
| `flow.loop` / for-each (engine change, design first) | 4–6 days |
| Google Calendar, Drive, Gmail polling trigger | 3–5 days |
| AI assistant MVP: `ai_db`, user auth path, gateway route + SSE, read-only tools, generation tool with confirm, safety tests | 9–13 days |
| **Total** | **≈ 25–37 working days (about 5–7 weeks)** |

The riskiest parts are `flow.loop`/`flow.delay` (engine state and recovery) and the assistant's tool-calling quality with DeepSeek; prototype the assistant's tool loop early.

## Suggested order

1. Node config JSON Schema (unblocks the FE).
2. Messaging nodes + remove bot-service (quick, visible win).
3. `logic.switch`, `data.set`.
4. AI assistant MVP (read-only tools first, then the generation tool).
5. `flow.delay`, then `flow.loop` (each after a short engine design).
6. Google Calendar/Drive/Gmail trigger, `ai.generate`/`ai.translate`.

## Open questions

- Is UC022–UC024 (link Telegram account, use the bot) still required by the thesis scope, or can "your own bot as a connection" replace it?
- Should chat history be per user, or shared by everyone in a workspace?
- Does DeepSeek reliably support tool calling and streaming for this use (verify before building the tool loop)?
- Should the assistant be available on mobile in V1?
