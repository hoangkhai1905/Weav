# W6-B Control Bot, Workflow Events, Discord: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `weav.workflow` node (run/pause/resume/status/list_failures/command), `trigger.workflow_event`, `discord.send_message` with a `DISCORD` connection, and three built-in templates.

**Architecture:**
- The three node types are JSON schemas in `packages/workflow-schema/nodes/`, with executors and a trigger listener in workflow-service.
- workspace-service gains the `DISCORD` provider.
- Web gains node inspectors, a Discord connection form, and static templates.

**Tech Stack:** Spring Boot (workflow-service, workspace-service), React + Vite web, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-w6b-control-bot-design.md` (read first; this plan does not repeat it).

## Global Constraints

- **Branching:** lanes branch from `week6` (after batch 2 C1-C3 merged plus the AI answer fix) and work in `T:\Weav-wt\<lane>`. Agents do not commit; the coordinator commits.
- **Additive only:** existing node types, trigger types, providers and routes are unchanged. No new HTTP routes in the gateway (connections and workflows routes are generic).
- **No migrations needed for enums:** `trigger_type` and connection `provider` are plain VARCHAR. If B2 finds a provider CHECK constraint in workspace-service, it adds an additive Flyway migration (next free number).
- **Idempotency for workflow events:** use the existing `uq_workflow_executions_idempotency (workflow_id, idempotency_key)` with key `wfevent:<sourceExecutionId>`.
- **New config `WORKFLOW_WEB_BASE_URL`:** default empty, in `application.properties`, `.env.example` and `compose.dev.yml` (workflow-service env).
- **Secrets:** never log the Discord webhook URL or any part of it.
- **UI copy:** VI + EN through `translations.ts`.
- **Verify:** workflow-service and workspace-service `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`; web `tsc -p tsconfig.app.json`, `build`, Playwright `--project=chromium` with `VITE_API_MODE=http`.

## Review Focus

1. A `/run` or `/pause` command that names the workflow running the bot must be refused with a reply, not loop or pause itself. Test in B1 Task 2.
2. A failure-alert workflow that itself fails must not fire workflow events (depth 1), and no workflow ever fires itself. Test in B1 Task 3.
3. A name like `báo cáo  tuần` (case, extra spaces, Vietnamese diacritics) must match `Báo cáo tuần` exactly once; two workflows with the same name → `AMBIGUOUS_WORKFLOW`. Test in B1 Task 2.
4. A Discord URL like `https://discord.com.evil.test/api/webhooks/1/x` or `http://discord.com/...` must be rejected at connection save (SSRF). Test in B2 Task 1.
5. Discord content containing `@everyone` must not ping (`allowed_mentions.parse = []`). Test in B1 Task 4.

---

## Lane W6-B1: workflow-service (nodes, trigger, executors) + contracts

**Owns:**
- `packages/workflow-schema/nodes/{weav.workflow,trigger.workflow_event,discord.send_message}.json` (new)
- `packages/contracts/http/workflow/definition.schema.json` (node type lists)
- workflow-service: `NodeSideEffects`, `TriggerType`, new executors and services, the publication trigger registration, the connection provider mapping, `application.properties`
- `.env.example`, `compose.dev.yml` (workflow-service env)
- tests incl. `NodeConfigSchemasTest`, `DefinitionValidatorTest` type lists
- work log `docs/work_logs/K/workflow/control-bot.md`
- handoff section "E. Control bot nodes" in `docs/handoff/2026-10-week6-mobile.md`

### Task 1: Schemas first (contract)
- [ ] Write the three schema JSONs per spec sections 2-4, in the style of the existing schemas:
  - `x-weav-node` with category `action`/`trigger` and `sideEffect`;
  - `x-weav-template` on template fields;
  - `x-weav-connection` `{provider: "DISCORD"}`;
  - `x-weav-personal` where it applies: none for these, `workflow` is a selector.
- [ ] Add the types to every shared node list: `definition.schema.json`, `NodeSideEffects`, and the type-list tests.
- [ ] Run `./mvnw -q test -Dtest='*Schema*,*Definition*'` → PASS. **Report to the coordinator right after this task**, because lane B2 needs these three files.

### Task 2: `weav.workflow` executor
- Interface: `WeavWorkflowNodeExecutor implements NodeExecutor`. Actor = `published_by` of the executing version (read it with the snapshot). Capabilities per spec section 2.
- Reuse the existing services, never their HTTP controllers:
  - `ExecutionAdmissionService` for `run`;
  - `WorkflowPublicationService` pause/resume for `pause` and `resume`;
  - `MonitoringService`/`MonitoringQueryPort` for `status` and `list_failures`.
- Name match: trim, collapse inner whitespace, `Locale.ROOT` lowercase, NFC normalize; compare to workflow names in the workspace (non-deleted).
- [ ] Tests:
  - each operation;
  - permission denied → `FORBIDDEN`, not retried;
  - self-run and self-pause refused;
  - `AMBIGUOUS_WORKFLOW` and `WORKFLOW_NOT_FOUND`;
  - `command` parsing table: `/run X`, `/RUN  x `, `/failures`, `/failures X`, `/help`, `hello` (unknown → `ok:false` plus help reply), `/pause` with no name.
- [ ] Commit point.

### Task 3: `trigger.workflow_event`
- Interface: `WorkflowEventTriggerService implements ExecutionFinishedListener`, registered alongside `AlertEvaluator`. On finish:
  - skip CANCELLED;
  - skip sources whose trigger type is `WORKFLOW_EVENT`;
  - find enabled `WORKFLOW_EVENT` triggers of PUBLISHED workflows in the same workspace whose config matches;
  - enqueue each with input per spec section 3 and idempotency key `wfevent:<sourceExecutionId>`.
- Publish validation: every `workflowIds` entry exists in the same workspace; `events` is non-empty.
- [ ] Tests:
  - FAILED fires and SUCCEEDED does not when `events=[FAILED]`;
  - empty `workflowIds` = all except itself;
  - depth-1 guard;
  - CANCELLED ignored;
  - a duplicate finish notification fires once;
  - paused listener does not fire;
  - publish rejects a foreign workflow id.
- [ ] Commit point.

### Task 4: `discord.send_message` executor
- Interface: `DiscordSendMessageNodeExecutor implements NodeExecutor`, mirroring `TelegramSendMessageNodeExecutor` for connection resolution and `reportAuthenticationRejected`.
- Use the existing HTTP transport (and its SSRF guard if one exists for user URLs).
- Re-validate the URL pattern at send time.
- Body `{content, username?, allowed_mentions:{parse:[]}}`.
- [ ] Tests with a stub server:
  - the body shape;
  - content over 2000 characters → `CONFIGURATION_ERROR`;
  - 401/404 → `AUTHENTICATION_REJECTED` reported;
  - 429 retryable with `Retry-After`;
  - the URL is never logged (assert on captured logs).
- [ ] Full `./mvnw verify` → PASS (minus the CLAUDE.md environment-only failures). Commit point.

## Lane W6-B2: workspace-service DISCORD + web

**Owns:**
- workspace-service `ConnectionProvider`, `ConnectionProviderPolicy`, connection validation (+ a migration only if needed)
- web: connections page/form, builder node palette, labels, icons and inspectors for the three nodes, `apps/web/src/lib/templates/index.ts`, `translations.ts` (own block), variable picker paths for `trigger.workflow_event`, e2e specs
- work log `docs/work_logs/K/web/control-bot-web.md`

### Task 1: DISCORD provider (workspace-service)
- [ ] Tests:
  - DISCORD + TOKEN accepted, and any other auth type rejected;
  - the URL pattern from spec section 4 accepted;
  - Review Focus 4 URLs rejected;
  - the credential is never echoed in responses.
- [ ] Implement, then run `./mvnw verify` → PASS. Commit point.

### Task 2: Web: Discord connection, node inspectors, templates
- Discord connection form, in the same pattern as the Telegram token form: a webhook URL field, masked, with client-side pattern validation and a hint.
- Inspectors:
  - `weav.workflow`: operation select; workflow picker from the workspace list, which also allows typing a name/expression; `limit`; `text` for `command`; `input` JSON for `run`.
  - `trigger.workflow_event`: a multi-select of workflows excluding itself, and event checkboxes.
  - `discord.send_message`: connection, content with a 2000-character counter, username.
- Variable picker paths for the workflow_event trigger outputs.
- The three templates per spec section 5, in `WORKFLOW_TEMPLATES` with the category `chat`, or a new `monitoring` category if the filter UI supports adding one cheaply.
- The schemas for the three node types come from lane B1 (the coordinator copies them into your worktree). Do not edit them.
- [ ] Playwright (stubs, port 4185):
  - create a Discord connection (POST body provider/authType/credential shape);
  - each inspector renders and saves its config;
  - each new template creates a valid draft (`createWorkflowFromDefinition` body);
  - the failure-alert email template leaves `to` empty.
- [ ] `tsc`, `build`, eslint on touched files. Commit point.

## Merge and checks

B1 → `week6`, then B2. Run `detect_changes` per lane on the clean main checkout. After both are merged, run the live check on `dev-k`:
- create a Discord connection (K pastes a real webhook URL himself);
- make a failing workflow fire the email and Discord alert templates;
- the Telegram bot answers `/status <name>`, `/run <name>` and `/failures` (cloudflared tunnel + `WORKFLOW_PUBLIC_BASE_URL`, as in Week 4).
