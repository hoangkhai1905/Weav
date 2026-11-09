# Mobile AI Generate, Build First (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile, describing a workflow builds and saves the draft at once; the workflow screen marks unfinished steps red (from a new read-only readiness endpoint) and each red step opens the exact step on the web builder.

**Architecture:** workflow-service gains `GET …/workflows/{id}/readiness`, reusing the publish validator and the connection-attachment check without publishing; the gateway forwards it and both OpenAPI contracts describe it. Mobile generates with `allowBlanks`, auto-attaches single matching connections, saves, navigates to the workflow screen, and renders readiness there with a "finish on the web" bottom sheet.

**Tech Stack:** Spring Boot (workflow-service), NestJS + Fastify (api-gateway), Expo SDK 57 / React Native + react-query (apps/mobile), `node:test` `.test.cjs` files with `test-support/register-typescript.cjs`.

**Spec:** `docs/superpowers/specs/2026-11-09-mobile-ai-generate-build-first-design.md`

## Global Constraints

- Branch `feat/mobile-ai-generate-build-first` (exists, spec committed). Never touch `services/ocr-service`.
- Readiness route: gateway `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/readiness` → workflow-service `GET /workspaces/{workspaceId}/workflows/{workflowId}/readiness`. Response `{ "ready": boolean, "issues": [{ "nodeId": string|null, "field": string|null, "code": string }] }`, `ready` = no issues. No `message` in the response.
- Readiness checks the definition publish would use (`definitionFor(workflow)`, the draft), runs `DefinitionValidator.validatePublish`, then `authorizeAttachment` per referenced connection; a `ForbiddenException` from that becomes `{ nodeId, field: "connectionId", code: "CONNECTION_NOT_AUTHORIZED" }`. Read-only: no writes, no version, no events. Capability `WORKSPACE_VIEW`. Unknown workflow → 404. A lone `SCHEDULE_VALIDATION_UNAVAILABLE` issue → the same 503 publish gives (`TriggerDependencyUnavailableException`).
- Contract changes are additive (`packages/contracts/http/workflow/openapi.yaml`, `packages/contracts/http/gateway/openapi.yaml`).
- Mobile auto-attach: only when the step's connection is required, config has no `connectionId`, and exactly one connection has matching `provider`, `status === 'ACTIVE'`, `canAttach === true`. Never `http.request` (optional), never `ai.*`.
- Mobile copy (VI / EN, plain words, no raw codes): summary "Còn {n} bước cần thiết lập" / "{n} steps need setup"; "Chạm vào từng bước đỏ để hoàn tất. Nút Xuất bản sẽ mở khi đủ thông tin." / "Tap each red step to finish it. Publish unlocks when everything is set."; graph line "Quy trình còn lỗi cần sửa trên máy tính." / "The workflow has issues to fix on a computer."; pill "Cần thiết lập" / "Needs setup"; publish caption "Hoàn tất {n} bước đỏ để xuất bản quy trình." / "Finish {n} red steps to publish."; reasons "Tài khoản chưa được cấp quyền" / "Account not authorized", "Chọn tài khoản {provider}" / "Choose a {provider} account", "Thiếu: {field}" / "Missing: {field}", "Còn thiếu thông tin" / "Some information is missing"; sheet subtitle "Bước này cần thiết lập trên máy tính." / "Set up this step on a computer."; "Còn thiếu" / "Missing"; "Mở bước này trên web" / "Open this step on the web"; "Chia sẻ liên kết" / "Share link"; no-URL text "Mở quy trình này trên web để thiết lập." / "Open this workflow on the web to set it up."; needs_input heading "AI chưa hiểu rõ mô tả. Hãy nói thêm về:" / "The AI needs a clearer description. Please say more about:"; unsupported heading "AI không dựng được quy trình này:" / "AI cannot build this workflow:".
- New env `EXPO_PUBLIC_WEB_URL` (placeholder in `apps/mobile/.env.example`, read in `app.config.js`); a trailing `/` is trimmed; `nodeId` is URL-encoded in `?step=`.
- Never log secrets; no `console.log` in production code; Java uses the framework logger. Run GitNexus `impact` upstream before editing an existing symbol and `detect-changes --scope all` before each commit.
- Maven: `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` from `services/workflow-service`; known env-only failures are listed in CLAUDE.md.

## Review Focus

1. A workspace viewer (no attach rights) opens a draft: every connection step reports `CONNECTION_NOT_AUTHORIZED`, so the reason reads "Tài khoản chưa được cấp quyền" — not a crash, not a 403 for the whole call. Test in Task 1.
2. Readiness fails to load (network/503): no step is red and Publish behaves as before (not disabled). Test in Task 6.
3. An issue names a `nodeId` that is not in the workflow's step list (stale or graph-level): it never crashes the list; it counts only toward the graph line. Test in Task 3 (mapping) and Task 6.
4. Tapping Generate twice, or saving slowly: exactly one draft and one navigation. Test in Task 5.
5. `EXPO_PUBLIC_WEB_URL` ending with `/` or a `nodeId` with special characters: the link is `<base>/workflows/<id>/builder?step=<encoded>` with no double slash. Test in Task 3.

---

### Task 1: workflow-service readiness endpoint

**Files:**
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowPublicationService.java` (new public method next to `publish`, reusing `definitionFor`, `connectionIds`, the validator and `workspaceConnections`)
- Modify: `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WorkflowController.java` (new `@GetMapping("/{workflowId}/readiness")`)
- Create: `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/response/WorkflowReadinessResponse.java`
- Test: extend `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowPublicationHttpTest.java` (or a new `WorkflowReadinessHttpTest.java` beside it, following its setup)

**Interfaces:**
- Produces: `WorkflowPublicationService.readiness(UUID workspaceId, UUID workflowId, UUID actorId): Readiness` with `record Readiness(List<ValidationIssue> issues) { boolean ready() }`; HTTP JSON per Global Constraints (`message` omitted).

- [ ] **Step 1: Failing tests** — `readyForPublishableDraft` (200, `ready: true`, `issues: []`); `reportsMissingConnection` (draft with `email.send` lacking `connectionId` → an issue whose `nodeId` is that step and `field` is `connectionId`); `reportsUnauthorizedConnection` (port stub throws `ForbiddenException` → `code: "CONNECTION_NOT_AUTHORIZED"`, still 200); `reportsGraphIssueWithNullNode` (a definition with a graph-level validation issue → `nodeId: null`); `unknownWorkflowIs404`; `nonMemberIs403`; `readinessWritesNothing` (repository save/lock never called; draft revision unchanged); `scheduleValidationUnavailableIs503`.
- [ ] **Step 2: Run, expect FAIL** — `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw -q -Dtest='WorkflowPublicationHttpTest' test` (or the new class).
- [ ] **Step 3: Implement** with the interfaces above. Catch only `ForbiddenException` from `authorizeAttachment`; any other exception propagates as today.
- [ ] **Step 4: Run, expect PASS**, then the full `./mvnw verify` (known env-only failures only).
- [ ] **Step 5: Commit** `feat(workflow): read-only readiness check for a workflow draft`.

---

### Task 2: Contracts and gateway route

**Files:**
- Modify: `packages/contracts/http/workflow/openapi.yaml`, `packages/contracts/http/gateway/openapi.yaml` (operation + `WorkflowReadiness` schema)
- Modify: `services/api-gateway/src/workflow/workflow.module.ts` (a `@Get(':workflowId/readiness')` handler shaped like `get`, using `workflowId()` on both ids and `proxy.forward('GET', …, '/workspaces/<ws>/workflows/<wf>/readiness')`)
- Test: `services/api-gateway/test/routes.e2e-spec.ts` (and the unit spec that covers workflow routes, if one exists)

**Interfaces:**
- Consumes: Task 1's upstream path and response.
- Produces: the public route mobile calls.

- [ ] **Step 1: Failing test** — the route forwards `GET` to the upstream readiness path for valid ids and rejects a non-UUID id with the same error the existing `GET :workflowId` gives.
- [ ] **Step 2: Run, expect FAIL** — `pnpm --dir services/api-gateway test:e2e -- routes`.
- [ ] **Step 3: Implement** the handler and both contract entries.
- [ ] **Step 4: Run, expect PASS** — `pnpm --dir services/api-gateway test`, `test:e2e`, `build`; lint check without rewriting: `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"`.
- [ ] **Step 5: Commit** `feat(gateway): expose workflow readiness`.

---

### Task 3: Mobile pure helpers

**Files:**
- Create: `apps/mobile/src/features/ai/auto-pick.ts` + `auto-pick.test.cjs`
- Create: `apps/mobile/src/features/workflows/readiness.ts` + `readiness.test.cjs`
- Modify: `apps/mobile/src/features/ai/ai.answers.ts` only to export what the new code reuses (`providerForNodeType`, `humanizeField`), nothing else

**Interfaces:**
- Produces:
  - `requiredConnectionProvider(nodeType: string): ConnectionProvider | null` — `providerForNodeType` minus `http.request`; `null` for `ai.*`.
  - `autoPickConnections(definition: WorkflowDefinition, connections: readonly PickableConnection[], requiredProvider: (type: string) => string | null): WorkflowDefinition` — new object, input untouched.
  - `type ReadinessIssue = { nodeId: string | null; field: string | null; code: string }`.
  - `groupIssues(issues: ReadinessIssue[], stepIds: readonly string[]): { byStep: Map<string, ReadinessIssue[]>; graphIssues: number; redCount: number }` — issues whose `nodeId` is null or not in `stepIds` count as graph issues.
  - `reasonFor(issue: ReadinessIssue, nodeType: string, t: (key: string, vars?: Record<string, string>) => string): string` — rules from the spec (CONNECTION_NOT_AUTHORIZED; connectionId → provider label; other field → `humanizeField` or generic).
  - `webStepUrl(base: string | undefined, workflowId: string, nodeId: string): string | null` — `null` when base is empty; trims trailing `/`; encodes `nodeId`.

- [ ] **Step 1: Failing tests** — auto-pick: attaches the only usable Gmail; two matches → none; INVALID or `canAttach:false` ignored; existing `connectionId` kept; `http.request` and `ai.generate` never attached; input not mutated. readiness: grouping with a known step, an unknown `nodeId` and a `null` node; `redCount` counts distinct steps; each reason rule; `webStepUrl('https://app.example.test/', 'wf-1', 'send email')` → `https://app.example.test/workflows/wf-1/builder?step=send%20email`; empty base → `null`.
- [ ] **Step 2: Run, expect FAIL** — from `apps/mobile`: `node --test src/features/ai/auto-pick.test.cjs src/features/workflows/readiness.test.cjs`.
- [ ] **Step 3: Implement** with the signatures above (no React Native imports in these files).
- [ ] **Step 4: Run, expect PASS**, plus `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** `feat(mobile): auto-pick and readiness helpers`.

---

### Task 4: Mobile readiness data access

**Files:**
- Modify: `apps/mobile/src/domain/workflow/workflow.types.ts` (`WorkflowRepository.getReadiness(workspaceId, workflowId): Promise<WorkflowReadiness>`; `WorkflowReadiness = { ready: boolean; issues: ReadinessIssue[] }`)
- Modify: `apps/mobile/src/infrastructure/http/http-workflow.repository.ts`, `workflow.http.contract.ts`, `workflow.dto.ts`/`workflow.mapper.ts` as the existing endpoints do
- Modify: `apps/mobile/src/features/workflows/hooks/useWorkflows.ts` (`useWorkflowReadiness(workflowId)` with key `['workflow-readiness', workspaceId, workflowId]`; `usePublishWorkflow` and draft saves invalidate it)
- Test: `workflow.http.contract.test.cjs`, `workflow.mapper.test.cjs`

**Interfaces:**
- Consumes: Task 2's route; Task 3's `ReadinessIssue`.
- Produces: `useWorkflowReadiness(workflowId: string)` → react-query result of `WorkflowReadiness`.

- [ ] **Step 1: Failing tests** — contract builds the right path; mapper keeps `nodeId`/`field` nulls, drops unknown keys, rejects a body without a boolean `ready` with the app's invalid-response error.
- [ ] **Step 2: Run, expect FAIL** — `node --test src/infrastructure/http/workflow.http.contract.test.cjs src/infrastructure/http/workflow.mapper.test.cjs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus tsc.
- [ ] **Step 5: Commit** `feat(mobile): load workflow readiness`.

---

### Task 5: Mobile generator builds first

**Files:**
- Modify: `apps/mobile/src/app/(app)/ai/generator.tsx`
- Modify: `apps/mobile/src/features/ai/hooks/useAiGenerator.ts` (request without answers/connections, with `allowBlanks: true`) and the AI request type if it forbids `allowBlanks`
- Modify: `apps/mobile/src/stores/i18n.ai.ts` (+ its test) — add the two headings; delete keys only the removed UI used (grep first)
- Delete: `apps/mobile/src/features/ai/components/QuestionsForm.tsx`, and `ScheduleField.tsx` / answer-building exports in `ai.answers.ts` if nothing else uses them (grep first; keep `providerForNodeType`, `humanizeField`)
- Test: update `ai.answers.test.cjs` for removed exports; `i18n.ai.test.cjs`

**Interfaces:**
- Consumes: Task 3 `autoPickConnections`, `requiredConnectionProvider`; existing `useSaveGeneratedWorkflow`; the mobile connections list hook.

- [ ] **Step 1: Failing tests** — i18n test asserts the new keys exist in VI and EN; a pure test (extract the request builder if needed) asserts the generate request has `allowBlanks: true` and no `answers`/`connections`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — ready → auto-pick → save → `router.replace('/(app)/workflows/<id>')`; one in-flight ref guards generate + save; capture the active workspace at submit and drop a result that arrives after it changed; needs_input / unsupported → one notice with the heading per status, prompt kept; remove the "saved" screen and its publish button.
- [ ] **Step 4: Run, expect PASS** — the touched `.test.cjs` files, tsc, `npx expo lint` on changed files (report pre-existing warnings separately).
- [ ] **Step 5: Commit** `feat(mobile): AI generator builds the draft right away`.

---

### Task 6: Mobile workflow screen shows red steps and the web sheet

**Files:**
- Modify: `apps/mobile/src/app/(app)/workflows/[id].tsx`, `apps/mobile/src/features/workflows/components/FlowList.tsx`
- Create: `apps/mobile/src/features/workflows/components/SetupOnWebSheet.tsx`
- Modify: `apps/mobile/src/stores/i18n.workflows.ts` (+ a test file following `i18n.*.test.cjs`)
- Modify: `apps/mobile/.env.example`, `apps/mobile/app.config.js` (`EXPO_PUBLIC_WEB_URL`)

**Interfaces:**
- Consumes: Task 3 `groupIssues`, `reasonFor`, `webStepUrl`; Task 4 `useWorkflowReadiness`.
- Produces: `FlowList` accepts optional `issuesByStep?: Map<string, string[]>` (reason lines) and `onStepPress?: (nodeId: string) => void`; a step with reasons renders the red border (palette `tones.danger.border`), the "Cần thiết lập" pill and its first reason, and is a pressable with an accessible label.

- [ ] **Step 1: Failing tests** — i18n keys present in VI/EN; a pure test for the screen's derived state (extract `readinessView(readiness | undefined, steps)` into `readiness.ts` if needed): undefined/error → no red steps and publish not blocked; issues → `redCount`, publish blocked, graph line flag.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — summary card, red steps, disabled Publish with caption, sheet (title = step name, subtitle, reasons, "Mở bước này trên web" via `Linking.openURL`, "Chia sẻ liên kết" via `Share.share`, both hidden with the no-URL text when `webStepUrl` is null), refetch on focus; accessible modal (labelled title, close button label, touch targets ≥44).
- [ ] **Step 4: Run, expect PASS** — touched tests, all mobile `*.test.cjs` (`node --test $(find src -name "*.test.cjs")` from `apps/mobile`), tsc.
- [ ] **Step 5: Commit** `feat(mobile): mark unfinished steps and finish them on the web`.

---

### Task 7: Verify and log

**Files:**
- Create or extend: `docs/work_logs/T/mobile/ai-generate-build-first.md` (Vietnamese; check `docs/work_logs/T/mobile/` and the README index first) + index line in `docs/work_logs/README.md`

- [ ] **Step 1: Checks** — workflow-service `./mvnw verify`; gateway `test`, `test:e2e`, `build`; mobile all `*.test.cjs` + tsc; `git diff --check`.
- [ ] **Step 2: Live check** — dev stack with `compose.ai-local.yml`; `curl` the gateway readiness route for a generated draft (status + body shape, no secrets); Android device/emulator run of the flow if available, otherwise record it as a handoff check for the user (generate → workflow screen red steps → sheet → web opens the step).
- [ ] **Step 3: Work log** — decisions, commits, commands with one-line results, evidence, risks, next steps (Phase 2).
- [ ] **Step 4:** `detect-changes`, commit `docs(work-log): mobile AI generation builds first`. Do not merge or push without the user.
