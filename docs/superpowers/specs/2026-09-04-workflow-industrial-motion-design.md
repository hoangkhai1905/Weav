# WEAV Workflow Industrial Motion Design

## Goal

Refine the Web Workflow experience into a readable operational tool. Replace the purple AI-product aesthetic with an industrial workflow visual language, improve the sidebar and typography, and add motion that explains state and flow.

## Scope

- Shared Web color, typography, surface, focus, and motion tokens.
- Desktop and mobile-drawer sidebar.
- Topbar elements affected by the new shell styling.
- Workflow list and its filtering, selection, menus, and run feedback.
- Workflow Builder canvas, nodes, edges, inspector, and run simulation.
- Light and dark themes, responsive layouts, keyboard focus, and reduced motion.

Out of scope: changing backend behavior, adding workflow features, redesigning unrelated pages, or changing factual product copy.

## Visual Direction

The visual world is **Industrial Workflow**: restrained, precise, and operational rather than futuristic or generative-AI themed.

- Light canvas: cool gray `#F3F5F7`; primary surfaces: white.
- Dark canvas: deep ink near `#0B1220`; elevated surfaces use restrained blue-gray.
- Navigation: deep ink `#111827` with high-contrast text.
- Primary interaction: cobalt around `#3B82F6`; no purple in the scoped surfaces.
- State colors: emerald for success, amber for running/warning, red for failure, neutral gray for paused/draft.
- Surfaces use 1px borders, 6–10px radii, and minimal shadows.
- Lucide icons replace emoji and decorative glyphs.

## Typography

- Geist Sans remains the UI typeface; Geist Mono is limited to workflow IDs, timestamps, durations, payloads, and logs.
- Navigation and body text use a readable 14px baseline; metadata may use 12px.
- Labels use medium weight and sentence case. Uppercase is limited to short operational eyebrows.
- Heading hierarchy relies on size, weight, and spacing rather than mixing type families.
- Muted text must preserve at least WCAG AA contrast in both themes.

## Sidebar and Shell

- Keep the 240px desktop footprint and existing route structure.
- Use a dark, visually separate sidebar with a quieter brand block and stronger information hierarchy.
- Active navigation gets a cobalt-tinted surface plus a slim moving indicator; hover never shifts layout.
- Bottom navigation and account controls retain their current behavior but use clearer grouping and larger hit targets.
- Mobile drawer keeps the existing overlay and spring entrance, with focus-visible controls and reduced-motion fallback.
- Main content moves to a cool-gray operational background; cards and toolbars become distinct without heavy shadows.

## Workflow List

- Preserve dense table-first information architecture.
- Replace workflow emoji with deterministic Lucide icons based on workflow/trigger type.
- Consolidate search, filters, tabs, view controls, and create action into a clearer toolbar hierarchy.
- Keep status text alongside color so color is never the sole signal.
- Selection uses cobalt-tinted rows and a stable checkbox treatment.
- Only affected rows animate during filtering, insertion, deletion, or view changes; the full table does not replay on every render.
- Menus open near their trigger, restore focus when closed, and use a fast scale/fade transition.

## Workflow Builder

- Keep the current React Flow layout and editing behavior.
- Use a subtle neutral grid, higher-contrast nodes, clear ports, and category/state rails instead of purple glow.
- Selected nodes gain a cobalt border and restrained depth; processing, success, and error states remain distinguishable by icon and label as well as color.
- The inspector enters with spatial continuity from the right and updates without remounting the whole canvas.
- Save and run feedback must be immediate and must not block editing longer than the mock operation requires.

## Motion Thesis

**Focal moment:** running a workflow sends a compact data packet along the exact React Flow edges. On arrival, the destination node transitions from idle to processing and then success or error. This is the only authored sequence.

**Continuity:** the sidebar indicator moves between routes; workflow rows preserve position during filtering; menus and the inspector reveal from their spatial origin.

**Feedback:** buttons acknowledge press, save state changes visibly, selection is immediate, and running/status changes use restrained color and icon transitions.

**Budget:** routine feedback is 100–150ms, state changes 150–250ms, panels 250–350ms, and the focal edge sequence may use 400–650ms per meaningful step. Prefer transform and opacity. Avoid persistent glow, particles, bounce, parallax, and decorative infinite loops.

## Reduced Motion and Performance

- Respect `prefers-reduced-motion`; remove large spatial travel and edge-packet movement while retaining immediate state/color/icon feedback.
- Keep content visible before JavaScript animation starts.
- Do not animate layout-driving width, height, top, or left values for routine transitions.
- Pause nonessential motion when the surface is hidden; no decorative animation runs indefinitely.
- Reuse the existing Framer Motion dependency; do not add a second animation library.

## Verification

- Build and lint the Web app.
- Verify Workflow list and Builder at 375px, 768px, 1024px, and 1440px widths.
- Check light and dark themes.
- Check keyboard focus and menu behavior.
- Check the reduced-motion media preference.
- Confirm workflow filtering, selection, create, run, and builder interactions still behave as before.
- Capture one bounded visual QA pass, apply one consolidated fix batch, then perform at most one confirmation pass.

## Acceptance Criteria

1. Scoped surfaces contain no purple UI accents or emoji icons.
2. Sidebar navigation and body copy are clearly readable at normal desktop scaling.
3. Workflow list remains dense and usable while gaining clear hover, selection, menu, and state feedback.
4. Builder nodes and edges communicate idle, selected, processing, success, and error states.
5. Run motion follows actual graph edges and does not interfere with editing.
6. Reduced-motion users receive equivalent state feedback without significant spatial movement.
7. Existing routes and mock API behavior remain unchanged.
