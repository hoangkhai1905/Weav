# Week 5 handoff for mobile and OCR (read this first)

For the partner who owns `apps/mobile` and `services/ocr-service`. Nothing here changed those folders. Items below are what to adapt and how to check each.

## 1. Telegram screen: the `/api/telegram/*` calls no longer exist
- `apps/mobile/src/infrastructure/http/http-telegram.repository.ts` calls `/api/telegram/status`, `/link-code` and `/unlink`. That per-user bot linking was removed.
- A workspace's own bot is now a `TELEGRAM` workspace connection (token from @BotFather), created and managed through the Connections API like Gmail/Sheets. There is no bot-service.
- Change: remove or hide the old Telegram link screen; if a Telegram entry is kept, make it open the workspace Connections list and create a connection with provider `TELEGRAM`.
- Test: open the screen, expect no request to `/api/telegram/*` (watch the network log).

## 2. Manual trigger is optional (D1)
- Publish no longer fails with `MANUAL_TRIGGER_REQUIRED`. A published workflow needs at least one trigger; a publish with none returns `TRIGGER_REQUIRED` (HTTP 400, validation issue code). More than one manual trigger is still `MULTIPLE_MANUAL_TRIGGERS`.
- "Run" (`POST .../executions`) works for any published workflow: it starts at the `trigger.manual` node if there is one, otherwise at the first trigger node, and the run is recorded with `triggerType = MANUAL`.
- Change: do not hide or disable Run just because there is no manual node; map `TRIGGER_REQUIRED` to a message.
- Test: publish a Telegram-only workflow, press Run, expect a `MANUAL` run.

## 3. Gmail trigger input
- `trigger.gmail` run input adds `fromEmail` (bare address) and `fromName` (display name or `""`). `from` is unchanged (raw header, e.g. `"Ada" <ada@x.com>`).
- Change: if the mobile builder lists trigger fields, add the two; prefer `{{ trigger.input.fromEmail }}` for recipients.

## 4. `email.send` recipients accept `Name <addr>`
- `to`, `cc`, `bcc`, `replyTo` accept `addr`, `Name <addr>`, `"Name" <addr>` and comma lists (max 10 recipients in total). Only the address is used; the display name is dropped.
- Test: a workflow with `to = {{ trigger.input.from }}` from a Gmail trigger no longer fails with `CONFIGURATION_ERROR`.

## 5. Node errors can name the field
- A node `CONFIGURATION_ERROR` may carry `error.details.field` (set by the email node's `CONFIGURATION_ERROR` and by any `MAPPING_ERROR`, where it is the config field whose mapping failed), e.g. `{ "code": "CONFIGURATION_ERROR", "message": "The 'to' field is not a valid email address.", "details": { "field": "to" } }`. Additive: ignore it if you do not use it.
- Change: in the run detail screen show a field label next to the message (web maps `to` to "Người nhận", `cc`, `bcc`, `replyTo`, `subject`, `body`, `bodyType`, `senderName`, `replyToMessageId`, `connectionId`; unknown fields show their own name).
- Test: run an email node with `to` = `not-an-address`; the run detail must show the field.

## 6. Your own lifecycle actions no longer notify you
- The inbox no longer gets `workflow.created|published|paused|resumed` when you are the actor. `workflow.completed|failed` and other members' actions still arrive.
- Change: none required; do not expect a row after your own create/pause/resume. Unread badge counts drop accordingly.

## 6b. Workflow list: `triggerTypes`
- `GET .../workflows` items gain `triggerTypes: string[]` (node types of all trigger nodes in the draft definition, definition order). Additive.
- Change: show the trigger from it; a non-manual trigger wins over a legacy `trigger.manual` node (mobile list currently shows "manual" for everything).
- Test: a webhook workflow with a leftover manual node shows Webhook in the list.

## 7. Run details: steps and timing
- Backend now records `started_at` from the service clock, so durations are no longer 0 ms or negative.
- Mapping errors from missing input (for example `{{ trigger.input.body.x }}` after pressing Run on a webhook workflow) now also carry `error.details.field` and say the field refers to a missing value.
- A node with API status `SKIPPED` was not run (unused trigger, branch not taken). Web shows it as "Không chạy" and does not select it by default. The step order in web is the graph order, not the status order; mobile should do the same.
- Web polls a run every 2 s while it is QUEUED/RUNNING and stops at a terminal status, and pauses when the tab is hidden; do the equivalent on mobile (stop when the app is backgrounded).

## 8. Output names in the node catalog changed on web (S6)
Mobile's builder should use the same names so `{{ nodes.<id>.output.<key> }}` suggestions match what really runs:
- Google Sheets / Drive / Calendar: keys are top-level (for example Sheets lookup `range`, `rows`, `count`, `truncated`; Calendar list `events`, `count`, `truncated`), not under `result`.
- `data.set`: the output is the fields themselves, not a `fields` object.
- `ai.extract`: the output keys are the keys of the configured output schema, not `extractedJson`.
- OCR: `text.rawText`, `document.pages`, `confidence`, `blocks`, `tables`.
- Telegram trigger, condition and switch now list their outputs.
- Test: add a Sheets lookup then an email node and open the field picker; it must offer `rows`, not `result`.

## OCR service
No change requested from the partner this week.
