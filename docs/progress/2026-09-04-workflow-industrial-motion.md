# Workflow Industrial Motion — Progress

Last updated: 2026-09-04  
Branch: `feature/workflow-industrial-motion`

## Goal

Refresh the workflow experience with readable typography, a neutral industrial palette, purposeful motion, and accessible reduced-motion behavior. Purple is removed from the scoped workflow UI in favor of cobalt blue, cool gray, and semantic status colors.

## Completed and committed

| Area | Status | Commit |
|---|---|---|
| Design specification | Complete | `b0a7f51` |
| Application shell and initial sidebar redesign | Complete | `9806ae1` |
| Workflow operations list, glyphs, filtering, and accessible row menu | Complete | `01d4f44` |

## Implemented but not committed

### Sidebar color revision

- Replaced the near-black sidebar with light blue-gray `#EEF3F8`.
- Changed navigation text to navy and muted slate.
- Changed the active item to a light cobalt surface.
- Updated hover, footer, avatar, focus, and support-navigation colors.
- Added an E2E assertion that prevents the sidebar from regressing to a dark panel.

Relevant files:

- `apps/web/src/index.css`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/e2e/workflow-ui.spec.ts`

### Workflow builder execution motion

- Replaced the hard-coded SVG overlay with a custom React Flow execution edge.
- Animated a packet along the real edge path.
- Added node states for idle, processing, success, and error.
- Added reduced-motion behavior: state feedback remains, packet animation is removed.
- Replaced remaining scoped purple accents with cobalt and neutral colors.
- Added accessible labels for running a test workflow.

Relevant files:

- `apps/web/src/components/builder/ExecutionEdge.tsx`
- `apps/web/src/components/builder/CustomWorkflowNode.tsx`
- `apps/web/src/pages/WorkflowBuilderPage.tsx`
- `apps/web/e2e/workflow-ui.spec.ts`

## Verification evidence

- Sidebar E2E test: passed after the light-sidebar revision.
- Builder execution-motion tests: 2 passed, including reduced motion.
- Full Chromium E2E suite before the latest sidebar revision: 6 passed.
- Scoped ESLint checks: passed.
- Production build after the latest sidebar revision: passed.
- Existing non-blocking warning: the production JavaScript chunk is larger than 500 kB.
- Visual QA: desktop workflow list and builder inspected; mobile list remains intentionally horizontally scrollable and is not yet mobile-native.

## GitNexus evidence

- Repository indexed using `gitnexus analyze --index-only .`.
- Graph size at indexing: 5,569 nodes, 8,832 edges, 149 clusters, 163 flows.
- `Sidebar` upstream impact: **LOW**.
- Direct consumer: `AppLayout`; indirect consumer: `App`.
- GitNexus reported degraded keyword search because FTS indexes were missing; symbol context and impact analysis were available.

## Next actions

1. Get visual approval for the light sidebar.
2. Run the full E2E suite once more after approval.
3. Refresh the GitNexus index and run `detect-changes` for the final affected graph.
4. Commit only the remaining workflow UI code and its E2E test using explicit pathspecs.
5. Do not include unrelated skills, agent files, mobile changes, or pre-existing staged files.

## Known repository state

The worktree contains many unrelated staged and untracked files that predate this UI work. They belong to the user and must remain untouched. Broad commands such as `git add .` are prohibited for this task.
