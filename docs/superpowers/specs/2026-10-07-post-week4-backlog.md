# Post-Week-4 backlog: thesis gaps, features, nodes and apps

Status: noted 2026-10-07, **not scheduled**. Nothing here is built until K says the backend and frontend work well together (partner is wiring the FE to the BE now). Each item gets its own spec before work starts. Feature freeze 2026-11-01, thesis 2026-11-23.

## 1. Thesis commitments vs. current state

Source: the registered thesis description ("Xây dựng phần mềm Tự động hoá và giám sát qui trình công việc").

| Commitment | Status (2026-10-07) | Gap |
| --- | --- | --- |
| Web platform: design, manage, run workflows (drag and drop) | Backend complete; FE in progress (partner) | none on the backend |
| Mobile app | Expo app with screens for workflows, runs, notifications, AI generator, Telegram | Partner's side; some screens call mock or missing APIs |
| AI Agent generates workflows from natural language (function calling, structured output) | Generator + assistant with tool calling, live-tested | Needs measured evidence (accuracy eval set) |
| OCR module inside workflow steps (invoices, receipts, high accuracy) | `ocr.extract` exists but is disabled; OCR service runs on Google Colab (partner) | Stable hosting; node input only `artifactId`/`fileUrl` (no file references from the Week 4 file store); no accuracy numbers |
| Two-way Telegram/Discord chatbot: alerts, status, control workflows remotely in real time | Only `trigger.telegram` + `telegram.send_message` ("your own bot" as a connection); no Discord | See section 2 (decided approach) |
| Permissions, stability, load handling, extensible connectors | Members/permissions, admin users; engine has leases, retries, outbox, bounded workers | No load-test evidence |
| Microservices + PostgreSQL + Redis + BullMQ | Microservices + Neon Postgres + Redis (Aiven) + **RabbitMQ** | Code unchanged; one sentence in the report explains RabbitMQ instead of BullMQ |
| Deliverables: source, DB, architecture docs, API docs, test report | Many specs and work logs | Consolidate later (section 8) |

## 2. Telegram/Discord: control bot built from nodes (decided direction)

K's view (2026-10-07): with a mandatory mobile app, a separate bot with `/run`/`/stop` duplicates the app, so Telegram/Discord stay nodes. The registered description still promises a two-way bot five times, so the promise is met **with nodes and templates, not a bot service**:

| Piece | Behaviour |
| --- | --- |
| `weav.workflow` node | Operations `run` / `pause` / `resume` / `status` / `list_failures` on workflows of the same workspace, with the same permission checks as the API |
| `trigger.workflow_event` | Starts a workflow when selected workflows fail or succeed (reuses the existing execution completion events / outbox) |
| `discord.send_message` | Discord webhook URL as a connection (no OAuth) |
| Template "Telegram control bot" | `trigger.telegram` -> `logic.switch` on the command -> `weav.workflow` -> `telegram.send_message` reply |
| Template "Failure alert" | `trigger.workflow_event` (failed) -> Telegram / Discord / email |
| Optional `trigger.discord` | Discord slash commands via the HTTP interactions endpoint (no gateway connection); Telegram already covers the two-way demo |

Partner action: the web and mobile Telegram pages call `/api/telegram/status`, `/link-code`, `/unlink`, which no longer exist (bot-service removed in Week 1). Remove them or turn them into "connect your bot" pages that point to the TELEGRAM connection and the templates.

Effort: about one week. The riskiest part is `trigger.workflow_event`.

## 3. Everyday gaps (small to medium)

| # | Missing | Why | Size |
| --- | --- | --- | --- |
| 1 | Delete a workflow | No delete exists; test workflows pile up | S |
| 2 | Workspace-wide run history (filter by status, workflow, date) | Only per-workflow history; the assistant's "failed today" fans out per workflow | M |
| 3 | Dashboard stats (active/paused, runs today/7 days, success rate, recent failures) | FE has `DashboardPage` with no backend | S-M |
| 4 | Re-run a failed run with the same input | Most common action after a failure | S |
| 5 | Stop a running execution | Stuck runs cannot be stopped | M |
| 6 | Duplicate a workflow | Quickest way to make a variant | S |
| 7 | Search and filter (workflows by name/status, runs by status) | Lists only page | S |
| 8 | Date/time and run info in templates (`{{ now }}`, today, run id, workflow name) | Templates see only trigger input, node outputs and static variables | S-M (touches `MappingResolver`: strictly additive) |
| 9 | Email me when a workflow fails (setting) | Zapier/n8n default; Resend and notification-service exist (also covered by section 2 templates) | M |

Nice to have: version history and restore (M), set a password for Google-only accounts (S; today they cannot set one and password reset silently sends nothing), delete workspace / delete account (S-M), "test this step" (M-L).

## 4. Bigger features (about one week each)

| # | Feature | Value | Risk |
| --- | --- | --- | --- |
| 1 | Monitoring & alerting module: workspace run history, metrics (success rate, counts, average duration, trends), alert rules (fails N times, runs longer than Y) via notification-service + Resend | Highest: "giám sát" is half the thesis title; FE Dashboard/Executions pages wait for it | Low (read endpoints + one rule evaluator) |
| 2 | Error handling per step: stop / continue / retry N / error branch; workflow-level "on failure run workflow X" | Reliability story; n8n users expect it | Medium (engine failure path) |
| 3 | Loop node: for each item in a list, sequential, capped | Unlocks many real workflows | Medium-high (engine change) |
| 4 | Delay / Wait node: wait N hours or until a date, resume from the database | Reminders and follow-ups | Medium (resumable runs) |
| 5 | Templates gallery: 10-15 ready workflows, "use template" asks for connections and creates a draft; assistant recommends templates | New users productive in one click | Low |
| 6 | AI "explain this failed run" (later: propose a fix as a draft change) | Strong AI demo, reuses the assistant tool loop | Low (watch DeepSeek budget) |

Suggested order: section 2 + #1 first, then #2 or #6, then #3/#4 only if time allows.

## 5. New nodes

Triggers:
- `trigger.google_sheets` (new row, polling like Gmail; existing Sheets scope). Also covers Google Forms via the form's linked sheet. M
- `trigger.google_calendar` (event starting soon / new event; `calendar.events` allows reading). M
- `trigger.rss` (new feed item; no auth; SSRF-safe transport). S-M
- Skip `trigger.google_drive`: `drive.file` only sees files the app created; `drive.readonly` is restricted.

Actions:
- `discord.send_message`, `slack.send_message`, `teams.send_message` (incoming webhooks, one shared pattern). S each
- `telegram.send_document` / `send_photo` (stored files from the Week 4 file store). S-M
- `notify.in_app` (notification to workspace members via notification-service). S
- `ai.translate` (deferred earlier; `ai.generate` with a fixed prompt). S
- `gmail.add_label` / `mark_read`: needs the new `gmail.modify` scope (consent screen change, ask K first). M

Data and logic:
- `format.datetime` (now, add/subtract, format, time zone). S-M
- `format.text` (upper/lower/trim/replace/split/join, number format; fixed operations, no user regex). S-M
- `data.list` (filter, sort, limit, pick fields). M

Suggested bundle: `trigger.google_sheets` + `trigger.rss`; Discord + Slack + `telegram.send_document`; `format.datetime` + `format.text`. Avoid new Google scopes, a code node and paid APIs.

## 6. App integrations

| App | Nodes | Auth | Size |
| --- | --- | --- | --- |
| Notion | Trigger: new database item; create page, update properties, query database | Internal integration token | M |
| GitHub | Trigger: issue/PR/push via repo webhook; create issue, comment | Personal access token + webhook secret | M |
| Trello | Create/move card; trigger: new card (polling) | API key + token | M |
| Microsoft Teams | Post to a channel | Incoming webhook | S |
| Discord / Slack | See section 5 | Webhook URL | S |
| SePay / Casso (Vietnam) | Trigger: payment received (webhook) -> receipt email, Sheets row, Telegram | API key / webhook | S-M |
| Zalo Official Account | Send to followers; trigger on OA message | Needs an Official Account; verify messaging rules first (feasibility spike) | ? |
| Google Docs / Google Tasks | Create doc from template / tasks | New scopes (ask K) | M |

Skip for now: Jira, Asana, ClickUp, Dropbox, OneDrive, Calendly (paid webhooks).

Suggested pick: Notion; Discord + Slack + Teams; GitHub; optionally SePay; Zalo only after a feasibility check.

## 7. OCR end to end (with the partner)

- Partner: stable OCR hosting (Colab sessions stop); option: the OCR container on the demo VM if the models run on CPU. Accuracy evaluation on a small invoice/receipt set.
- K's side: `ocr.extract` accepts a file reference (Gmail/Telegram attachments, uploads) so "invoice email -> OCR -> Sheets row -> Telegram alert" works; enable `WORKFLOW_OCR_*` once hosting is stable. Requested as a documented handoff for anything inside `ocr-service`.

## 8. Expected-outcome evidence (later)

Load test (k6: concurrent webhook triggers, throughput, latency), AI generation accuracy eval (e.g. 30 prompts -> % valid workflows), OpenAPI per service, architecture diagram, test report from the existing suites, one paragraph on RabbitMQ vs BullMQ.

## 9. Suggested timeline (if K starts after FE/BE are stable)

| Week | Work |
| --- | --- |
| 5 | Section 2 (control-bot nodes + templates) and monitoring module |
| 6 | OCR end to end (with partner) + selected nodes/apps |
| 7 (to 2026-11-01) | Evidence and docs (section 8), deployment (see `docs/work_logs/K/platform/demo-deployment.md`) |
