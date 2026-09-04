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

- Refined Dark Palette: graphite/blue-gray `#101826` background, `#182438` card, `#2F4158` border, `#E7EEF8` text, `#4F8CFF` cobalt primary. Zero purple, zero pure black.
- Connector Centerline Alignment: exact 20px horizontal centerline icon anchor in `LiveExecutionPanel.tsx`.
- Animated Theme Toggle: Framer Motion rotate/crossfade transition in `Topbar.tsx`.
- TS Build Fix: resolved `TS2584: Cannot find name 'document'` in `e2e/workflow-ui.spec.ts` via `globalThis` object access for `tsconfig.node.json` compatibility.
- Scoped ESLint checks: **0 errors, 0 warnings** (`pnpm --filter web lint`).
- Production build: **0 errors** (`pnpm --filter web build` completed in 1.77s).
- Chromium E2E suite: **6/6 passed** (`pnpm --filter web test:e2e -- --project=chromium` in 10.7s).
- Firefox harness limitation: 6 Firefox test failures are due to environment test-harness initialization error `browserContext.newPage: Cannot read properties of undefined (reading '_page')`; Chromium environment is verified 100%.
- Existing non-blocking warning: production JavaScript bundle >500 kB chunk size warning.
- Visual QA: verified at desktop, tablet, and mobile breakpoints with dark/light theme coherence and reduced-motion fallback.
- Builder follow-up: added a bounded, slate-masked MiniMap with status-aware node colors and responsive containment; added a one-shot node entrance cue and execution timer cleanup for repeatable packet animation.
- MiniMap QA follow-up: clarified the viewport/camera window with a cobalt-compatible slate fill and outline so the transparent viewport no longer reads as an unexplained white card; verified the mask remains a first-class React Flow viewport overlay.
- Account surfaces follow-up: refreshed Workspace, Settings/Profile, and Help with cobalt/slate hierarchy, semantic status accents, responsive spacing, purposeful Framer Motion entrances/feedback, accessible labels, and a discoverability regression journey covering all three routes.
- Builder motion follow-up: made active execution edges visibly carry a looping packet and dash-flow during each transition, added processing/success icon feedback on workflow nodes, and gave Run Test a clear pulse/spinner state; reduced-motion still resolves state immediately.
- Builder interaction follow-up: added an always-visible, low-intensity edge flow preview (with a static reduced-motion fallback), made the inspector closed by default, and added outside-click dismissal with node-click reopen; Chromium E2E is now 11/11.
- Inspector transition follow-up: converted the inspector to a right-side overlay so opening/closing no longer resizes the React Flow canvas; the geometry regression is covered by Chromium E2E 12/12.
- AI generator focus follow-up: reduced the first viewport to one plain-language prompt, three examples, one primary Generate workflow action, and a collapsed Technical details disclosure; Chromium E2E is now 13/13.
- Contrast and motion follow-up: strengthened dark prompt/preview surfaces and sidebar support footer contrast, added reduced-motion-safe entrance/progress/connector cues, and covered both feedback paths in Chromium E2E.
- Dashboard action follow-up: added a compact Quick actions band for creating workflows, opening AI generation, entering the latest test builder, and reviewing executions; the AI action reuses the existing modal flow.

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
