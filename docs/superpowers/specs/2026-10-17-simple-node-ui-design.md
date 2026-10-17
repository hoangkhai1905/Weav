# Simple node UI: settings and data passing (design)

Date: 2026-10-17. Owner: K. Status: approved in chat, spec under review. Branch: `feature/simple-node-ui` from `dev`.

## 1. Goal

A person who has never used an automation tool opens a step in the builder and knows what to fill in and how to use data from earlier steps, without docs and without knowing the `{{ }}` syntax.

Success test: a first-time user builds "when a Gmail arrives, send its subject and sender to Telegram" with no help, never typing `{{`, and publishes with no field errors. This is both a Playwright journey and the live demo check.

## 2. Scope

In (priority order, before the 2026-10-31 freeze):

1. Filling a step's settings.
2. Passing data between steps.

Out (later, if time): choosing a step (palette), knowing whether it works (step testing, run results). Mobile is not changed, but the schema hints in section 4 are reusable by it.

Constraints (agreed):

- Same power, clearer. No node is removed or merged; no config field is renamed or dropped. Saved workflows and templates keep working unchanged.
- Vietnamese, non-technical users first. English stays correct.
- Backend: additive only. One new optional schema keyword that the workflow-service accepts and ignores at runtime. No change to execution, storage or the public API.

## 3. Current state (2026-10-17, `dev` @ `c3b61bb7`+)

- 26 node types (`apps/web/src/lib/nodeLabels.ts`, `lib/constants/nodeCatalog.ts`); config schemas in `packages/workflow-schema/nodes/<type>.json`, bundled into the web (`lib/nodeSchemas.ts`) and loaded by workflow-service (`ClasspathNodeSchemaSource`, which refuses unknown keywords).
- Inspector (`pages/WorkflowBuilderPage.tsx`, ~3160 lines): about half the nodes render through `components/builder/SchemaField.tsx` (`SCHEMA_FORMS`), the rest through hand-written blocks plus special editors (Schedule, Condition, Switch, DataSet, KeyValue, Attachments, ControlBot).
- Labels come from i18n `builder.field.<type>.<name>` with `_hint` help (`lib/i18n/translations.ts`); several are jargon ("Schedule / Cron", "AI Extract Core", "Extract structured JSON"), some descriptions are wrong (Gmail "Dispatch notifications to channels").
- Raw ids are visible: inspector node-id chip, step ids in the variable picker, `nodes[<id>].config.<field>` in readiness and publish errors (`lib/nodeReadiness.ts`, `lib/publishErrors.ts`). `nodeReadiness.ts` hand-copies the server's required fields.
- Data passing: `MappingTextField` already renders `{{ }}` as named chips with a "+ Data" menu (good). `VariablePicker` is a collapsed "Insert variable" bar that needs a focused field first ("no target" otherwise) and lists steps with raw ids.

## 4. Settings

### 4.1 Schema hint

One optional, language-neutral property keyword:

```json
"replyToMessageId": { "type": "string", "x-weav-ui": { "advanced": true } }
```

- `advanced: true` puts the field under "Thêm tùy chọn". Absent means basic. No other `x-weav-ui` keys for now.
- Field order is the order of `properties` in the schema.
- workflow-service: add `x-weav-ui` to the allowed keywords in `ClasspathNodeSchemaSource` and ignore it; it must reject a non-object `x-weav-ui` and unknown keys inside it (fail fast, same style as the other extensions). Schema-loader test covers accept, ignore and reject. `packages/workflow-schema/README.md` documents it.
- Wording is not in the schema (schema titles stay English, for developers and the AI generator); it is in i18n (4.2).

### 4.2 Wording (i18n, vi + en)

For every field of the 26 nodes:

- `builder.field.<type>.<name>`: plain label, no `ID`/`JSON`/`cron`/`payload` (e.g. "Chat ID" -> "Gửi tới (chat)").
- `builder.field.<type>.<name>_hint`: one line saying what it is for.
- New `builder.field.<type>.<name>_example`: shown as the placeholder, "Ví dụ: ..." / "e.g. ...".

Node names and descriptions (`builder.node.*`, `*_desc`) are rewritten too (e.g. "AI Extract Core" -> "Lấy thông tin bằng AI"; Gmail send no longer says "channels"). Existing keys are reworded, never renamed, so other references and `localization.spec.ts` keep resolving.

### 4.3 FieldShell

New `components/builder/FieldShell.tsx`, the one look for an ordinary field:

- label, a required marker for fields in the schema's `required`, the help line, the input (children), an inline error, and the "+ Dữ liệu" button (section 5) for `x-weav-template` fields.
- `SchemaField` renders through it. The plain text/number/select fields inside the hand-written blocks switch to it. The special editors keep their bodies and sit inside the same shell styling.
- Accessibility: label bound to the input (`htmlFor`/`aria-labelledby`), help and error via `aria-describedby`, the data button has an accessible name ("Chèn dữ liệu vào <label>").

### 4.4 "Thêm tùy chọn"

Each node renders its `advanced` fields in one collapsed `<details>` after the basic fields, labelled "Thêm tùy chọn (N)". It opens automatically when one of its fields has a value or an error. Existing test ids `email-advanced`, `telegram-advanced`, `http-advanced` stay on these sections.

Initial `advanced` fields (finalised during 4.2): email Cc/Bcc/Reply-To/sender name/reply-to message/attachments; Telegram parse mode/silent/reply-to; HTTP optional fields (headers, timeout); Calendar optional fields; Gmail trigger poll interval and search query; Drive optional fields.

### 4.5 No raw ids

The inspector node-id chip moves into a collapsed "Chi tiết kỹ thuật" footer at the bottom of the config tab (keeps `inspector-node-id` and the copy button).

### 4.6 Plain errors and readiness

- Readiness and publish errors name the step by its display name and the field by its 4.2 label: "Bước 'Gửi tin Telegram': cần điền 'Tin nhắn'". Raw `nodes[...]`/`config.x` text is not shown; unknown error codes keep the current generic message plus the step name.
- For nodes rendered from schema, the required-field list comes from the schema `required` instead of the hand copy in `nodeReadiness.ts`. Hand-written nodes keep their current rules.

## 5. Data passing

### 5.1 "+ Dữ liệu" per field

Every `x-weav-template` field gets a "+ Dữ liệu" button from `FieldShell`. It opens a popover anchored to that field; picking an item inserts a chip at the cursor, or at the end when the field has no cursor. No focus-first step and no "no target" message. Chips are the existing `MappingTextField` chips.

### 5.2 Popover content

- "Từ các bước trước": one group per step that runs before this one (graph predecessors only), labelled with the step's display name and icon, nearest first. Items are plain output labels (Gmail trigger: "Tiêu đề email", "Người gửi", "Nội dung tóm tắt").
- "Khác": "Thời điểm hiện tại" (`now`), "Mã lượt chạy" (`run.id`), "Tên quy trình" (`workflow.name`).
- Manual and webhook triggers (free-form input): an entry "Dữ liệu gửi vào" with a name box and an example, instead of an unexplained key field.
- A search box when there are more than 8 items. No raw ids or `nodes.x.output.y` paths are shown.
- Items keep the test id `variable-option`.

### 5.3 Chips and non-text fields

- Chip text: "<step name> › <output label>". A chip whose step no longer exists (or no longer runs before this step) is amber: "Dữ liệu này không còn — chọn lại".
- Integer, boolean and enum fields that accept data keep the existing literal/mapping switch, relabelled "Dùng dữ liệu từ bước trước".

### 5.4 Remove the bar, fill output labels

- The collapsed "Insert variable" bar (`VariablePicker` at the top of the config tab) is removed; specs using `variable-picker`/`variable-picker-toggle` are updated to the popover.
- Every node's outputs get plain vi/en labels (catalog `outputs` + i18n), filling the gaps.

### 5.5 Stretch: sample values

If time allows: next to each output, a short sample value from the workflow's latest run (one fetch of the latest execution detail; respects `outputTruncated`). Separable; planned last.

## 6. Delivery

One branch per batch, merged into `dev` in order, each reviewed by a different agent, tested and live-checked before merge:

1. Foundation: backend `x-weav-ui` allow-list + test + README; `FieldShell`; "Thêm tùy chọn"; technical footer; plain readiness/publish errors; schema-derived required list.
2. Data popover: section 5.1-5.4.
3. Wording: section 4.2 and the `x-weav-ui` flags for all 26 nodes (text-heavy; translation file has one owner at a time).
4. Stretch: 5.5.

Batches touch `WorkflowBuilderPage.tsx` and `translations.ts`, so they run one after another, never in parallel on those files. Target: 1-3 merged by 2026-10-24, then a week for the live check, fixes and stale specs before the freeze.

## 7. Testing

- New Playwright journey (success test in section 1): Gmail trigger -> Telegram send, data inserted only via "+ Dữ liệu", publish succeeds, no `{{` typed.
- Cases: "Thêm tùy chọn" collapsed by default and auto-open with a value; plain-language publish error names the step and field; deleted-step chip shows the amber state.
- Keep green: `workflow-ui`, `builder-correctness`, `editor-controls`, `w7-nodes`, `ocr-builder`, `ai-builder`, `templates`, `localization`, `workflow-catalog-v1`, `control-bot` and the other builder specs; update the 7 cases in `dashboard-real-data.spec.ts`/`localization.spec.ts` that already fail on `dev` after the UI redesign.
- workflow-service `mvnw verify` for the allow-list change; web `tsc -p tsconfig.app.json`, eslint, build.
- Live check in the in-app browser against the dev stack on Neon dev-k.

## 8. Risks

- `WorkflowBuilderPage.tsx` is large and every batch touches it: batches are sequential; extract only what the batch needs (FieldShell, the popover), no broader refactor.
- i18n churn: reword, never rename keys.
- A wrong `advanced` flag hides a field a user needs: required fields are never advanced, and the section opens when it holds a value or an error.
- The AI generator and templates read schema titles and field names, which do not change.
