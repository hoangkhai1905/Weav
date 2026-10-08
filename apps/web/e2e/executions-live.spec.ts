import { expect, test, type Page, type Route } from "@playwright/test";

const WS = "00000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const WF = "30000000-0000-4000-8000-000000000001";
const RUN = "40000000-0000-4000-8000-000000000001";

const user = {
  id: USER,
  email: "owner@example.test",
  displayName: "Workspace Owner",
  avatarUrl: null,
  systemRole: "USER",
  status: "ACTIVE",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  emailVerifiedAt: null,
};
const workspace = { id: WS, name: "Alpha", createdBy: USER, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" };

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Definition order: send, hook, manual; graph order is hook -> send, manual is an unused legacy trigger. */
const workflow = {
  workflowId: WF,
  name: "Reply to webhook",
  status: "PUBLISHED",
  currentVersionId: "50000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  publishedAt: "2026-10-01T00:00:00Z",
  definition: {
    schemaVersion: "1.0",
    nodes: [
      { id: "send", type: "email.send", config: {} },
      { id: "hook", type: "trigger.webhook", config: {} },
      { id: "manual", type: "trigger.manual", config: {} },
    ],
    edges: [{ id: "e1", source: "hook", target: "send" }],
    variables: {},
  },
  editorState: {
    nodes: {
      send: { name: "Send email", position: { x: 0, y: 0 } },
      hook: { name: "Webhook in", position: { x: 0, y: 0 } },
      manual: { name: "Old manual", position: { x: 0, y: 0 } },
    },
  },
};

const T0 = "2026-10-07T10:00:00Z";
const T1 = "2026-10-07T10:00:01Z";
const T2 = "2026-10-07T10:00:03Z";

type NodeSpec = { nodeId: string; nodeType: string; status: string; error?: unknown; started?: string; finished?: string };

function node(spec: NodeSpec, index: number) {
  return {
    nodeExecutionId: `60000000-0000-4000-8000-00000000000${index}`,
    nodeId: spec.nodeId,
    nodeType: spec.nodeType,
    status: spec.status,
    attemptCount: spec.started ? 1 : 0,
    startedAt: spec.started ?? null,
    finishedAt: spec.finished ?? null,
    output: spec.status === "SUCCESS" ? { ok: true } : null,
    error: spec.error ?? null,
    attempts: [],
  };
}

function detail(status: string, nodes: NodeSpec[]) {
  const terminal = status === "SUCCESS" || status === "FAILED";
  return {
    executionId: RUN,
    workflowId: WF,
    workflowVersionId: workflow.currentVersionId,
    status,
    triggerType: "MANUAL",
    createdAt: T0,
    startedAt: T0,
    finishedAt: terminal ? T2 : null,
    // API order is deliberately not graph order.
    nodes: nodes.map(node),
    logs: { items: [], page: 0, size: 100, totalElements: 0, hasNext: false },
  };
}

async function install(page: Page, state: { status: () => string; nodes: () => NodeSpec[]; detailCalls: () => void; failDetail?: () => boolean }) {
  await page.addInitScript(() => {
    localStorage.setItem("weav_token", "executions-live-token");
    localStorage.setItem("weav_lang_v1", "EN");
  });
  await page.route("**/api/auth/me", (route) => json(route, user));
  await page.route("**/api/v2/notifications/unread-count", (route) => json(route, { count: 0 }));
  await page.route("**/api/v1/workspaces**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/workspaces") return json(route, { items: [workspace], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    if (pathname === `/api/v1/workspaces/${WS}`) return json(route, workspace);
    if (pathname === `/api/v1/workspaces/${WS}/members`) return json(route, { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    if (pathname === `/api/v1/workspaces/${WS}/workflows`) {
      const summary: Record<string, unknown> = { ...workflow };
      delete summary.definition;
      delete summary.editorState;
      return json(route, { items: [{ ...summary, triggerTypes: ["trigger.manual", "trigger.webhook"] }], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}`) return json(route, workflow);
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}/executions`) {
      const d = detail(state.status(), state.nodes());
      const summary = { ...d, nodes: undefined, logs: undefined };
      return json(route, { items: [summary], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    if (pathname === `/api/v1/workspaces/${WS}/workflows/${WF}/executions/${RUN}`) {
      state.detailCalls();
      if (state.failDetail?.()) return json(route, { error: { code: "BOOM", message: "down" } }, 500);
      return json(route, detail(state.status(), state.nodes()));
    }
    return json(route, { error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  });
}

const open = (page: Page) => page.goto(`/workflows/${WF}/executions?run=${RUN}`);
const rowNames = (page: Page) => page.getByTestId("execution-step-row").locator("span.font-medium");

test.describe("run history (stubbed backend)", () => {
  test("polls every 2 s while RUNNING, stops at SUCCESS, shows graph order and a not-run step", async ({ page }) => {
    let calls = 0;
    const running: NodeSpec[] = [
      { nodeId: "manual", nodeType: "trigger.manual", status: "SKIPPED" },
      { nodeId: "send", nodeType: "email.send", status: "RUNNING", started: T1 },
      { nodeId: "hook", nodeType: "trigger.webhook", status: "SUCCESS", started: T0, finished: T1 },
    ];
    const done: NodeSpec[] = [
      { nodeId: "manual", nodeType: "trigger.manual", status: "SKIPPED" },
      { nodeId: "send", nodeType: "email.send", status: "SUCCESS", started: T1, finished: T2 },
      { nodeId: "hook", nodeType: "trigger.webhook", status: "SUCCESS", started: T0, finished: T1 },
    ];
    const finished = () => calls >= 3;
    await install(page, {
      status: () => (finished() ? "SUCCESS" : "RUNNING"),
      nodes: () => (finished() ? done : running),
      detailCalls: () => { calls += 1; },
    });

    await open(page);
    await expect(page.getByTestId("execution-step-row")).toHaveCount(3);
    // Graph order: webhook first, then the step that depends on it, the unused legacy trigger last.
    await expect(rowNames(page)).toHaveText(["Webhook in", "Send email", "Old manual"]);
    // The skipped step is labelled, and the default selection is the first executed step.
    const skippedRow = page.getByTestId("execution-step-row").filter({ hasText: "Old manual" });
    await expect(skippedRow).toContainText("Not run");
    await expect(page.getByTestId("execution-step-row").first()).toHaveAttribute("aria-pressed", "true");
    await expect(skippedRow).toHaveAttribute("aria-pressed", "false");

    // It keeps polling while RUNNING and becomes SUCCESS without a manual refresh.
    await expect(page.locator("h2 + span", { hasText: "Success" })).toBeVisible({ timeout: 15_000 });
    expect(calls).toBeGreaterThanOrEqual(3);

    // Terminal: no further detail requests.
    const settled = calls;
    await page.waitForTimeout(4500);
    expect(calls).toBe(settled);
  });

  test("backs off when polling fails instead of hammering the API", async ({ page }) => {
    let calls = 0;
    const running: NodeSpec[] = [{ nodeId: "hook", nodeType: "trigger.webhook", status: "RUNNING", started: T0 }];
    await install(page, {
      status: () => "RUNNING",
      nodes: () => running,
      detailCalls: () => { calls += 1; },
      failDetail: () => calls > 1,
    });

    await open(page);
    await expect(page.getByTestId("execution-step-row")).toHaveCount(1);
    await page.waitForTimeout(9000);
    // 2 s, then 4 s, then 8 s between failed polls: at most the first load plus two retries in 9 s.
    expect(calls).toBeLessThanOrEqual(4);
  });

  test("shows the failing field with a label next to the error", async ({ page }) => {
    const error = {
      code: "CONFIGURATION_ERROR",
      message: "The 'to' field is not a valid email address.",
      details: { field: "to" },
    };
    const nodes: NodeSpec[] = [
      { nodeId: "send", nodeType: "email.send", status: "FAILED", started: T1, finished: T2, error },
      { nodeId: "hook", nodeType: "trigger.webhook", status: "SUCCESS", started: T0, finished: T1 },
      { nodeId: "manual", nodeType: "trigger.manual", status: "SKIPPED" },
    ];
    await install(page, { status: () => "FAILED", nodes: () => nodes, detailCalls: () => {} });

    await open(page);
    await expect(page.getByRole("alert").filter({ hasText: "To: This step is not configured correctly" })).toBeVisible();
    await expect(page.getByTestId("step-error-field")).toContainText("To");
    // The raw server message stays available in the details view.
    await expect(page.getByTestId("step-error-message")).toContainText("not configured correctly");
    await expect(page.getByText("The 'to' field is not a valid email address.")).toBeVisible();
    // The failed step is selected by default, not the skipped one.
    await expect(page.getByTestId("execution-step-row").filter({ hasText: "Send email" })).toHaveAttribute("aria-pressed", "true");
  });

  test("workflow list shows the real trigger, not a legacy manual node", async ({ page }) => {
    await install(page, { status: () => "SUCCESS", nodes: () => [], detailCalls: () => {} });

    await page.goto("/workflows");

    const row = page.getByRole("row").filter({ hasText: "Reply to webhook" });
    await expect(row).toContainText("WEBHOOK");
    await expect(row.getByRole("button", { name: /More workflow actions: Reply to webhook/ })).toBeVisible();
  });
});
