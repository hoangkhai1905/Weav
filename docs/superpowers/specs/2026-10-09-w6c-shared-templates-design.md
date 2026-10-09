# W6-C Shared templates, stop a run, run expressions: design

Status: draft for K's review (2026-10-09). Branch base: `week6` 1316eeb. Plan: `2026-10-07-week5-plan.md` section 4.

## 1. Goal and decisions

Users share their own workflows as reusable templates; anyone allowed to see one can copy it into their workspace as a draft and re-pick connections. The W5-B built-in static templates (`apps/web/src/lib/templates/index.ts`) stay as they are.

Decided (K, 2026-10-09):

- PRIVATE = team library: visible to members of the workspace the template was shared from. UNLISTED = any signed-in user who has the share code or the id; never listed. PUBLIC = gallery and search.
- PUBLIC publishes immediately (no approval queue). A system `ADMIN` (existing JWT `systemRole` claim) can unpublish any PUBLIC template.
- A template is a snapshot taken at share time, not a live link. Sharing the same workflow again updates its existing template (same id and code).
- `author_name` is a display snapshot sent by the client at share time (the JWT has no name claim).
- Sanitizing happens on the server, driven by the node schemas. The client never decides what is personal.

Out of scope: approval queue, ratings/comments, template versions, mobile screens (handoff note only), moving the static templates into the database.

## 2. Data (workflow-service, Flyway V14)

```sql
CREATE TABLE workflow_templates (
    id                 UUID PRIMARY KEY,
    owner_id           UUID NOT NULL,
    workspace_id       UUID NOT NULL,          -- source workspace (PRIVATE scope)
    source_workflow_id UUID,                   -- re-share updates this row
    name               VARCHAR(255) NOT NULL,
    description        VARCHAR(2000),
    author_name        VARCHAR(120),
    definition         JSONB NOT NULL,         -- sanitized
    editor_state       JSONB,                  -- node names and positions only
    node_types         TEXT[] NOT NULL,
    visibility         VARCHAR(16) NOT NULL CHECK (visibility IN ('PRIVATE','UNLISTED','PUBLIC')),
    share_code         VARCHAR(8) NOT NULL UNIQUE,
    usage_count        INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX uk_workflow_templates_source ON workflow_templates (source_workflow_id)
    WHERE deleted_at IS NULL AND source_workflow_id IS NOT NULL;
CREATE INDEX ix_workflow_templates_public ON workflow_templates (usage_count DESC, created_at DESC)
    WHERE visibility = 'PUBLIC' AND deleted_at IS NULL;
CREATE INDEX ix_workflow_templates_workspace ON workflow_templates (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_workflow_templates_owner ON workflow_templates (owner_id) WHERE deleted_at IS NULL;
```

- `share_code`: 8 characters of Crockford base32 (no I, L, O, U) from `SecureRandom`; retry on the unique violation. Generated for every template so changing visibility never changes the code. Lookup is case-insensitive and ignores spaces and dashes.
- Limits: at most 50 live templates per owner (409 `TEMPLATE_LIMIT_REACHED`); definition size uses the existing workflow body limit.
- Deleted workspace (W6-D2): its PRIVATE templates are no longer visible to anyone (the membership check fails). UNLISTED and PUBLIC stay, because they hold no credentials. The owner can still delete them.

## 3. Sanitizing

New schema field keyword `x-weav-personal: true` (allowed in `ClasspathNodeSchemaSource.FIELD_KEYWORDS` and the web `SchemaProperty` type). `TemplateSanitizer` (domain, pure, uses `NodeCatalog`) applies these rules to a `WorkflowDefinition`:

1. Every `x-weav-connection` field (`connectionId`) is removed.
2. An `x-weav-personal` field is kept only when its value is exactly one mapping expression (`"{{ trigger.input.fromEmail }}"`), or an array whose items each are. Anything else is removed.
3. `definition.variables`: keys kept, values replaced by `""`.
4. `editor_state`: only `nodes.<id>.name` and `nodes.<id>.position` are kept.
5. Kept literal text anywhere in a config (outside `{{ }}` expressions) is scanned. An e-mail address, or a 24+ character run of `[A-Za-z0-9_-]` (a likely token), produces a warning `{nodeId, field, reason}`. The value itself is not changed: free text cannot be sanitized automatically, so the owner reviews it.

Output: `{ definition, editorState, removedFields: [{nodeId, field}], warnings: [{nodeId, field, reason: EMAIL|TOKEN}] }`.

Fields marked `x-weav-personal`:

| Node | Fields |
| --- | --- |
| `email.send` | `to`, `cc`, `bcc`, `replyTo`, `senderName` |
| `telegram.send_message` | `chatId` |
| `google.sheets` | `spreadsheetId` |
| `google.drive` | `folderId` |
| `google.calendar` | `calendarId`, `attendees` |
| `http.request` | `headers`, `query` |
| `ocr.extract` | `artifactId`, `fileUrl` |

The W6-B nodes add their own marks (`discord.send_message`: the webhook connection is already `x-weav-connection`). A check in the sanitizer test asserts that every schema field whose name ends in `Id` or equals `to`, `cc`, `bcc`, `email`, `attendees` or `headers` is either a connection, personal, or on an explicit allow-list, so a new node cannot silently leak.

## 4. API (workflow-service; gateway mirrors each under `/api/v1`)

| Method and path | Who | Result |
| --- | --- | --- |
| `POST /workspaces/{ws}/workflows/{wf}/template/preview` | can edit the workflow | 200 sanitizer output plus the existing template for this workflow (if any); writes nothing |
| `PUT /workspaces/{ws}/workflows/{wf}/template` `{name, description?, authorName?, visibility}` | can edit the workflow | creates (201) or updates (200) the snapshot for this workflow; returns `TemplateDetail` incl. `shareCode` |
| `GET /templates?scope=public\|workspace\|mine&workspaceId=&q=&page=&size=` | signed in | page of `TemplateSummary`; `workspace` needs membership of `workspaceId`; `q` = ILIKE on name/description; `public` ordered by usage then recency |
| `GET /templates/{id}` | visible to caller | `TemplateDetail` (definition, editorState, nodeTypes, author, counts; `shareCode` only for the owner) |
| `GET /templates/by-code/{code}` | signed in | `TemplateDetail` for UNLISTED/PUBLIC; PRIVATE or unknown = 404 |
| `PATCH /templates/{id}` `{name?, description?, visibility?}` | owner; ADMIN may only set a PUBLIC template to PRIVATE | 200 `TemplateDetail` |
| `DELETE /templates/{id}` | owner | 204, soft delete |
| `POST /templates/{id}/use` `{workspaceId, name?}` | template visible, and caller can create workflows in `workspaceId` | 201 `{workflowId}`; one transaction: create the draft through `WorkflowDraftService` (definition + editor_state), then `usage_count = usage_count + 1` |

Visible to caller = owner, or PUBLIC, or UNLISTED, or PRIVATE and a member of `workspace_id`. Hidden templates answer 404, never 403. Errors use the existing problem format. Membership and role checks reuse the workspace access client workflow-service already uses for workflows.

Gateway: a new rate-limit category `template` (`GATEWAY_TEMPLATE_RATE_LIMIT`, default 20/min per user) for every non-GET template route and for `GET /templates/by-code/*`; other GETs stay in the general bucket. Contracts: `packages/contracts/http/workflow/openapi.yaml` gains the routes and schemas. `.env.example` gains the variable.

## 5. Web

- **Create workflow page, templates section:** tabs "Có sẵn" (static, unchanged), "Cộng đồng" (PUBLIC, search box, usage count, author), "Nhóm" (PRIVATE of the active workspace), "Của tôi" (mine: visibility select, copy code, delete). A "Nhập mã" button opens a dialog. Code → preview (name, author, node list with icons, "you will re-pick N connections") → "Dùng mẫu" → `POST /use` → open the builder on the new draft.
- **Builder:** "Chia sẻ làm mẫu" in the header menu opens the share dialog. Fields: name, description, visibility radio. It calls `preview` and lists removed fields ("sẽ bị xoá: người nhận email, chat ID...") and warnings. When there are warnings, a checkbox "Tôi đã kiểm tra nội dung" must be ticked. Save → shows the code with a copy button and a link for UNLISTED/PUBLIC.
- `author_name` defaults to the profile display name.
- VI and EN strings, keyboard and screen-reader accessible dialogs (existing dialog component).

## 6. Stop a running execution

- `POST /workspaces/{ws}/workflows/{wf}/executions/{id}/cancel` (caller has `WORKFLOW_RUN`; gateway route + contract).
  - QUEUED → CANCELLED at once (conditional update).
  - RUNNING or WAITING → sets `cancel_requested_at` (Flyway V15). The runner holds the lease and checks the flag on every loop turn. When it is set, the runner stops scheduling, the remaining nodes are CANCELLED, and the execution ends CANCELLED with error code `CANCELLED_BY_USER`.
  - Already finished → 409.
  - A node that is already running finishes first (HTTP calls are not interrupted). The dialog says so.
- The completion event and monitoring treat CANCELLED as neither success nor failure. Today a CANCELLED terminal state records a `workflow.failed` notification; it must record none (the user stopped it). The finished listener still runs; metrics and alert rules already count only SUCCESS/FAILED. W6-B `trigger.workflow_event` will not fire on it.
- Web: a "Dừng" button on the run detail page for QUEUED, WAITING and RUNNING, with a confirm; the status badge shows CANCELLED.

## 7. Run expressions

Additive in `MappingResolver` and `MappingContext`:

| Expression | Value |
| --- | --- |
| `{{ now }}` | ISO-8601 UTC instant at resolution time, from the injected `Clock` |
| `{{ run.id }}` | execution id |
| `{{ workflow.id }}`, `{{ workflow.name }}` | workflow id; name at execution start |

`DefinitionValidator` accepts the new roots; the web variable picker lists them under "Lần chạy"; the AI generation prompt mentions them. Existing expressions are unchanged.

## 8. Folded-in leftovers

- Week 5: N8 AI step names (workflow-service derives display names from node ids; give generated steps readable names); builder ✨ panel recipient default; remove the dead `generatePrompt` handoff in `WorkflowBuilderPage`; remove unused translation keys.
- e2e-audit section 9:
  - (1) LONG_RUNNING message for a run still in progress reads "đã chạy hơn N giây".
  - (2) Monitoring filter selects get a bound `label`/`id`.
  - (3) workflow-service answers 404 for a deleted workspace's workflows.
  - (4) notification-service `runtime.integration.cjs` v2 list gains the two `monitoring.alert.*` types.
  - (5) Flaky tests are only re-checked, not fixed here.

## 9. Lanes (all Sonnet; worktrees `T:\Weav-wt\<lane>`)

| Lane | Owns | Notes |
| --- | --- | --- |
| W6-C1 templates backend | workflow-service templates (V14, sanitizer, schema marks, service, controller), gateway routes + rate limit, contracts, `.env.example` | Merge first |
| W6-C2 templates web | create page tabs, enter-code dialog, share dialog, builder menu, i18n; Week 5 web leftovers; follow-up (2) | Builds against section 4; Playwright with `page.route` stubs; live check after C1 merges |
| W6-C3 stop run + expressions | V15, cancel endpoint + runner check, completion/monitoring handling, MappingResolver roots, run-detail button, variable picker, gateway cancel route; N8 names; follow-ups (1), (3), (4) | Shares `openapi.yaml` and gateway `workflow.module.ts` with C1: union on merge |

Then W6-B (control bot) as its own lane after C1 and C3 merge, because it builds on CANCELLED handling and the personal-field marks.

## 10. Testing

- **workflow-service:**
  - Sanitizer unit tests: every rule, the schema guard test, warnings.
  - Repository/integration tests on Testcontainers: visibility matrix (owner, member, non-member, admin, deleted workspace), share-code lookup normalisation, re-share upsert, owner limit, the use transaction plus usage count, 404-not-403.
  - Cancel: queued, running between nodes, finished → 409.
  - MappingResolver tests for the new roots with a fixed `Clock`.
- **Gateway:** e2e for each route (proxy, auth, the `template` rate limit).
- **Web:** Playwright for share → code → enter code → use → builder opens, and for cancel on run detail. Console and network must be clean.
- **Live check** on Neon `dev-k` after the second-stack check: share a workflow with an email.send to a literal address (removed) and a mapped address (kept), use it from a second account, stop a long run, and send a message with `{{ run.id }}` and `{{ now }}`.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Free text (prompts, bodies, URLs) can leak personal data | Warnings + mandatory review checkbox; owner can delete; ADMIN can unpublish |
| A new node forgets its personal marks | Schema guard test (section 3) |
| Share-code guessing | 8 base32 chars (~10^12), `template` rate limit, PRIVATE never resolvable by code |
| Cancel races with the runner finishing | Conditional update (`WHERE status IN (...)`); 409 when the run already ended |
| Schedule | 2026-10-09 with freeze 2026-11-01: C1-C3 in parallel (~2-3 days), then W6-B; drop the "Của tôi" management tab to a simple list first if time runs short |
