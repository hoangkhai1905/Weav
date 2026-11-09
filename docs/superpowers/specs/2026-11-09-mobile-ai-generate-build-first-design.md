# Mobile AI generate, build first (Phase 1)

Date: 2026-11-09 · Scope: `apps/mobile`, `services/workflow-service`, `services/api-gateway`, `packages/contracts` · Status: approved design, awaiting plan
Mockup: claude.ai artifact "Mobile AI tạo quy trình" (screens 1, 2 and 5 are this phase).
Web counterpart: `docs/superpowers/specs/2026-11-09-ai-generate-zapier-style-design.md` (merged into `dev` as 75a58913).

## Goal

On mobile, describing a workflow builds the draft at once, like web. The workflow screen then shows which steps still need setup, in red, with a plain reason. Phase 1 sends every red step to the web builder to finish; Phase 2 (later spec) lets the simple ones be fixed in a bottom sheet on the phone.

Success: no questions before the draft exists; the user always knows which steps are unfinished and has one tap to finish each one on the web; Publish is not offered while the server would reject it.

## Decisions (agreed with the user)

| Question | Decision |
| --- | --- |
| Flow | Build first, fix after (same as web). The question-and-answer round goes away on mobile. |
| Where unfinished steps are fixed | Phase 1: on the web, via a link that opens the exact step. Phase 2: simple fields in a bottom sheet on mobile. |
| Source of "which step is unfinished" | A new read-only server endpoint that reuses the publish validator. The server is the source of truth; mobile does not re-implement the rules. |
| Existing connections | Auto-attach when the workspace has exactly one usable connection of the provider a step requires (same rule as web). |

## Backend: readiness endpoint

**Route:** `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/readiness` on the gateway, forwarded to workflow-service `GET /workspaces/{workspaceId}/workflows/{workflowId}/readiness`, following the existing `GET :workflowId` route in `services/api-gateway/src/workflow/workflow.module.ts`.

**Authorization:** the same as reading the workflow (`GET /{workflowId}`). Read-only: it never publishes or changes state.

**Response 200:**

```json
{ "ready": false, "issues": [ { "nodeId": "send_email", "field": "to", "code": "<publish validation code>" } ] }
```

- `ready` is `issues.length === 0`.
- The definition checked is the one publish would use: the current draft, or the latest published version when there is no draft.
- `issues` come from `DefinitionValidator.validatePublish(<that definition>)` (`nodeId`, `field`, `code` of each `ValidationIssue`). `nodeId` and `field` may be `null` for graph-level issues.
- For each `connectionId` the draft references, the attachment check the publish path uses (`WorkspaceConnectionPort.authorizeAttachment`) runs; a failure becomes `{ nodeId, field: "connectionId", code: "CONNECTION_NOT_AUTHORIZED" }` instead of an error response.
- The English `message` is not returned: clients show their own text per `code`/`field`.
- Checks that publish does beyond these (Telegram bot limits, watched workflows) are not part of readiness; publish stays the final authority.

**Errors:** 404 when the workflow does not exist in the workspace, 403 when the caller cannot read it, both in the existing error envelope.

**Contract:** add the operation and its response schema to `packages/contracts/http/workflow/openapi.yaml` and `packages/contracts/http/gateway/openapi.yaml` (additive).

## Mobile changes

### 1. Generator (`apps/mobile/src/app/(app)/ai/generator.tsx`)

- Request: `{ prompt, timezone, allowBlanks: true }`, never `answers`/`connections`.
- On `ready`: auto-attach connections (below), save the draft with the existing `useSaveGeneratedWorkflow`, then `router.replace('/(app)/workflows/<id>')`. The "saved" screen with its own Publish button goes away; publishing happens on the workflow screen.
- On `needs_input` or `unsupported`: a plain notice (needs_input: "AI chưa hiểu rõ mô tả. Hãy nói thêm về:" + the question labels; unsupported: "AI không dựng được quy trình này:" + the reason labels, as on web), the prompt kept, no input fields.
- Generate is disabled while generating or saving; a second tap never creates a second draft.
- If the active workspace changes before the result arrives, the result is dropped (no draft, no navigation).
- `QuestionsForm` and the answer-building code in `ai.answers.ts` that only it uses are removed (Phase 2 builds its own sheet controls).

**Auto-attach:** a pure `autoPickConnections(definition, connections, requiredProvider)` in `apps/mobile/src/features/ai/`, the same behaviour and tests as `apps/web/src/lib/autoPickConnections.ts`: attach only when the step's connection is required, the config has none, and exactly one connection matches `provider`, `status === 'ACTIVE'` and `canAttach`. `requiredProvider` is a mobile map of the node types whose connection is required (the `providerForNodeType` list minus `http.request`, whose connection is optional); `ai.*` steps are never attached. Neither app consumes `packages/shared`, so this small pure function is copied rather than shared.

### 2. Workflow screen (`apps/mobile/src/app/(app)/workflows/[id].tsx`, `FlowList`)

- Loads readiness with react-query (key `['workflow-readiness', workspaceId, workflowId]`), refetched when the screen regains focus and after any save/publish.
- When `ready` is false:
  - A red summary card at the top: "Còn N bước cần thiết lập" plus "Chạm vào từng bước đỏ để hoàn tất. Nút Xuất bản sẽ mở khi đủ thông tin." N counts distinct `nodeId`s; graph-level issues add the line "Quy trình còn lỗi cần sửa trên máy tính."
  - Each step with issues: red border, a "Cần thiết lập" pill, and a one-line reason (below). Other steps keep their current look.
  - Publish is disabled, with the caption "Hoàn tất N bước đỏ để xuất bản quy trình."
- When readiness fails to load: nothing is marked red and Publish stays as today (the server still validates on publish), with no error banner beyond the existing ones.
- Colours come from the existing palette tones (`danger` fg/bg/border); the pill text keeps the meaning without colour.

**Reason line per step** (first matching issue of that step; VI and EN strings in the mobile i18n):
- `field === "connectionId"` with `CONNECTION_NOT_AUTHORIZED` → "Tài khoản chưa được cấp quyền"
- `field === "connectionId"` otherwise → "Chọn tài khoản {provider label}"
- any other field → "Thiếu: {field label}" when the field has a known label, else "Còn thiếu thông tin"
- Raw codes and field keys are never shown.

### 3. "Finish on the web" sheet

Tapping a red step opens a bottom sheet:
- Title: the step name; subtitle "Bước này cần thiết lập trên máy tính."
- "Còn thiếu" with the step's reason lines.
- Primary: "Mở bước này trên web" → `Linking.openURL(<EXPO_PUBLIC_WEB_URL>/workflows/<id>/builder?step=<nodeId>)` (the web builder already opens the step named by `?step=`).
- Secondary: "Chia sẻ liên kết" → the React Native `Share` API with the same URL (no new dependency).
- New env `EXPO_PUBLIC_WEB_URL`, added with a placeholder to `apps/mobile/.env.example` and read in `app.config.js`. When it is not set, both buttons are hidden and the sheet says "Mở quy trình này trên web để thiết lập."
- The sheet is an accessible modal: labelled title, close button with an accessible name, focus returns to the step on close.

## Error handling

- Generation errors keep the current friendly mapping (rate limit, AI unavailable, timeout, invalid request, no permission).
- Draft save failure: toast with the existing message, prompt kept, retry completes the same workflow (existing `useSaveGeneratedWorkflow` behaviour).
- Readiness 404/403: treated as "not loaded" (see above); the workflow screen's own loading/error states already cover a missing workflow.

## Testing

- workflow-service (`JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`): readiness returns `ready: true` for a publishable draft; an issue with `field: "connectionId"` for a step without a connection; `CONNECTION_NOT_AUTHORIZED` when attachment is refused; graph-level issue with `nodeId: null`; 404 for an unknown workflow; 403 for a non-member; no state change (draft and published version untouched).
- api-gateway (`pnpm --dir services/api-gateway test`, `test:e2e`): the route forwards to the right upstream path and validates the ids, like the existing workflow routes.
- mobile (`npx tsc --noEmit -p .` from `apps/mobile`; node tests the way existing `*.test.cjs`/`*.test.ts` files run): `autoPickConnections` (0/1/2 matches, inactive, not attachable, already set, optional `http.request`, `ai.*`) and the reason-line mapping.
- Device check on Android (Expo dev client): generate from a starter prompt against the real stack → lands on the workflow screen with red steps → sheet opens → "Mở bước này trên web" opens the right step in the browser.

## Risks

- A wrong generation leaves a draft behind (same accepted trade-off as web).
- Until Phase 2, every unfinished step needs a computer; users fully on mobile cannot finish those workflows.
- Readiness and publish can still disagree on the checks readiness skips (Telegram limits, watched workflows); publish errors keep their current handling.
- The web helper and the mobile copy of `autoPickConnections` can drift; both keep the same test cases.

## Out of scope

Phase 2 (editing simple fields in a bottom sheet on mobile), creating connections on mobile, web adopting the readiness endpoint, deleting abandoned drafts.
