# AI generate, Zapier style: build first, flag what is missing

Date: 2026-11-09 · Scope: `apps/web` only · Status: approved design, awaiting plan

## Goal

A user describes a workflow in plain words and lands on the canvas with the workflow already built. Steps that still need a connection, key or required value are shown in red, and the user fixes them in the builder. The question-and-answer round with text fields (`needs_input`) goes away on web.

Success: no typing between "describe" and "see the canvas"; every step that blocks publishing is red and one click away.

## Decisions (agreed with the user)

| Question | Decision |
| --- | --- |
| Platforms | Web only. Mobile keeps its current QuestionsForm flow for now. |
| Where red applies | Every workflow, not only AI-generated ones. |
| After generation | Create the draft and open the builder right away. No preview step. |
| Existing connections | Auto-attach when the workspace has exactly one ACTIVE connection of the provider a step needs. Two or more: leave blank, step is red, user picks. |
| Approach | Web-only change. No backend or contract change. |

## Why no backend change

`allowBlanks` already works end to end:

- ai-service appends `GENERATE_ALLOW_BLANKS_RULE` ("Never return needs_input ... omit every config field the request does not give").
- workflow-service `IntentCompiler.compile(..., allowBlanks)` skips missing values and missing connections and returns `Ready`.
- Auto-attaching a connection on the client is the same as a user picking it in the inspector; workflow-service still authorizes the connection on save/publish.

The request fields `answers` and `connections` stay in the API (mobile uses them). Web just stops sending them.

## Design

### 1. Generation flow

Files: `apps/web/src/pages/AiGeneratorPage.tsx`, `apps/web/src/components/builder/GenerateWorkflowPanel.tsx`, `apps/web/src/components/ai/useWorkflowGeneration.ts`.

- One prompt box, starter examples, one "Generate" button.
- Request: `generate({ prompt, allowBlanks: true })`.
- On `ready`:
  1. `autoPickConnections(definition, connections)` fills `config.connectionId` on every node whose schema lists `connectionId` in `required` (so the optional bring-your-own-key connection of `ai.*` steps is never auto-attached; they keep the platform model), whose config has no `connectionId`, and for which the workspace has exactly one `ACTIVE` connection whose `provider` equals `x-weav-connection.provider`.
  2. Generator page: `workflowV1Api.createWorkflowFromDefinition({ name, definition, layout })`, success toast, close the AI dialog, `navigate('/workflows/:id/builder')`.
  3. Builder panel: hand the result to the existing `handleGenerateReady` (keeps the "replace the current canvas?" confirm), canvas is unsaved as today.
- On `needs_input` (the model ignored the rule) or `unsupported`: show a plain message and the list of what is unclear (`ai.question.<code>` / `ai.reason.<code>` labels), keep the prompt so the user can rewrite it. No input fields.
- Errors keep the current `generationErrorMessage` mapping (429/503/504/400/413/403).
- The connection list loads when the page/panel opens. If it has not loaded or failed, generation still works and nothing is auto-attached (steps simply stay red).
- Removed: `answers`, `picked`, `known` state, `renderQuestions`, `renderPreview`, `submitAnswers`, the hard-coded Sheets/Email selects in the panel, `PROVIDER_BY_NODE`, and translation keys that only those used.

`autoPickConnections` lives in `apps/web/src/lib/autoPickConnections.ts`, a pure function `(definition, connections) => definition` that never mutates its input.

### 2. Red steps

File: `apps/web/src/components/builder/CustomWorkflowNode.tsx`.

| Readiness state | Badge | Node border (not selected) |
| --- | --- | --- |
| `not-configured`, `authorization-required` | `bg-err-bg text-err` | `border-err` |
| `unsupported` | `bg-err-bg text-err` (unchanged) | `border-err` |
| `unavailable` (OCR off) | warn (unchanged): the user cannot fix it | unchanged |
| `ready`, `draft` | unchanged | unchanged |

Selection and run status keep priority over readiness: selected stays `ring-run`, a running/failed step keeps its run styling. Colour is never the only signal; the badge text stays.

### 3. "N steps need setup" bar

File: `apps/web/src/pages/WorkflowBuilderPage.tsx`.

- The existing `publish-blocker-summary` bar gets a row of chips, one per step whose readiness is `not-configured`, `authorization-required` or `unsupported`, labelled with the step name.
- Clicking a chip selects the node, opens the inspector and centres the canvas on it (the same path `?step=` uses after OAuth).
- Chips are buttons with an accessible name ("Thiết lập bước {name}"); the bar keeps `role="status"`.
- Graph-level blockers (unreachable step, etc.) keep the current text.
- Inspector is unchanged: it already offers "add Google connection" (OAuth, returns to the step) and the Telegram/token guide.

## Testing

- `autoPickConnections`: one small runnable check covering 0 / 1 / 2 matching connections, an inactive connection, a node that already has a `connectionId`, and an `ai.*` step (optional connection, never attached).
- Playwright, `VITE_API_MODE=http`, stubbing `/workflows/generate`:
  - `ai-generator.spec.ts`: replace the question-round cases with: request carries `allowBlanks: true` and no `answers`; `ready` creates the draft and lands on the builder; a step with a single matching connection is auto-attached; a step with none shows `data-readiness="not-configured"` with the red border; clicking its chip opens the inspector; `needs_input` shows the message and keeps the prompt.
  - `ai-builder.spec.ts` "generate with AI": update for the panel without the Sheets/Email selects.
- `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/web build`, `pnpm --dir apps/web exec eslint .`.
- Real stack in the Browser pane (AI enabled): generate from a starter prompt, confirm the builder opens with red steps, fix one, confirm it turns ready.

## Risks

- A wrong generation leaves a draft behind; the user deletes it in the builder. Accepted trade-off.
- Red readiness now shows on every workflow, including steps just dropped onto the canvas. Accepted (Zapier behaves the same).
- If the model returns invented placeholder values despite the rule, the step looks ready but is wrong. Out of scope; prompt-side issue.
- Mobile still uses the question flow; behaviour differs between platforms until mobile is done.

## Out of scope

Mobile, backend/contract changes, inline creation of non-Google connections from the step, deleting the draft automatically.
