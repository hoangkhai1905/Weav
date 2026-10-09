# W6-C Shared Templates, Stop a Run, Run Expressions: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users share workflows as sanitized templates (PRIVATE team library / UNLISTED by code / PUBLIC gallery) and copy them into a workspace; runs can be stopped; mappings gain `{{ now }}`, `{{ run.id }}`, `{{ workflow.id }}`, `{{ workflow.name }}`.

**Architecture:** Templates live in workflow-service (one table, schema-driven `TemplateSanitizer`, `TemplateService`, JDBC adapter, controller). The gateway proxies them with a `template` rate-limit bucket; web adds a gallery, share and enter-code dialogs. Cancel is a flag the `ExecutionRunner` checks on each loop turn. Run expressions are new roots in `MappingResolver`.

**Tech Stack:** Spring Boot 4 / Java (JdbcTemplate, Flyway, Testcontainers), NestJS gateway, React + Vite web, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-w6c-shared-templates-design.md` (read it first; this plan does not repeat it).

## Global Constraints

- Lanes branch from `week6` and work in `T:\Weav-wt\<lane>`. Never bare `git stash`. Commit in the lane branch only; the coordinator merges.
- Additive only: no renamed or dropped columns, routes, or response fields.
- Flyway numbers are fixed: C1 = `V14__workflow_templates.sql`, C3 = `V15__execution_cancel_request.sql`.
- Hidden templates answer 404, never 403. Error bodies use the existing problem format and exception types (`ResourceNotFoundException`, `ForbiddenException`, `ConflictException`, `BadRequestException`).
- Limits: 50 live templates per owner (`TEMPLATE_LIMIT_REACHED`, 409); name 1-255, description ≤ 2000, authorName ≤ 120; share code 8 chars Crockford base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
- Gateway env `GATEWAY_TEMPLATE_RATE_LIMIT` default 20 (per minute per user), added to `.env.example`.
- No `console.log` in production code; framework loggers only. Never log definitions, tokens, or e-mail addresses.
- UI copy in VI and EN through `apps/web/src/lib/i18n/translations.ts`.
- Verify per CLAUDE.md: workflow-service `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`; gateway `pnpm --dir services/api-gateway test`, `test:e2e`, `build`; web `tsc -p tsconfig.app.json`, `build`, Playwright `--project=chromium` with `VITE_API_MODE=http`. Known environment-only failures are listed in CLAUDE.md.

## Review Focus

1. A personal field holding a mixed value (`"boss@x.com, {{ trigger.input.to }}"`) must be removed, not kept. Test in C1 Task 1.
2. A share code typed as `wv7k-3m9q` (lowercase, dash, spaces) must resolve; a PRIVATE template's code must 404. Test in C1 Task 2/3.
3. `use` into a workspace where the caller lacks `WORKFLOW_CREATE` must 403 and leave `usage_count` unchanged. Test in C1 Task 3.
4. Cancelling a run that finishes in the same instant must not overwrite SUCCESS/FAILED (conditional update; 409). Test in C3 Task 1.
5. Old definitions that use `{{ nodes.x.output.y }}` or a variable literally named `now` keep resolving exactly as before. Test in C3 Task 3.

---

## Lane W6-C1: templates backend (workflow-service, gateway, contracts)

### Task 1: `x-weav-personal` and `TemplateSanitizer`

**Files:**
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/definition/ClasspathNodeSchemaSource.java` (add `"x-weav-personal"` to `FIELD_KEYWORDS`, read it like `x-weav-static`)
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/NodeConfigSchema.java` (field flag `personal`; accessor `Set<String> personalFields()` and, if missing, `Set<String> connectionFields()`)
- Modify: `packages/workflow-schema/nodes/{email.send,telegram.send_message,google.sheets,google.drive,google.calendar,http.request,ocr.extract}.json` (marks per spec section 3 table)
- Modify: `apps/web/src/lib/nodeSchemas.ts` (`'x-weav-personal'?: boolean` on `SchemaProperty`, type only)
- Create: `services/workflow-service/src/main/java/com/weav/workflow/domain/template/TemplateSanitizer.java`
- Test: `services/workflow-service/src/test/java/com/weav/workflow/domain/template/TemplateSanitizerTest.java`

**Interfaces:**
- Produces: `TemplateSanitizer(NodeCatalog catalog)`; `SanitizedTemplate sanitize(WorkflowDefinition definition, Map<String,Object> editorState)`; `record SanitizedTemplate(WorkflowDefinition definition, Map<String,Object> editorState, List<RemovedField> removedFields, List<TemplateWarning> warnings)`; `record RemovedField(String nodeId, String field)`; `record TemplateWarning(String nodeId, String field, String reason)` with reason `"EMAIL"` or `"TOKEN"`. All in package `com.weav.workflow.domain.template`.

- [ ] **Step 1: Write failing tests** (one per rule, spec section 3):
  - `removesConnectionIds`: email.send with `connectionId` → absent; `removedFields` contains `(send_email, connectionId)`.
  - `keepsPureExpressionPersonalField`: `to: "{{ trigger.input.fromEmail }}"` kept, and the array `["{{ a.b }}", "{{ c.d }}"]` kept.
  - `removesLiteralAndMixedPersonalField`: `to: "a@b.com"` removed; `to: "a@b.com, {{ trigger.input.to }}"` removed; `chatId: 12345` (number) removed.
  - `blanksVariableValues`: `variables {apiBase: "https://x"}` → `{apiBase: ""}`.
  - `editorStateKeepsOnlyNameAndPosition`: `{nodes:{n1:{name:"A",position:{x:1,y:2},secret:"x"}}, viewport:{}}` → `{nodes:{n1:{name:"A",position:{x:1,y:2}}}}`.
  - `warnsOnEmailAndTokenInFreeText`: email.send `body: "Liên hệ sales@acme.vn"` → warning EMAIL; http.request `url: "https://api.x.com/?k=AbCdEfGhIjKlMnOpQrStUvWxYz12"` → warning TOKEN; `body: "{{ nodes.prepare_long_node_identifier_name.output.x }}"` → no warning (text inside `{{ }}` is ignored).
  - `everyIdLikeFieldIsClassified` (guard): for every schema in `NodeCatalog`, every field whose name ends in `Id` or equals `to`, `cc`, `bcc`, `email`, `attendees`, `headers` is a connection field, a personal field, or in `Set.of("replyToMessageId", "messageId")`.
- [ ] **Step 2:** Run `./mvnw -q test -Dtest=TemplateSanitizerTest` → FAIL (class missing).
- [ ] **Step 3:** Implement the schema flag and `TemplateSanitizer`. A value is a "pure expression" when it matches `^\s*\{\{[^{}]+\}\}\s*$`. Scan for warnings by first deleting every `\{\{[^{}]*\}\}` span, then e-mail `[^\s@]+@[^\s@]+\.[^\s@]+` and token `[A-Za-z0-9_-]{24,}`. Walk nested maps and lists in config; the field path in results is the top-level config key.
- [ ] **Step 4:** Run the test plus `./mvnw -q test -Dtest='*Schema*,*Definition*'` → PASS (schema loader still accepts every file).
- [ ] **Step 5:** Commit `feat(workflow): schema-driven template sanitizer (x-weav-personal)`.

### Task 2: V14, store, and share codes

**Files:**
- Create: `services/workflow-service/src/main/resources/db/migration/V14__workflow_templates.sql` (exact DDL from spec section 2)
- Create: `.../domain/valueobject/TemplateVisibility.java` (`PRIVATE, UNLISTED, PUBLIC`)
- Create: `.../domain/template/ShareCode.java`
- Create: `.../application/port/out/TemplateStore.java`
- Create: `.../infrastructure/persistence/repository/TemplateAdapter.java` (JdbcTemplate, schema-qualified like `AlertRuleAdapter`)
- Test: `.../domain/template/ShareCodeTest.java`, `.../infrastructure/persistence/TemplateAdapterTest.java` (Testcontainers, same base as `ExecutionLeaseTest`)

**Interfaces:**
- Produces: `ShareCode.generate(RandomGenerator random) -> String` (8 chars from the Crockford alphabet in Global Constraints); `ShareCode.normalize(String input) -> Optional<String>` (uppercase, strip spaces and `-`, map `I,L→1`, `O→0`, empty unless the result is exactly 8 alphabet chars).
- Produces: `TemplateStore` with `record Template(UUID id, UUID ownerId, UUID workspaceId, UUID sourceWorkflowId, String name, String description, String authorName, Map<String,Object> definition, Map<String,Object> editorState, List<String> nodeTypes, TemplateVisibility visibility, String shareCode, int usageCount, Instant createdAt, Instant updatedAt)` and methods `Template insert(Template t)` (retries a new code on unique violation of `share_code`, max 5), `Template update(Template t)`, `Optional<Template> findLive(UUID id)`, `Optional<Template> findLiveByCode(String code)`, `Optional<Template> findLiveBySourceWorkflow(UUID workflowId)`, `int countLiveByOwner(UUID ownerId)`, `Page list(Scope scope, UUID callerId, UUID workspaceId, String query, int page, int size)` with `enum Scope {PUBLIC, WORKSPACE, MINE}` and `record Page(List<Template> items, int page, int size, long totalElements)`, `void softDelete(UUID id, Instant at)`, `boolean incrementUsage(UUID id)`.

- [ ] **Step 1: Failing tests:** `ShareCodeTest`: generated codes are 8 chars, all in the alphabet; `normalize("wv7k-3m9q")` = `Optional.of("WV7K3M9Q")`; `normalize(" o1l0 abcd ")` = `"0110ABCD"`; `normalize("short")` empty; `normalize("UUUUUUUU")` empty. `TemplateAdapterTest`: insert/findLive round-trip (JSONB and `text[]`); `findLiveByCode` ignores soft-deleted rows; second live template for the same `source_workflow_id` violates the partial unique index; `list(PUBLIC, …, "hóa đơn", …)` matches name/description ILIKE and orders by `usage_count DESC, created_at DESC`; `list(WORKSPACE, …)` returns only PRIVATE rows of that workspace; `list(MINE)` returns all visibilities of the owner; `incrementUsage` on a deleted id returns false.
- [ ] **Step 2:** Run both tests → FAIL.
- [ ] **Step 3:** Implement the migration, enum, `ShareCode` (`SecureRandom` in production), store port, and adapter. Escape `%` and `_` in the ILIKE query.
- [ ] **Step 4:** Run both tests → PASS.
- [ ] **Step 5:** Commit `feat(workflow): workflow_templates table and store`.

### Task 3: `TemplateService` and `createWithDraft`

**Files:**
- Create: `.../application/service/TemplateService.java`
- Modify: `.../application/service/WorkflowDraftService.java` (add `createWithDraft`)
- Test: `.../application/service/TemplateServiceTest.java` (fakes like `AlertRuleServiceTest`), `.../application/service/WorkflowDraftServiceTest.java` (one new case)

**Interfaces:**
- Consumes: Task 1 `TemplateSanitizer`, Task 2 `TemplateStore`, `ShareCode`; `WorkspaceAuthorization.require(ws, user, capability)`; `WorkflowDraftService.get(ws, wf, actor)`.
- Produces in `WorkflowDraftService`: `Workflow createWithDraft(CreateWorkflowCommand command, WorkflowDefinition definition, Map<String,Object> editorState)`. It checks `WORKFLOW_CREATE`, validates name, definition and editor state like `save`, then creates and writes the draft in ONE transaction plus the `workflow.created` outbox event. Its definition never carries connection ids.
- Produces `TemplateService` (constructor: `WorkspaceAuthorization, WorkflowDraftService, TemplateStore, TemplateSanitizer, DefinitionJsonCodec or the existing definition mapper, TransactionTemplate, Clock, RandomGenerator`):
  - `Preview preview(UUID ws, UUID wf, UUID actor)` → `record Preview(SanitizedTemplate sanitized, Optional<Template> existing)`; requires `WORKFLOW_EDIT`.
  - `Upserted share(UUID ws, UUID wf, UUID actor, ShareInput in)` → `record Upserted(Template template, boolean created)`; `record ShareInput(String name, String description, String authorName, TemplateVisibility visibility)`; requires `WORKFLOW_EDIT`; updates the live template for `wf` (only its owner may; another editor gets 409 `TEMPLATE_OWNED_BY_OTHER`) or inserts one (limit 50 → 409 `TEMPLATE_LIMIT_REACHED`).
  - `Template get(UUID id, Caller caller)`, `Template getByCode(String code, Caller caller)`, `TemplateStore.Page list(TemplateStore.Scope scope, UUID workspaceId, String q, int page, int size, Caller caller)`, `Template update(UUID id, Caller caller, PatchInput in)`, `void delete(UUID id, Caller caller)`, `UUID use(UUID id, Caller caller, UUID targetWorkspaceId, String name)`.
  - `record Caller(UUID userId, boolean admin)`; `record PatchInput(String name, String description, TemplateVisibility visibility)` (all nullable).
- Visibility rule (spec section 4): owner, PUBLIC, or UNLISTED → visible. PRIVATE → visible when `require(template.workspaceId, caller, "WORKFLOW_MONITOR")` passes; `ForbiddenException` or `ResourceNotFoundException` from it mean hidden. Hidden → `ResourceNotFoundException("Template not found")`.
- `update`: owner may change all fields. A non-owner admin may only change PUBLIC → PRIVATE. Anyone else gets 404 if hidden, else `ForbiddenException`.
- `use`: visible check, then `createWithDraft` in the target workspace (name = `name` or template name), then `incrementUsage`. A failed `createWithDraft` leaves the count unchanged.

- [ ] **Step 1: Failing tests:**
  - visibility matrix (owner, PUBLIC stranger, UNLISTED stranger, PRIVATE member, PRIVATE non-member → 404, PRIVATE whose workspace is deleted (access port throws `ResourceNotFoundException`) → 404, soft-deleted → 404);
  - `getByCode` on PRIVATE → 404 even for a member; `getByCode("wv7k-3m9q")` resolves `WV7K3M9Q`;
  - re-share keeps id and code and replaces definition/name/visibility;
  - 51st template → 409 `TEMPLATE_LIMIT_REACHED`;
  - another editor re-sharing → 409;
  - admin PUBLIC→PRIVATE OK, admin rename → 403;
  - `use` without `WORKFLOW_CREATE` → 403 and count unchanged;
  - `use` success → `createWithDraft` called with the sanitized definition and count +1.
  - `WorkflowDraftServiceTest.createWithDraftStoresDefinitionInOneTransaction`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `node_types` = distinct node `type`s in definition order. `share` stores the sanitized definition (encode with the same codec the controller uses).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(workflow): template service (share, browse, use)`.

### Task 4: HTTP API

**Files:**
- Create: `.../presentation/http/TemplateController.java` (no class-level mapping; paths exactly as spec section 4)
- Create: `.../presentation/http/request/TemplateRequests.java` (`ShareTemplateRequest {name, description, authorName, visibility}`, `PatchTemplateRequest`, `UseTemplateRequest {workspaceId, name}`; bean validation per Global Constraints)
- Create: `.../presentation/http/response/TemplateResponse.java`
- Modify: `.../infrastructure/security/SecurityConfig.java` only if the new paths need an explicit matcher
- Test: `.../presentation/http/TemplateHttpTest.java` (same setup as `MonitoringHttpTest`)

**Interfaces:**
- JSON shapes (camelCase):
  - `TemplateSummary {id, name, description, authorName, nodeTypes[], visibility, usageCount, createdAt, updatedAt, owned}`
  - `TemplateDetail = TemplateSummary + {definition, editorState, shareCode?, workspaceId?, sourceWorkflowId?}` (the last three only when `owned`)
  - `TemplatePreview {definition, editorState, removedFields[{nodeId, field}], warnings[{nodeId, field, reason}], existing: TemplateDetail|null}`
  - Page `{items, page, size, totalElements}`; use → `201 {workflowId}`.
- Caller: `jwt.getSubject()` as the user id; admin = `"ADMIN".equals(jwt.getClaimAsString("system_role"))`.
- `scope` query param is `public|workspace|mine` (lowercase); `workspace` without `workspaceId` → 400.

- [ ] **Step 1: Failing tests:**
  - every route's happy path;
  - 404 for a hidden template on GET, PATCH, DELETE, use;
  - 400 on blank name, 256-char name, unknown visibility, unknown JSON field;
  - `shareCode` absent for non-owners;
  - PUT returns 201 then 200 on re-share;
  - unauthenticated → 401.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `./mvnw verify` → PASS except the CLAUDE.md environment-only failures.
- [ ] **Step 5:** Commit `feat(workflow): template HTTP API`.

### Task 5: Gateway, contracts, env

**Files:**
- Modify: `services/api-gateway/src/workflow/workflow.module.ts` (new `@Controller('api/v1/templates')` with the five template routes; add `template/preview` (POST) and `template` (PUT) under the workflows controller; proxy exactly like `alert-rules`)
- Modify: `services/api-gateway/src/rate-limit/gateway-throttler.guard.ts` (`isTemplateRequest`: non-GET under `/api/v1/templates` or `/api/v1/workspaces/*/workflows/*/template[/preview]`, plus `GET /api/v1/templates/by-code/*`; its own bucket with `templatePerMinute`)
- Modify: `services/api-gateway/src/config/gateway.config.ts` (`GATEWAY_TEMPLATE_RATE_LIMIT: positiveIntegerEnvironmentSchema(20)` → `templatePerMinute`)
- Modify: `.env.example` (`GATEWAY_TEMPLATE_RATE_LIMIT=20`)
- Modify: `packages/contracts/http/workflow/openapi.yaml` and `README.md` (routes and schemas from Task 4)
- Test: `services/api-gateway/src/workflow/workflow.module.spec.ts`, `services/api-gateway/src/rate-limit/*.spec.ts`, gateway e2e under `services/api-gateway/test/`

- [ ] **Step 1: Failing tests:**
  - each route forwards method, path, query, body and auth;
  - `isTemplateRequest` true for POST `/api/v1/templates/x/use` and `GET /api/v1/templates/by-code/AB`, false for `GET /api/v1/templates?scope=public`;
  - the 21st template mutation in a window → 429.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `pnpm --dir services/api-gateway test`, `test:e2e`, `build` → PASS; lint check with `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"` (not `lint`, which rewrites files).
- [ ] **Step 5:** Commit `feat(gateway): template routes and rate limit`. Update the work log `docs/work_logs/K/workflow/shared-templates.md` (new, from `log_template.md`) and append a section "C. Shared templates API" to `docs/handoff/2026-10-week6-mobile.md` (routes, shapes, the enter-code flow; mobile screens are the partner's).

---

## Lane W6-C2: templates web (+ Week 5 web leftovers, follow-up 2)

Builds against C1 Task 4 shapes. Tests stub the backend with `page.route` (`VITE_API_MODE=http`). Playwright port 4183.

### Task 1: API client and gallery tabs

**Files:**
- Create: `apps/web/src/api/templates.api.ts` (`listTemplates(scope, {workspaceId, q, page, size})`, `getTemplate(id)`, `getTemplateByCode(code)`, `previewShare(workspaceId, workflowId)`, `shareWorkflow(workspaceId, workflowId, input)`, `updateTemplate(id, patch)`, `deleteTemplate(id)`, `useTemplate(id, workspaceId, name?) -> Promise<string>`; same `request` helper and error handling as `monitoring.api.ts`; TS types mirror C1 Task 4)
- Create: `apps/web/src/components/templates/TemplateGallery.tsx`, `TemplateCard.tsx`, `TemplatePreviewDialog.tsx`, `EnterCodeDialog.tsx`
- Modify: `apps/web/src/pages/CreateWorkflowPage.tsx` (templates section becomes tabs `Có sẵn | Cộng đồng | Nhóm | Của tôi`; the static list stays under `Có sẵn` with its existing test ids; "Nhập mã" button)
- Modify: `apps/web/src/lib/i18n/translations.ts`
- Test: `apps/web/e2e/templates.spec.ts`

- [ ] **Step 1: Failing Playwright tests:**
  - `community tab lists public templates and searches`: stub `GET /api/v1/templates?scope=public…`, type in search, request carries `q`.
  - `enter code opens preview and uses template`: dialog accepts `wv7k-3m9q`, calls `by-code/wv7k-3m9q` (the server normalises), shows name, author, node list and "cần chọn lại 2 kết nối"; "Dùng mẫu" posts `use` with the active workspace id and navigates to `/workflows/<id>`.
  - `unknown code shows not-found message`: 404 → inline error, no navigation.
  - `mine tab changes visibility and deletes`: PATCH with `{visibility:"PUBLIC"}`, DELETE after confirm.
  - Built-in tab keeps `template-telegram-auto-reply` working.
- [ ] **Step 2:** Run `VITE_API_MODE=http pnpm --dir apps/web exec playwright test e2e/templates.spec.ts --project=chromium` → FAIL.
- [ ] **Step 3:** Implement. Dialogs use the existing dialog component (focus trap, Esc, labelled title). The connection count reuses the `NODE_SCHEMAS[type].required.includes('connectionId')` idea from `connectionNodeCount`.
- [ ] **Step 4:** Run → PASS; `tsc -p tsconfig.app.json` clean.
- [ ] **Step 5:** Commit `feat(web): template gallery and enter-code dialog`.

### Task 2: Share dialog in the builder

**Files:**
- Create: `apps/web/src/components/templates/ShareTemplateDialog.tsx`
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (header menu item "Chia sẻ làm mẫu"; disabled while the draft has unsaved changes, with a tooltip to save first)
- Modify: `translations.ts`; Test: `apps/web/e2e/templates.spec.ts`

- [ ] **Step 1: Failing tests:**
  - `share dialog lists removed fields and requires review when warnings exist`: stub `preview` with 2 removed fields and 1 EMAIL warning → both listed with node display names; Save disabled until "Tôi đã kiểm tra nội dung" is ticked; PUT body `{name, description, authorName, visibility:"UNLISTED"}`; success shows the code and a working copy button (`navigator.clipboard` stubbed).
  - `re-share pre-fills from existing template`: preview `existing` → fields pre-filled, button says "Cập nhật mẫu".
  - `authorName defaults to profile display name`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): share workflow as template`.

### Task 3: Week 5 web leftovers and follow-up (2)

**Files:** `apps/web/src/components/builder/GenerateWorkflowPanel.tsx`, `apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/pages/ExecutionsOverviewPage.tsx` (or the monitoring filter component), `translations.ts`, related e2e specs.

- [ ] **Step 1: Failing tests:**
  - ✨ panel: a `needs_input` for a field ending in `.config.to` pre-fills the answer box with the signed-in user's e-mail (editable);
  - monitoring filters: `getByLabel('Trạng thái')` resolves to the status `<select>` and its accessible name is exactly the label (bind `htmlFor`/`id` instead of a wrapping `<label>`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Delete the dead `generatePrompt` handoff in `WorkflowBuilderPage`. Remove translation keys with no reference in `apps/web/src` (check each key with grep, including dynamic `t(\`prefix.${x}\`)` prefixes; keep those).
- [ ] **Step 4:** Run the touched specs plus `tsc` and `build` → PASS.
- [ ] **Step 5:** Commit `chore(web): week 5 leftovers and monitoring filter labels`; update `docs/work_logs/K/web/shared-templates-web.md`.

---

## Lane W6-C3: stop a run, run expressions (+ N8, follow-ups 1, 3, 4)

### Task 1: Cancel request (store + service + API)

**Files:**
- Create: `services/workflow-service/src/main/resources/db/migration/V15__execution_cancel_request.sql` (`ALTER TABLE workflow_executions ADD COLUMN cancel_requested_at TIMESTAMPTZ;`)
- Modify: `.../application/port/out/ExecutionStatePort.java` and `.../infrastructure/persistence/repository/ExecutionStateAdapter.java`
- Create: `.../application/service/ExecutionCancelService.java`
- Modify: `.../presentation/http/WorkflowExecutionController.java` (`@PostMapping("/{executionId}/cancel")`)
- Modify: gateway `workflow.module.ts` (`@Post(':workflowId/executions/:executionId/cancel')`), `openapi.yaml`
- Test: `ExecutionCancelServiceTest`, an adapter test next to `ExecutionLeaseTest`, controller HTTP test, gateway spec

**Interfaces:**
- Produces on the port: `CancelResult requestCancel(UUID workflowId, UUID executionId, Instant at)` with `enum CancelResult {CANCELLED, REQUESTED, ALREADY_FINISHED, NOT_FOUND}`. QUEUED → `UPDATE … SET status='CANCELLED', finished_at=? WHERE id=? AND status='QUEUED'`, then the same terminal bookkeeping as other terminal transitions (finished listener; no notification, see Task 2). RUNNING/WAITING → `UPDATE … SET cancel_requested_at=? WHERE id=? AND status IN ('RUNNING','WAITING') AND cancel_requested_at IS NULL` (an already-requested run returns REQUESTED). Also produces `boolean isCancelRequested(UUID executionId)`.
- `ExecutionCancelService.cancel(UUID ws, UUID wf, UUID executionId, UUID actor) -> CancelResult` requires `WORKFLOW_RUN`; NOT_FOUND → 404; ALREADY_FINISHED → 409 `EXECUTION_ALREADY_FINISHED`.
- HTTP: 202 `{status: "CANCELLED"|"CANCEL_REQUESTED"}`.

- [ ] **Step 1: Failing tests:** queued → CANCELLED; running → REQUESTED and the column set; SUCCESS → ALREADY_FINISHED and status unchanged (Review Focus 4); another workflow's execution id → NOT_FOUND; missing `WORKFLOW_RUN` → 403; gateway forwards the route.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(workflow): request cancellation of an execution`.

### Task 2: Runner honours the flag; CANCELLED sends no failure notification

**Files:** `.../application/execution/ExecutionRunner.java` (main loop and a new `finalizeCancelled`), `ExecutionStateAdapter.recordTerminalNotification`, tests next to the existing runner tests.

- [ ] **Step 1: Failing tests:**
  - a two-node run with the flag set after node 1 commits → node 2 CANCELLED, execution CANCELLED, error `{code:"CANCELLED_BY_USER"}`, and node 2's executor is never called;
  - a CANCELLED terminal transition writes no `notification_outbox` row and still calls the `ExecutionFinishedListener`;
  - FAILED still writes `workflow.failed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. At the top of each `while` turn, check `isCancelRequested`; when set, stop scheduling. Once `running` is empty, call `finalizeCancelled`, built like `finalizeFailure` with `ExecutionStatus.CANCELLED`. Ponytail note: checking once per loop turn costs one indexed read per node completion, which is fine at the thesis scale.
- [ ] **Step 4:** Run `./mvnw verify` → PASS (minus known environment-only failures).
- [ ] **Step 5:** Commit `feat(workflow): runner stops cancelled executions`.

### Task 3: Run expressions

**Files:** `.../domain/mapping/MappingContext.java`, `MappingResolver.java`, `DefinitionValidator.java` (if it rejects unknown roots), `ExecutionRunner.java:378` (pass run info), the execution snapshot (add `workflowName` if absent), `apps/web/src/lib/variablePaths.ts` / `VariablePicker.tsx`, the AI generation prompt (`GENERATE_SYSTEM`), tests `MappingResolverTest`.

**Interfaces:**
- `record RunInfo(UUID runId, UUID workflowId, String workflowName, Instant now)` in `domain.mapping`. `MappingContext` gains a `RunInfo run` component (nullable); the existing 3-arg constructor stays and passes `null`.
- Roots: `now` → `run.now().toString()`; `run.id` → runId string; `workflow.id`, `workflow.name`. With `run == null` these throw `MappingException` "not available outside a run".

- [ ] **Step 1: Failing tests:**
  - with a fixed `Instant.parse("2026-10-09T03:00:00Z")`, `"Sent {{ now }}"` → `"Sent 2026-10-09T03:00:00Z"`; `{{ run.id }}` and `{{ workflow.name }}` resolve;
  - `{{ variables.now }}` and `{{ nodes.now.output.x }}` still resolve as before (Review Focus 5);
  - the validator accepts a definition that uses `{{ workflow.name }}`;
  - the web picker shows the "Lần chạy" group with the four entries.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; the runner builds `RunInfo` with `clock.instant()` when it resolves each node. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(workflow): now, run.id, workflow.id and workflow.name expressions`.

### Task 4: Stop button on run detail

**Files:** `apps/web/src/pages/LiveExecutionDetailPage.tsx`, `apps/web/src/api/workflow-v1.api.ts` (`cancelExecution(workflowId, executionId)`), `translations.ts`, `apps/web/e2e/execution-cancel.spec.ts` (Playwright port 4184).

- [ ] **Step 1: Failing test:** RUNNING run shows "Dừng"; confirm dialog text says the current step finishes first; POST `.../cancel` → 202 `CANCEL_REQUESTED` → badge "Đang dừng…", then a later poll returns CANCELLED → badge "Đã dừng"; SUCCESS run shows no button.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): stop a running execution`.

### Task 5: N8 step names and follow-ups (1), (3), (4)

**Files:** `WorkflowGenerationService.java` and its prompt; the LONG_RUNNING message builder (`AlertEvaluator` / sweeper); the workspace-access path that answers 403 for deleted workspaces; `services/notification-service/test/runtime.integration.cjs`.

- [ ] **Step 1: Failing tests:**
  - generated drafts carry `editorState.nodes.<id>.name` in the prompt's language (the model returns a `name` per node; fallback is the node type's VI label, never the raw id);
  - a LONG_RUNNING alert for a still-running run says "đã chạy hơn N giây";
  - GET of a workflow in a soft-deleted workspace → 404;
  - the notification runtime list includes `monitoring.alert.repeated_failures` and `monitoring.alert.long_running` (use the exact type names from `notification-catalog.ts`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run workflow-service `verify`, notification-service `test` and `test:e2e` → PASS.
- [ ] **Step 5:** Commit `fix: AI step names, long-running wording, deleted-workspace 404, notification runtime types`; update `docs/work_logs/K/workflow/execution-cancel-and-run-expressions.md`.

---

## Merge order and coordinator checks

1. C1 → `week6`, then C3 (union `openapi.yaml` and `workflow.module.ts`), then C2. Each merge: `detect_changes` on the main checkout, the lane's tests again, `git diff --check`.
2. After all three: second-stack check, then a live check on Neon `dev-k` (spec section 10), and the e2e-audit section 10 entry.
3. Then W6-B gets its own short plan.
