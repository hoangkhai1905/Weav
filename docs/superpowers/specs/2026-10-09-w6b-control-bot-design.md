# W6-B Control bot, workflow events, Discord: design

Status: approved by K 2026-10-09 (design in chat, "approve as is"). Base: `week6` after batch 2 W6-C (3c74eba). Plan: `2026-10-07-week5-plan.md` section 4 (W6-B); backlog item 2.

## 1. Goal

Let a workspace control and watch its own workflows from inside workflows: a Telegram bot that runs, pauses, resumes and reports on workflows, and alerts on failures by e-mail, Telegram or Discord. W6-A monitoring alerts are in-app only, so external alerts come from these nodes and templates.

## 2. `weav.workflow` node (action)

Config:

| Field | Type | Notes |
| --- | --- | --- |
| `operation` | enum `run`, `pause`, `resume`, `status`, `list_failures`, `command` | required |
| `workflow` | string, template | target: a workflow id, or an exact name (case-insensitive, trimmed) in the same workspace; required except for `command` and for `list_failures` (empty = whole workspace) |
| `input` | object, template | `run` only: trigger input for the target (manual-style run) |
| `limit` | integer 1-20, default 5 | `list_failures` |
| `text` | string, template | `command` only: the raw chat text |

Behaviour:

- **Who it acts as:** the user who published the version being executed (`workflow_versions.published_by`).
- **Permission checks:** each call checks that user's capability through the existing `WorkspaceAuthorization`:
  - `run` needs `WORKFLOW_RUN`;
  - `pause` and `resume` need `WORKFLOW_MANAGE_STATE`;
  - `status` and `list_failures` need `WORKFLOW_MONITOR`.

  A denied call fails the node with `FORBIDDEN` (no retry).
- **Target rules:**
  - The target must be in the same workspace.
  - The node refuses to act on the workflow running it for `run` (loop) and for `pause` (it would pause itself).
  - A name matching several workflows fails `AMBIGUOUS_WORKFLOW` and lists up to 5 candidates.
  - No match fails `WORKFLOW_NOT_FOUND`.
- **`run`:** reuses the manual-run admission path (same quotas and idempotency) and outputs `{executionId, status: "QUEUED"}`. It does not wait for the target to finish.
- **`status` output:** `{workflowId, name, status (ACTIVE/PAUSED/DRAFT), lastRun: {executionId, status, finishedAt} | null, successRate7d}`.
- **`list_failures` output:** `{items: [{workflowId, workflowName, executionId, finishedAt, errorCode, errorMessage}]}`, reusing the W6-A monitoring query.
- **`command`:**
  - Parses `text` as `/run <name>`, `/pause <name>`, `/resume <name>`, `/status <name>`, `/failures [name]` or `/help`. The command word is case-insensitive; the rest is the name.
  - Output: the operation's output plus `reply`, a Vietnamese plain-text message of at most 1000 characters describing the result or the error.
  - An unknown command, or a failure of the operation, does NOT fail the node. It returns `ok: false` with a helpful `reply`, so the bot always answers.
- **Side effect:** `run`, `pause`, `resume` and `command` are side-effecting (`x-weav-node.sideEffect: true`).

## 3. `trigger.workflow_event`

Config:
- `workflowIds`: an array of workflow ids in the same workspace. Empty means every workflow of the workspace except itself.
- `events`: a non-empty subset of `FAILED` and `SUCCEEDED`.

Behaviour:
- **Firing:**
  - The trigger fires from the existing `ExecutionFinishedListener`, after the terminal state commits, next to `AlertEvaluator`.
  - It finds every PUBLISHED workflow in the source's workspace with an enabled `WORKFLOW_EVENT` trigger whose config matches the source workflow and status.
  - For each one, it enqueues an execution with the new `TriggerType.WORKFLOW_EVENT`.
- **Input:** `{workflowId, workflowName, executionId, status, errorCode, errorMessage, startedAt, finishedAt, durationMs, runUrl}`. `runUrl` is the web base URL plus the run path, from config `WORKFLOW_WEB_BASE_URL`; when that is empty, the field is omitted.
- **When it never fires:**
  - CANCELLED runs.
  - Loop guard: an execution whose trigger type is `WORKFLOW_EVENT` never fires workflow events (depth 1).
  - A workflow never fires itself.
- **Idempotency:** one firing per (listening trigger, source execution), enforced by a unique key on the queued execution, reusing the existing idempotency column and pattern.
- **Publish validation:** publishing checks that every listed `workflowIds` entry exists in the same workspace.

## 4. `discord.send_message` and the `DISCORD` connection

- **workspace-service:**
  - New `ConnectionProvider.DISCORD` with auth type `TOKEN`. The secret is the webhook URL.
  - The URL must match `^https://(discord\.com|discordapp\.com)/api/webhooks/\d+/[A-Za-z0-9_-]+$`. It is validated on create and update, and never returned or logged.
- **Node config:**
  - `connectionId`: `x-weav-connection`, provider `DISCORD`.
  - `content`: string, template, required, at most 2000 characters after mapping.
  - `username`: string, template, optional, at most 80 characters.
- **Request:** POST JSON `{content, username?, allowed_mentions: {parse: []}}` to the webhook. Mentions are disabled.
- **Discord errors:**
  - 401 or 404: `AUTHENTICATION_REJECTED`, reported to workspace-service the same way Telegram rejections are.
  - 429: retryable, honouring `Retry-After`.
- **Sanitizer:** `connectionId` is removed, as for every connection. There are no personal fields.

## 5. Built-in templates (web static list)

- "Bot Telegram điều khiển quy trình": `trigger.telegram` → `weav.workflow` (`command`, `text: {{ trigger.input.message.text }}`) → `telegram.send_message` (`chatId: {{ trigger.input.message.chat.id }}`, `text: {{ nodes.control.output.reply }}`).
- "Cảnh báo lỗi qua email": `trigger.workflow_event` (`events: [FAILED]`) → `email.send` (subject/body from the trigger input; recipient left for the user).
- "Cảnh báo lỗi qua Discord": same trigger → `discord.send_message`.

## 6. Out of scope

- Waiting for a triggered run to finish.
- Cross-workspace control.
- Registering slash commands with Telegram.
- Discord bots (only webhooks).
- `trigger.discord`.

## 7. Testing

- **workflow-service:**
  - `weav.workflow`: each operation, including permission denied, an ambiguous or missing name, the self-pause refusal, and a table of `command` parsing cases.
  - `trigger.workflow_event`: matching, the loop guard, CANCELLED ignored, idempotent firing, publish validation.
  - Discord executor with a stub server: the content limit, mentions disabled, and 401/404/429.
- **workspace-service:** the DISCORD provider/auth combination and the URL validation.
- **Web:** the Discord connection form, the node inspectors, and the three templates creating valid drafts (Playwright with stubs).
- **Live (dev-k):**
  - The Telegram bot answers `/status`, `/run` and `/failures`.
  - A failing workflow fires the e-mail alert template.
