# AI Generate, Zapier Style — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On web, describing a workflow builds the draft and opens the builder at once; steps that still need a connection or required value are red and one click away.

**Architecture:** Web-only. The generator always sends `allowBlanks: true` (already supported by ai-service and workflow-service), a pure helper auto-attaches a connection when the workspace has exactly one usable match, the draft is created and the builder opened. The builder shows unfinished steps in red and lists them as clickable chips in the existing publish-blocker bar.

**Tech Stack:** React + Vite + TypeScript, React Flow, Tailwind tokens (`err`, `warn`), `node:test` for pure helpers, Playwright (`VITE_API_MODE=http`).

**Spec:** `docs/superpowers/specs/2026-11-09-ai-generate-zapier-style-design.md`

## Global Constraints

- Scope `apps/web` only. No change to backend services, `packages/contracts`, the gateway, or mobile.
- The API request type keeps `answers` and `connections` (mobile uses them); web stops sending them.
- Auto-attach only when the node schema lists `connectionId` in `required`, the config has no `connectionId`, and exactly one workspace connection has `provider === x-weav-connection.provider`, `status === 'ACTIVE'` and `canAttach === true`. Never auto-attach `ai.*` steps.
- Red = `bg-err-bg text-err` badge and `border-err` node border for readiness `not-configured`, `authorization-required`, `unsupported`. `unavailable` stays warn. Selection (`ring-run`) and run status keep priority. The badge text stays (colour is never the only signal).
- Every new user-facing string goes into `src/lib/i18n/translations.ts` in both the VI and EN tables, plain wording for non-programmers.
- No `console.log`. Branch: `feat/web-ai-generate-zapier-style` (exists, spec committed).
- Run GitNexus `impact` (upstream) before editing an existing symbol; `detect_changes --scope all` before each commit.

## Review Focus

1. Clicking "Generate" twice or while the draft is being created → exactly one draft is created (button disabled while pending/saving). Test in Task 4.
2. The connection list has not loaded (or failed) when the result arrives → generation still succeeds, nothing is auto-attached, no crash. Test in Task 4 (connections route returns 500).
3. A connection that is ACTIVE but `canAttach: false`, or INVALID → never auto-attached. Test in Task 1.
4. Draft creation fails (500) → plain error shown, prompt kept, no navigation, retry possible. Test in Task 4.
5. A generated node without a display name → its chip falls back to the step type label, never a raw id. Test in Task 3.

---

### Task 1: `autoPickConnections` helper

**Files:**
- Create: `apps/web/src/lib/autoPickConnections.ts`
- Create: `apps/web/src/lib/autoPickConnections.test.mjs`
- Modify: `apps/web/src/lib/nodeReadiness.ts` (add one export)

**Interfaces:**
- Produces:
  - `autoPickConnections(definition: unknown, connections: readonly PickableConnection[], requiredProvider: (nodeType: string) => string | undefined): unknown` — returns a new definition (input untouched); returns the input unchanged when it is not `{ nodes: [...] }`.
  - `type PickableConnection = { id: string; provider: string; status: string; canAttach: boolean }` (a `ConnectionResponse` satisfies it).
  - In `nodeReadiness.ts`: `requiredConnectionProvider(nodeType: string): string | undefined` — the `x-weav-connection.provider` of `connectionId` when `NODE_SCHEMAS[nodeType].required` includes `connectionId` and the provider is a single string; otherwise `undefined`.
- `autoPickConnections.ts` has no imports (so `node --test` can load it); callers pass `requiredConnectionProvider`.

- [ ] **Step 1: Write the failing test** (`node:test` + `node:assert/strict`, same style as `workflowSummary.test.mjs`)

Lookup used by all cases: `const provider = (type) => ({ 'email.send': 'GMAIL', 'google.sheets': 'GOOGLE_SHEETS' })[type];`
Connection factory: `const c = (id, provider, extra = {}) => ({ id, provider, status: 'ACTIVE', canAttach: true, ...extra });`

- `attaches the only usable connection`: nodes `[{id:'a',type:'trigger.manual',config:{}},{id:'b',type:'email.send',config:{to:'x'}}]`, connections `[c('g1','GMAIL')]` → node `b` config deep-equals `{ to: 'x', connectionId: 'g1' }`; node `a` config `{}`.
- `leaves the step blank when two connections match`: `[c('g1','GMAIL'), c('g2','GMAIL')]` → `b.config.connectionId` is `undefined`.
- `ignores inactive or non-attachable connections`: `[c('g1','GMAIL',{status:'INVALID'}), c('g2','GMAIL',{canAttach:false})]` → undefined; `[c('g1','GMAIL',{status:'INVALID'}), c('g3','GMAIL')]` → `'g3'`.
- `keeps a connection the model already set`: `b.config.connectionId = 'given'`, `[c('g1','GMAIL')]` → `'given'`.
- `never attaches optional connections`: node `{id:'ai',type:'ai.generate',config:{prompt:'p'}}`, connections `[c('k1','OPENAI')]` → no `connectionId` (lookup returns undefined for `ai.generate`).
- `does not mutate the input and tolerates bad input`: input object deep-equals its `structuredClone` after the call; `autoPickConnections(null, [], provider) === null`.

- [ ] **Step 2: Run it, expect FAIL** — `node --test src/lib/autoPickConnections.test.mjs` (from `apps/web`): cannot find module.

- [ ] **Step 3: Implement** `autoPickConnections` and `requiredConnectionProvider` with the signatures above.

- [ ] **Step 4: Run it, expect PASS** — same command, 6 passing.

- [ ] **Step 5: Type-check and commit**

Run: `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` → no errors.
```bash
git add apps/web/src/lib/autoPickConnections.ts apps/web/src/lib/autoPickConnections.test.mjs apps/web/src/lib/nodeReadiness.ts
git commit -m "feat(web): auto-pick a step's connection when only one fits" -m "..."
```

---

### Task 2: Red unfinished steps on the canvas

**Files:**
- Modify: `apps/web/src/components/builder/CustomWorkflowNode.tsx` (`readinessClass` ~line 158, `borderStyle` ~line 174)
- Test: `apps/web/e2e/ai-generator.spec.ts` (new `test.describe("Unfinished steps")`)

**Interfaces:**
- Produces: node root keeps `data-readiness`; red border uses the class `border-err`. Task 3 and 4 tests rely on both.

- [ ] **Step 1: Write the failing test** `marks a step without a connection in red`: stub the workflow detail (`emptyDetail` shape) with `definition.nodes` `[trigger.manual 'start', email.send 'send_email' config {to:'owner@example.test', subject:'Hi'}]` and one edge; open `/workflows/${WORKFLOW_ID}/builder`. Assert the node `[data-testid=workflow-node][data-node-type="email.send"]` has `data-readiness="not-configured"` and `toHaveClass(/border-err/)`, and its `workflow-node-readiness` badge `toHaveClass(/text-err/)`. Assert the trigger node does not have `border-err`.

- [ ] **Step 2: Run, expect FAIL** — `VITE_API_MODE=http pnpm --dir apps/web exec playwright test e2e/ai-generator.spec.ts --project=chromium -g "in red"`: class is `border-border-strong` / `text-warn`.

- [ ] **Step 3: Implement** — `readinessClass`: `unavailable` → warn, `ready`/`draft` → muted, everything else → `bg-err-bg text-err`. `borderStyle`: after the selected/processing/error branches, an unfinished readiness (`not-configured | authorization-required | unsupported`) → `border-err`.

- [ ] **Step 4: Run, expect PASS.** Also run `e2e/simple-node-ui.spec.ts` and `e2e/ai-builder.spec.ts`; any failure that asserts the old warn classes is updated to the new rule, anything else is compared against `dev` before treating it as a regression.

- [ ] **Step 5: Commit** `feat(web): show unfinished workflow steps in red`.

---

### Task 3: Clickable "steps to set up" chips

**Files:**
- Modify: `apps/web/src/pages/WorkflowBuilderPage.tsx` (the `publish-blocker-summary` block ~line 1861; selection logic shared with the `?step=` effect ~line 1298)
- Modify: `apps/web/src/lib/i18n/translations.ts`
- Test: `apps/web/e2e/ai-generator.spec.ts` (`Unfinished steps` describe)

**Interfaces:**
- Consumes: `getNodeReadinessBadge(type, config, attachableConnectionIds, ocrSources)` (existing).
- Produces: chips are `button`s with `data-testid="setup-step-chip"` and accessible name from `builder.setup_step` (`{name}` placeholder). A `focusStep(nodeId: string)` function inside the page selects the node, opens the inspector and centres it; the `?step=` effect calls the same function.

New keys (VI / EN):
- `builder.needs_setup`: `Bước cần thiết lập` / `Steps to set up`
- `builder.setup_step`: `Thiết lập bước {name}` / `Set up step {name}`

- [ ] **Step 1: Write the failing tests**
  - `lists unfinished steps and opens one on click`: same fixture as Task 2. `getByRole('button', { name: 'Set up step <email.send node display name>' })` is visible inside `publish-blocker-summary`; click it → the inspector shows that step (assert the inspector heading/testid the builder already uses for the selected step) and the node has the selected styling `ring-run`.
  - `a step without a name falls back to its type label`: fixture node with no name in `editorState` → chip name contains the `nodeLabel` English label for `email.send`, not `send_email`.
  - Ready-only workflow (trigger.manual + a configured `logic.condition`) → no `setup-step-chip`.

- [ ] **Step 2: Run, expect FAIL** (`-g "unfinished steps|falls back"`): no chip.

- [ ] **Step 3: Implement** — memo the list of `{ id, name }` for nodes whose readiness is `not-configured | authorization-required | unsupported`, in canvas order; render under the existing blocker text, prefixed by `builder.needs_setup`; extract `focusStep` and centre with the React Flow instance already held in `flowRef` (`setCenter` on the node position, keep the current zoom). Chips keep focus-visible rings; bar keeps `role="status"`.

- [ ] **Step 4: Run, expect PASS**, plus `tsc`.

- [ ] **Step 5: Commit** `feat(web): jump to unfinished steps from the publish bar`.

---

### Task 4: Generator page builds the draft right away

**Files:**
- Modify: `apps/web/src/pages/AiGeneratorPage.tsx`
- Modify: `apps/web/src/components/ai/useWorkflowGeneration.ts` (drop `connections`/`answers` from the input type; keep `allowBlanks`)
- Modify: `apps/web/src/lib/i18n/translations.ts` (add one key; delete keys only these screens used, after grepping that nothing else uses them)
- Test: `apps/web/e2e/ai-generator.spec.ts` (`Create with AI page` describe)

**Interfaces:**
- Consumes: `autoPickConnections`, `requiredConnectionProvider` (Task 1); `connectionApi.list`; `workflowV1Api.createWorkflowFromDefinition`; `useWorkflowGeneration().generate({ prompt, allowBlanks: true })`.
- Produces: `generate(input: { prompt: string; allowBlanks?: boolean })` — Task 5 uses it.

New key (VI / EN): `hp.ai.unclear`: `AI chưa hiểu rõ mô tả. Hãy nói thêm về:` / `The AI needs a clearer description. Please say more about:`

- [ ] **Step 1: Rewrite the tests.** Remove the question-round cases (`offers a draft with blanks…`, `asks a plain question…`, both recipient pre-fill cases). Keep both AI-disabled cases. Add (stub `**/api/v1/workspaces/${WORKSPACE_ID}/connections` returning `[gmailConnection]`, a full `ConnectionResponse` with `provider: 'GMAIL', status: 'ACTIVE', canAttach: true`):
  - `builds the draft at once and opens the builder`: generate returns `ready` (trigger.manual + email.send without `connectionId`). Assert one generate request with `allowBlanks: true` and no `answers`/`connections` keys; one create POST whose definition's email.send config has `connectionId` = the stub id; URL ends with `/workflows/${WORKFLOW_ID}/builder`.
  - `leaves the connection blank when none fits` (connections stub `[]`): created definition has no `connectionId`.
  - `keeps going when connections cannot load` (connections stub 500): draft still created, no `connectionId`.
  - `creates only one draft on a double click`: `dblclick` Generate → exactly one generate request and one create POST.
  - `shows what is unclear and keeps the prompt`: generate returns `needs_input` with `[{code:'TRIGGER', field:'trigger'}]` → text `The AI needs a clearer description` and the `ai.question.TRIGGER` English label are visible, no `textbox` other than the prompt, prompt value kept, no create POST.
  - `keeps the prompt when the draft cannot be created`: `createStatus: 500` → `role=alert` visible, URL still `/ai/workflow-generator`, prompt kept, Generate enabled again.

- [ ] **Step 2: Run, expect FAIL** — `VITE_API_MODE=http pnpm --dir apps/web exec playwright test e2e/ai-generator.spec.ts --project=chromium -g "Create with AI page"`.

- [ ] **Step 3: Implement.** Generate button: `generate({ prompt, allowBlanks: true })`; on `ready` run `createDraft(autoPickConnections(result.definition, connections, requiredConnectionProvider))` with the existing toast / notification-session / `closeAiGenerator` / navigate code. One `busy = isPending || isSaving` flag disables the button and guards the handler. `needs_input` and `unsupported` render one notice: `hp.ai.unclear` + the `ai.question.<code>` / `ai.reason.<code>` labels. Delete `answers`, `picked`, `known`, `defaultAnswer`, `submitAnswers`, `connectionsChosen`, `renderQuestions`, `renderPreview`, `splitQuestionField`, `PROVIDER_BY_NODE`, `RECIPIENT_FIELD`, and their now-unused imports. Keep the workspace-change reset.

- [ ] **Step 4: Run, expect PASS**, plus `tsc` and `pnpm --dir apps/web exec eslint .`.

- [ ] **Step 5: Commit** `feat(web): AI generator builds the draft right away`.

---

### Task 5: Builder "Generate with AI" panel

**Files:**
- Modify: `apps/web/src/components/builder/GenerateWorkflowPanel.tsx`
- Modify: `apps/web/src/lib/i18n/translations.ts` (drop `ai.connection_sheets`, `ai.connection_email`, `ai.ask.*`, `ai.continue` if nothing else uses them — grep first)
- Test: `apps/web/e2e/ai-builder.spec.ts` (`generate with AI`)

**Interfaces:**
- Consumes: Task 1 helpers, Task 4 `generate`. Keeps the prop `onReady(result: ReadyGeneration)`; passes a result whose `definition` already went through `autoPickConnections`. `handleGenerateReady` in the builder is unchanged.

- [ ] **Step 1: Update the test** `generate with AI`: no Sheets/Email selects in the dialog; generate request has `allowBlanks: true`; after `ready` the canvas shows the generated nodes and the step without a connection has `data-readiness="not-configured"`; with one Gmail connection stubbed, the email step's inspector connection select shows the stub id. `needs_input` shows the `hp.ai.unclear` notice, no answer inputs.

- [ ] **Step 2: Run, expect FAIL** — `VITE_API_MODE=http pnpm --dir apps/web exec playwright test e2e/ai-builder.spec.ts --project=chromium -g "generate with AI"`.

- [ ] **Step 3: Implement.** Prompt + Cancel + Generate only; load connections on open (existing effect); on `ready` call `onReady({ ...result, definition: autoPickConnections(...) })`; same unclear notice as Task 4 (copy the few lines; no shared component for two call sites). Delete `questionText`, `isAnswerable`, `isRecipientField`, answers state and the two selects.

- [ ] **Step 4: Run, expect PASS**, plus `tsc`.

- [ ] **Step 5: Commit** `feat(web): builder AI panel builds without questions`.

---

### Task 6: Verify, work log, wrap up

**Files:**
- Create or extend: `docs/work_logs/T/web/ai-generate-zapier-style.md` (template `docs/work_logs/log_template.md`; check `docs/work_logs/README.md` and `docs/work_logs/T/` for an existing AI-generator log first and extend it instead)
- Modify: `docs/work_logs/README.md` (index line)

- [ ] **Step 1: Full checks** (from repo root):
  - `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` → 0 errors
  - `node --test apps/web/src/lib/*.test.mjs` → all pass
  - `pnpm --dir apps/web exec eslint .` → no new errors versus `dev`
  - `pnpm --dir apps/web build` → succeeds
  - `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium` → failures only where they also fail on `dev`
- [ ] **Step 2: Real stack in the Browser pane** — stack with AI enabled (CLAUDE.md "AI Service"), Vite on `localhost:5173`. Generate from the "Gmail → Drive" starter: lands in the builder, steps without a connection are red with chips; click a chip, pick a connection, step turns ready. Check console and network for errors; take one screenshot. Stop any containers started for this.
- [ ] **Step 3: Work log** — decisions, changed files, commands with one-line results, browser evidence, risks (drafts left behind; mobile still on the question flow), next step (mobile parity). No secrets.
- [ ] **Step 4:** `git diff --check`, `node .gitnexus/run.cjs detect-changes --scope all --repo .`, commit `docs(work-log): Zapier-style AI generation on web`. Report commits; do not merge or push without the user.
