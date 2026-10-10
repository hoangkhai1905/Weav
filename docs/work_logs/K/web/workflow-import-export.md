# Workflow JSON export/import + "New workflow" fix (W7-B)

Branch `feat/w7-b-import-export` (from `week6` 2e8e672). Status: done, awaiting coordinator review and commit.

## Decisions
- "New workflow" (header button and empty-state button) on `/workflows` now `navigate('/workflows/new')`, like the Dashboard. `handleCreate` removed (it created a hard-coded "New AI Workflow" draft).
- Export reuses `previewShare` (W6-C server-side sanitizer). The builder's share control is an icon button, not a menu, so Export JSON is a second icon button beside it with the same disabled rules (loading, no workflow, unsaved changes; same "save the draft first" title).
- File: `{format:"weav.workflow", version:1, exportedAt, name, description|null, definition, editorState}`, name `weav-<slug>.json`.
- Import validates client-side (size, JSON, format, version, definition.nodes/edges arrays, name 1..255), then `createWorkflow` + `PUT .../draft` via `workflowRequest`. On draft failure the new workflow is deleted. Mock mode shows an "unavailable" message (the mock API has no draft endpoint).

## Changed files
- `apps/web/src/lib/workflowTransfer.ts` (new, pure build/parse/validate)
- `apps/web/src/pages/WorkflowsPage.tsx`, `apps/web/src/pages/WorkflowBuilderPage.tsx`
- `apps/web/src/lib/i18n/translations.ts` (`workflows.transfer.*`, vi + en)
- `apps/web/e2e/w7-workflow-transfer.spec.ts` (new, 9 tests)

## Evidence
- `tsc --noEmit -p tsconfig.app.json`: clean. `pnpm --dir apps/web build`: OK.
- eslint on touched files: only pre-existing set-state-in-effect errors (WorkflowBuilderPage:565, WorkflowsPage:142).
- Playwright (port 4186, http mode): new spec 9/9 pass; baseline vs after for workflow-api-v1, workflow-ui, executions-live, localization, templates specs identical (28 fail / 29 pass before; 28 fail / 38 pass after = +9 new).

## Risks / next steps
- Imported file's connection ids are not present (sanitized on export); user must reselect connections (toast says so). A hand-edited file could carry foreign ids; the server validates the draft.
- Live check by coordinator against the real stack (see final report).
