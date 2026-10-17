# Simple Node UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time user can fill in any step's settings and use data from earlier steps without docs and without typing `{{`.

**Architecture:** One optional schema keyword (`x-weav-ui.advanced`) marks fields that go under "Thêm tùy chọn"; wording lives in i18n (`builder.field.<type>.<name>`, `_hint`, new `_example`). A small `FieldShell` gives every ordinary field one look; the existing per-field "+ Data" menu of `MappingTextField` becomes the only data-insertion path (the "Insert variable" bar goes). Errors and readiness name steps and fields by their display labels.

**Tech Stack:** React + Vite + TypeScript (apps/web), Playwright (no unit runner in web; do not add one), Spring Boot / JUnit 5 (workflow-service schema loader), JSON Schema files in `packages/workflow-schema/nodes`.

**Spec:** `docs/superpowers/specs/2026-10-17-simple-node-ui-design.md`

Deviation from the spec, decided while planning: the per-field "+ Data" menu already exists in `MappingTextField` with test ids `mapping-data-toggle` / `mapping-data-menu` / `mapping-data-item`; the plan improves that menu instead of building a new popover, and keeps those ids (the spec's `variable-option` id is not used).

## Global Constraints

- Same power, clearer: no node removed or merged; no config field renamed or dropped; saved workflows and templates load and publish unchanged.
- Vietnamese first, English correct. Labels contain no `ID`, `JSON`, `cron`, `payload`, `node`, `config` (product names like Gmail, Telegram, Webhook are fine).
- i18n: reword existing keys, never rename or delete them. New keys are added in BOTH the `vi` and `en` blocks of `apps/web/src/lib/i18n/translations.ts`.
- Backend: additive only; `x-weav-ui` is accepted and ignored at runtime.
- No raw ids or mapping paths (`nodes.x.output.y`, `config.x`, `nodes[x]`) in user-facing text, except inside the collapsed "Chi tiết kỹ thuật" footer.
- A field listed in a schema's `required` is never `advanced`.
- `apps/web/src/pages/WorkflowBuilderPage.tsx` and `translations.ts` are edited by one task at a time; tasks run in order.
- Keep existing test ids (`email-advanced`, `telegram-advanced`, `http-advanced`, `inspector-node-id`, `mapping-data-toggle`, `mapping-data-menu`, `mapping-data-item`, `mapping-chip`, `schema-config`, `integration-readiness`, `workflow-inspector`).
- Verify commands (from repo root, Git Bash): web types `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`; lint `pnpm --dir apps/web exec eslint <files>` (never `lint --fix`); Playwright `VITE_API_MODE=http pnpm --dir apps/web exec playwright test <spec> --project=chromium`; backend `cd services/workflow-service && JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw -q test -Dtest=<Test>`.
- Agents do not commit; the coordinator commits per task after review (`git commit -m "summary" -m "description"` + Co-Authored-By line), running GitNexus `detect_changes` first.

## Review Focus

1. An existing workflow that already has a value in an advanced field: its "Thêm tùy chọn" section must open by itself so the value is not hidden. Test in Task 2.
2. A chip pointing at a step that was deleted, or that no longer runs before this step after an edge change: amber chip with "Dữ liệu này không còn — chọn lại", and the saved value is untouched. Test in Task 5.
3. A mapping in a non-text field (integer `amount: "{{ nodes.a.output.n }}"` in `format.datetime`): it round-trips through the inspector unchanged and shows as a chip, not as an invalid number. Test in Task 6.
4. A publish error for a field with no i18n label (e.g. `UNKNOWN_CONFIG_FIELD` on a legacy key): the message falls back to the schema title, then the raw field name, never "undefined" or a `builder.field.` key. Test in Task 4.
5. Switching the language vi <-> en with the inspector open: labels, hints and examples switch, and no visible text in the inspector starts with `builder.` for any node type. Test in Task 7.

---

## Batch 1 — Foundation (branch `feature/simple-node-ui`)

### Task 1: `x-weav-ui` schema keyword (backend + web type + README)

**Files:**
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/definition/ClasspathNodeSchemaSource.java` (`FIELD_KEYWORDS`, `field(...)`, `parse(...)`)
- Test: `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/NodeConfigSchemasTest.java`
- Modify: `packages/workflow-schema/README.md` (Rendering table + supported keywords)
- Modify: `apps/web/src/lib/nodeSchemas.ts`

**Interfaces:**
- Produces (web): `SchemaProperty['x-weav-ui']?: { advanced?: boolean }`; `isAdvanced(nodeType: string, name: string): boolean` exported from `nodeSchemas.ts` (false when the type or field is unknown).

- [ ] **Step 1: Write failing tests** in `NodeConfigSchemasTest` using `ClasspathNodeSchemaSource.parse("x.test.json", json)` like the existing reject cases (same exception type they assert):
  - `acceptsUiAdvancedHint`: a field `{"type":"string","x-weav-ui":{"advanced":true}}` parses.
  - `rejectsUiHintThatIsNotAnObject`: `"x-weav-ui": true` throws.
  - `rejectsUnknownUiHintKey`: `{"x-weav-ui":{"order":1}}` throws.
  - `rejectsNonBooleanAdvanced`: `{"x-weav-ui":{"advanced":"yes"}}` throws.
  - `rejectsAdvancedRequiredField`: field `text` listed in `required` with `{"x-weav-ui":{"advanced":true}}` throws; message contains `text`.
- [ ] **Step 2: Run** `./mvnw -q test -Dtest=NodeConfigSchemasTest` -> the 5 new tests FAIL.
- [ ] **Step 3: Implement**: add `"x-weav-ui"` to `FIELD_KEYWORDS`; in `field(...)` require an object whose only allowed key is `advanced` (boolean); in `parse(...)` reject a required field whose `x-weav-ui.advanced` is true. Nothing is stored in `NodeConfigSchema`.
- [ ] **Step 4: Run** the test class -> PASS; then `./mvnw verify` -> 0 failures (CLAUDE.md env-only errors allowed).
- [ ] **Step 5: Web + docs**: type and `isAdvanced` in `nodeSchemas.ts`; README: a table row (`x-weav-ui: {advanced: true}` -> shown under "More options"; never on a required field; ignored by the backend) and the keyword in the supported list. `tsc` clean.
- [ ] **Step 6: Commit** `feat(schema): x-weav-ui advanced hint (accepted, ignored at runtime)`.

### Task 2: `FieldShell`, `fieldCopy`, `AdvancedSection`; schema forms use them

**Files:**
- Create: `apps/web/src/lib/fieldCopy.ts`
- Create: `apps/web/src/components/builder/FieldShell.tsx`
- Create: `apps/web/src/components/builder/AdvancedSection.tsx`
- Modify: `apps/web/src/components/builder/SchemaField.tsx` (label/hint lookup moves to `fieldCopy`; renders inside `FieldShell`; example as placeholder)
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (the `SCHEMA_FORMS` render: basic fields, then advanced fields inside `AdvancedSection`)
- Modify: `packages/workflow-schema/nodes/google.calendar.json` (mark `location` advanced, or the first optional non-required field if `location` does not exist; name it in the report)
- Modify: `translations.ts` (new keys: `builder.cfg.more_options` vi "Thêm tùy chọn ({count})" / en "More options ({count})"; `builder.field.example_prefix` vi "Ví dụ: " / en "e.g. "; `builder.field.discord.send_message.content_example` vi "Đơn hàng mới vừa được tạo" / en "A new order was just placed")
- Test: `apps/web/e2e/simple-node-ui.spec.ts` (new)

**Interfaces:**
- Consumes: `isAdvanced`, `NODE_SCHEMAS` (Task 1).
- Produces:
  - `fieldCopy(nodeType: string, name: string, t: (key: string) => string): { label: string; hint?: string; example?: string }` — label from `builder.field.<type>.<name>`, else schema `title`, else `name`; hint from `..._hint`, else schema `description`; example from `..._example`, undefined when missing (missing = `t(key) === key`, as `pathLabel` does).
  - `hasValueOrError(names: string[], config: Record<string, unknown>, errors?: Record<string, string | undefined>): boolean` in `fieldCopy.ts` (value = not undefined/null/blank string/empty array).
  - `FieldShell` props `{ id: string; label: string; hint?: string; error?: string; required?: boolean; testId?: string; children: (a11y: { id: string; describedBy?: string }) => React.ReactNode }` — renders `<label htmlFor={id}>`, a visual `*` (`aria-hidden`) when required, hint and error paragraphs whose ids form `describedBy`; the child puts `id`, `aria-describedby` and `aria-required` on its input. For `MappingTextField` pass `labelledBy` (contenteditable) instead of relying on `htmlFor`.
  - `AdvancedSection` props `{ count: number; defaultOpen: boolean; testId?: string; children: React.ReactNode }` — `<details>` with summary `t('builder.cfg.more_options')` (`{count}` replaced), open initially when `defaultOpen`; renders nothing when `count === 0`.

- [ ] **Step 1: Failing Playwright tests** in `simple-node-ui.spec.ts` (copy the session and route stubbing of `w7-nodes.spec.ts`; add steps via `workflow-add-step` + `workflow-palette-item[data-node-type=...]`):
  - `schema fields show label, hint and example`: add `discord.send_message`; the content field has its label, a hint line, and placeholder "Ví dụ: Đơn hàng mới vừa được tạo".
  - `advanced fields are collapsed until they hold a value` (Review Focus 1): add `google.calendar`; the field marked advanced is inside a closed `<details>` "Thêm tùy chọn (1)"; load a stubbed saved workflow where that field has a value -> the section is open and the value visible.
- [ ] **Step 2: Run** the spec -> FAIL.
- [ ] **Step 3: Implement** the three units; switch `SchemaField` and the `SCHEMA_FORMS` render to them (advanced = `isAdvanced`, `defaultOpen = hasValueOrError(advancedNames, config, errors)`).
- [ ] **Step 4: Run** `simple-node-ui`, `w7-nodes`, `control-bot`, `workflow-ui` specs -> PASS; `tsc`, eslint on changed files clean; `NodeConfigSchemasTest` still PASS.
- [ ] **Step 5: Commit** `feat(web): FieldShell, plain field copy and "Thêm tùy chọn" for schema forms`.

### Task 3: Hand-written forms use `FieldShell`/`AdvancedSection`; technical footer

**Files:**
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (hand-written blocks for telegram.send_message, http.request, email.send, google.sheets, the AI nodes, ocr.extract, trigger.schedule/webhook/manual, weav.workflow; inspector header node-id chip)
- Modify: `translations.ts` (`builder.cfg.technical` vi "Chi tiết kỹ thuật" / en "Technical details")
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

**Interfaces:**
- Consumes: `FieldShell`, `AdvancedSection`, `fieldCopy`, `hasValueOrError` (Task 2).

- [ ] **Step 1: Failing tests**:
  - `email extras sit under Thêm tùy chọn and open when set`: on a new email step `email-advanced` is a closed `<details>` whose summary starts "Thêm tùy chọn ("; with a stubbed config having `cc` set it is open.
  - `node id lives in the technical footer`: `inspector-node-id` is hidden until "Chi tiết kỹ thuật" is expanded; then it shows the id and the copy button still works (existing assertion pattern).
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**: wrap each plain text/number/select field of the hand-written blocks in `FieldShell` (labels via `fieldCopy`); replace the advanced collapsibles (`email-advanced`, `telegram-advanced`, `http-advanced`) with `AdvancedSection`, keeping their test ids and current field membership; special editors (SchedulePicker, ConditionEditor, SwitchEditor, DataSetEditor, KeyValueEditor, AttachmentsEditor, ControlBot inspectors) keep their bodies. Move the node-id chip into a `<details>` "Chi tiết kỹ thuật" at the bottom of the config tab.
- [ ] **Step 4: Run** `simple-node-ui`, `workflow-ui`, `builder-correctness`, `editor-controls`, `ocr-builder`, `ai-builder` -> PASS (change a selector only where the node-id chip moved; list such changes in the report); `tsc` + eslint clean.
- [ ] **Step 5: Commit** `feat(web): one field look in hand-written step forms; node id in technical details`.

### Task 4: Plain-language errors and readiness

**Files:**
- Modify: `apps/web/src/lib/publishErrors.ts`
- Modify: `apps/web/src/lib/nodeReadiness.ts`
- Modify: callers of `describeIssues` and the readiness banner (`integration-readiness`) in `WorkflowBuilderPage.tsx`
- Modify: `translations.ts`
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

**Interfaces:**
- Consumes: `fieldCopy` (Task 2), `NODE_SCHEMAS`.
- Produces:
  - `describeIssues(details: WorkflowErrorDetail[], t: (key: string) => string, steps: ReadonlyArray<{ id: string; type: string; name: string }>): WorkflowIssue[]` (`WorkflowIssue` unchanged). Text = `t('builder.err.step_named')` with `{step}` = the step's display name (fallback: id) + `': '` + meaning. For `REQUIRED_FIELD_MISSING` with a field, meaning = `t('builder.err.required_field')` with `{field}` = `fieldCopy(...).label`; for other codes with a field: `'<label>' — <meaning>`; without a step: meaning only (as today).
  - `requiredFields(nodeType: string, config: Record<string, unknown>): string[]` exported from `nodeReadiness.ts` = unique union of `NODE_SCHEMAS[type]?.required ?? []` without `connectionId` (it keeps its own authorization state) and the existing conditional rules (`CONNECTION_NODE_FIELDS`, `FORMAT_NODE_FIELDS`). `getNodeReadinessBadge` uses it; its signature is unchanged.
  - `missingFieldLabels(nodeType: string, config: Record<string, unknown>, t: (key: string) => string): string[]` — labels of blank `requiredFields`.
  - New keys (vi / en): `builder.err.step_named` "Bước '{step}'" / "Step '{step}'"; `builder.err.required_field` "cần điền '{field}'" / "fill in '{field}'"; `builder.readiness.missing` "Cần điền: {fields}" / "Fill in: {fields}".
- [ ] **Step 1: Failing tests**:
  - `publish error names the step and the field`: stub publish -> 400 with `details: [{ field: 'nodes[tg1].config.text', message: 'REQUIRED_FIELD_MISSING: text is required' }]` for a Telegram step named "Gửi tin Telegram"; the error shows `Bước 'Gửi tin Telegram': cần điền '` + the Telegram text label + `'`, and contains neither `nodes[` nor `config.`.
  - `unknown field falls back to a name, never a key` (Review Focus 4): `field: 'nodes[tg1].config.legacyThing'`, `UNKNOWN_CONFIG_FIELD: ...` -> text contains `legacyThing`, not `undefined`, not `builder.field.`.
  - `readiness banner lists missing fields by label`: a new Telegram step without text shows `Cần điền:` followed by the message label.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**; update every `describeIssues` call site to pass the steps.
- [ ] **Step 4: Run** `simple-node-ui`, `builder-correctness`, `workflow-ui`, `w7-nodes` -> PASS; `tsc` + eslint clean.
- [ ] **Step 5: Commit** `feat(web): errors and readiness name steps and fields in plain words`.

**Batch 1 gate:** different-agent review of Tasks 1-4; workflow-service `mvnw verify`; web build; merge into `dev` only on K's go-ahead.

## Batch 2 — Data passing

### Task 5: `DataMenu` — nearest first, search, "Khác", named input, chip states

**Files:**
- Create: `apps/web/src/components/builder/DataMenu.tsx` (extracted from `MappingTextField.tsx`, the menu at ~379-425)
- Modify: `apps/web/src/components/builder/MappingTextField.tsx`
- Modify: `apps/web/src/lib/variablePaths.ts`
- Modify: `translations.ts`
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

**Interfaces:**
- Produces:
  - `DataMenu` props `{ groups: VariableGroup[]; onPick: (mapping: string) => void; onClose: () => void }`, keeping `role="menu"`, `data-testid="mapping-data-menu"`, items `data-testid="mapping-data-item"` with `data-path`.
  - `outputLabel(group: VariableGroup, path: string, t: (key: string) => string): string` in `variablePaths.ts` = `pathLabel(...)`, else the last segment humanised (`firstName` -> "First name", `attachments[0]` -> "Attachments 1"); never the full raw path.
  - Chip text `"<group.label> › <outputLabel>"`; an orphan chip (unknown group or path) shows `t('builder.var.missing')` vi "Dữ liệu này không còn — chọn lại" / en "This data is gone — pick it again" in the existing warn style. New keys also: `builder.var.other` vi "Khác" / en "Other"; `builder.var.search` vi "Tìm dữ liệu" / en "Search data"; `builder.var.named_input` vi "Dữ liệu gửi vào" / en "Incoming data"; `builder.var.named_input_hint` vi "Tên trường, ví dụ ten_khach" / en "Field name, e.g. customer_name".
- [ ] **Step 1: Failing tests**:
  - `data menu lists the nearest step first with plain labels`: Gmail trigger -> AI summarize -> Telegram; open `mapping-data-toggle` on the Telegram message: the first group is the AI step, then the Gmail trigger; no item text matches `/nodes\.|output\.|\{\{/`.
  - `search appears with more than 8 items`: with the Gmail trigger a search box labelled "Tìm dữ liệu" is shown; typing "nguoi gui" (no diacritics) leaves only sender items.
  - `Khác group offers time, run and workflow name`: items with `data-path` `now`, `run.id`, `workflow.name` under the "Khác" heading.
  - `orphan chip turns amber and keeps the value` (Review Focus 2): map Telegram text to a step, delete that step -> the chip reads "Dữ liệu này không còn — chọn lại"; the save request body still has the original mapping string.
  - `manual trigger offers a named input`: with `trigger.manual`, the menu shows "Dữ liệu gửi vào" with a name box; `ten_khach` + confirm inserts `{{ trigger.input.ten_khach }}` as a chip; `ten khach` (fails `isValidPath`) disables confirm.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**: extract; order groups nearest first; search when total items > 8 (label match, case- and diacritic-insensitive via `normalize('NFD').replace(/\p{M}/gu, '')`); "Khác" group from `RUN_PATHS`; named input for `group.freeForm`; chip label and orphan text. Check where the builder builds `groups`: if it is not limited to graph predecessors of the selected step, limit it there.
- [ ] **Step 4: Run** `simple-node-ui`, `workflow-ui`, `w7-nodes`, `ocr-builder`, `control-bot` -> PASS; `tsc` + eslint clean.
- [ ] **Step 5: Commit** `feat(web): plain data menu (nearest step first, search, run values, named input)`.

### Task 6: One data path everywhere; remove the "Insert variable" bar

**Files:**
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (plain inputs of `x-weav-template` fields -> `MappingTextField`; remove `<VariablePicker>` and its insert plumbing if nothing else uses it)
- Modify: `apps/web/src/components/builder/SchemaField.tsx` (literal/mapping switch label)
- Delete: `apps/web/src/components/builder/VariablePicker.tsx` (only if unused afterwards)
- Modify: specs that use `variable-picker`, `variable-picker-toggle`, `variable-option` (switch to `mapping-data-toggle` / `mapping-data-item`)
- Modify: `translations.ts` (reword the existing literal/mapping switch key to vi "Dùng dữ liệu từ bước trước" / en "Use data from an earlier step"; add `builder.field.use_data` only if no such key exists)
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

- [ ] **Step 1: Failing tests**:
  - `every data field has its own + Dữ liệu button`: `http.request` (url, body), `google.sheets` (values), `email.send` (to, subject, body) each field has a `mapping-data-toggle` inside its `FieldShell`; `variable-picker` is absent.
  - `mapping in a number field round-trips` (Review Focus 3): stubbed `format.datetime` with `amount: "{{ nodes.a.output.n }}"` shows "Dùng dữ liệu từ bước trước" mode with a chip; saving sends the identical string.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**; grep for other `VariablePicker` / `useFieldTarget` users before deleting.
- [ ] **Step 4: Run** every builder spec in spec section 7 -> PASS; `tsc` + eslint + `pnpm --dir apps/web build` clean.
- [ ] **Step 5: Commit** `feat(web): every data field gets its own + Dữ liệu; drop the Insert variable bar`.

### Task 7: Output labels for every node; no leaked keys

**Files:**
- Modify: `translations.ts` (`builder.var.path.<type>.<path>` vi + en for every path in `NODE_CATALOG[].outputs`)
- Modify: `apps/web/src/lib/constants/nodeCatalog.ts` only if an output path is missing from a node's `outputs`
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

- [ ] **Step 1: Failing tests**:
  - `every output path has a vi and en label`: in Node context import `NODE_CATALOG` and `TRANSLATIONS`; for each type/path both locales have `builder.var.path.<type>.<path>`. If the import chain reaches `import.meta.glob`, run the check in the page instead (`page.evaluate` against a module the app already loads).
  - `no builder. keys leak in either language` (Review Focus 5): for each palette node type, add it, open the inspector, switch vi -> en -> vi; `workflow-inspector` inner text never matches `/\bbuilder\.[a-z_]+\./`.
- [ ] **Step 2: Run** -> FAIL (missing labels).
- [ ] **Step 3: Add** the labels (plain words: "Tiêu đề email", "Người gửi", "Nội dung tóm tắt", ...).
- [ ] **Step 4: Run** the spec -> PASS; `localization.spec.ts` new failures = none (its pre-existing failures are fixed in Task 11).
- [ ] **Step 5: Commit** `feat(web): plain labels for every step output`.

**Batch 2 gate:** different-agent review; build; live check of the data menu in the in-app browser on the dev stack.

## Batch 3 — Wording and advanced flags

Copy rules for Tasks 8-9 (plus Global Constraints): label <= 4 words; hint = one sentence on what it is for; example = a realistic Vietnamese value (vi) / English value (en); node name = verb + object ("Gửi tin Telegram", "Lấy thông tin bằng AI"); node description = one sentence a non-technical person understands. Mark `advanced` only optional fields a first-time user can skip.

### Task 8: Triggers, messaging and HTTP nodes

**Files:**
- Modify: `packages/workflow-schema/nodes/{trigger.manual,trigger.schedule,trigger.webhook,trigger.telegram,trigger.gmail,trigger.workflow_event,email.send,telegram.send_message,discord.send_message,slack.send_message,teams.send_message,http.request,weav.workflow}.json` (`x-weav-ui` only)
- Modify: `translations.ts` (`builder.node.<…>`, `_desc`, `builder.field.<type>.<name>`, `_hint`, `_example`; vi + en)
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

- [ ] **Step 1: Failing test** `wording: triggers and messaging`: for each of these 13 types, every field label in the inspector has a non-empty hint, every `x-weav-template` text field has a placeholder starting "Ví dụ:", and no label matches `/\b(ID|JSON|cron|payload)\b/i`.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Write** the copy and flags (Telegram: `parseMode`, `disableNotification`, `replyToMessageId` advanced; email: `cc`, `bcc`, `replyTo`, sender name, `replyToMessageId`, `attachments` advanced; Gmail trigger: `pollIntervalMinutes`, `query` advanced). Fix the Gmail send description (no "channels") and the manual trigger description (no "JSON").
- [ ] **Step 4: Run** the spec, `localization`, `workflow-ui`, `w7-nodes`, `NodeConfigSchemasTest` -> PASS.
- [ ] **Step 5: Commit** `feat(nodes): plain wording and more-options flags for triggers and messaging`.

### Task 9: Google, logic, data, format, AI and OCR nodes

**Files:**
- Modify: `packages/workflow-schema/nodes/{google.sheets,google.drive,google.calendar,logic.condition,logic.switch,data.set,format.datetime,format.text,ai.extract,ai.classify,ai.summarize,ai.generate,ocr.extract}.json`
- Modify: `translations.ts`
- Test: `apps/web/e2e/simple-node-ui.spec.ts`

- [ ] **Step 1: Failing test** `wording: google, logic, ai, ocr`: same assertions as Task 8 for these 13 types; Calendar "create" shows at most 4 fields before "Thêm tùy chọn".
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Write** the copy and flags ("AI Extract Core" -> "Lấy thông tin bằng AI" / "Pull details with AI"; "Schedule / Cron" -> "Chạy theo lịch" / "Run on a schedule").
- [ ] **Step 4: Run** the spec, `localization`, `ocr-builder`, `ai-builder`, `builder-correctness`, `NodeConfigSchemasTest` -> PASS.
- [ ] **Step 5: Commit** `feat(nodes): plain wording and more-options flags for google, logic, AI and OCR`.

## Batch 4 — Stretch (only if Batches 1-3 are merged by 2026-10-24)

### Task 10: Sample values from the latest run

**Files:** `apps/web/src/components/builder/DataMenu.tsx`; the builder hook that loads executions (reuse the existing `workflowV1Api` execution list/detail calls); `simple-node-ui.spec.ts`.

- [ ] **Step 1: Failing test** `data menu shows a sample from the last run`: stub the latest execution detail with Gmail `subject: "Đơn hàng #42"`; the subject item shows "Đơn hàng #42" (values truncated to 40 chars); with no runs: no sample, no error, no extra request retries.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement**: one fetch of the latest execution per builder open; skip outputs when `outputTruncated` is true.
- [ ] **Step 4: Run** the spec + `workflow-ui` -> PASS.
- [ ] **Step 5: Commit** `feat(web): sample values from the last run in the data menu`.

## Final

### Task 11: First-time journey, stale specs, live check, work log

**Files:**
- Test: `apps/web/e2e/simple-node-ui.spec.ts`, `apps/web/e2e/dashboard-real-data.spec.ts`, `apps/web/e2e/localization.spec.ts`
- Create: `docs/work_logs/K/web/simple-node-ui.md` (from `docs/work_logs/log_template.md`)

- [ ] **Step 1: Journey test** `first-time user: new Gmail -> Telegram without typing {{`: blank workflow, add Gmail trigger + Telegram send via the palette, pick stubbed connections, type a literal chat, insert "Tiêu đề email" and "Người gửi" via "+ Dữ liệu", publish (stubbed 200). The test never types `{{`; the publish request body contains both mappings.
- [ ] **Step 2: Update** the 7 stale cases (`dashboard-real-data.spec.ts` ~46, 172, 191; `localization.spec.ts` ~71, 116, 125, 134) to the redesigned copy, asserting the same behaviour.
- [ ] **Step 3: Run** the full web Playwright suite (`--project=chromium`) -> PASS except failures shown identical on `dev`; `tsc`; build; workflow-service `mvnw verify`.
- [ ] **Step 4: Live check** in the in-app browser on the dev stack (Neon dev-k): the journey by hand with real Gmail + Telegram connections; inspector screenshots in vi and en; console and network free of errors. Record in the work log.
- [ ] **Step 5: Commit** `test(web): first-time journey; specs updated to the redesign copy; work log`; merge into `dev` only on K's go-ahead.
