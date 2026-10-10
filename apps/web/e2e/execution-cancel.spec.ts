import { expect, test, type Page, type Route } from "@playwright/test";

// W6-C3: stop a run from the run detail page. The backend is stubbed with page.route (needs VITE_API_MODE=http).
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

const workflow = {
  workflowId: WF,
  name: "Slow report",
  status: "PUBLISHED",
  currentVersionId: "50000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  publishedAt: "2026-10-01T00:00:00Z",
  definition: {
    schemaVersion: "1.0",
    nodes: [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "call", type: "http.request", config: {} },
    ],
    edges: [{ id: "e1", source: "manual", target: "call" }],
    variables: {},
  },
  editorState: { nodes: { manual: { name: "Manual", position: { x: 0, y: 0 } }, call: { name: "Call API", position: { x: 0, y: 0 } } } },
};

const T0 = "2026-10-07T10:00:00Z";
const T1 = "2026-10-07T10:00:03Z";

function detail(status: string) {
  const finished = status === "SUCCESS" || status === "CANCELLED";
  return {
    executionId: RUN,
    workflowId: WF,
    workflowVersionId: workflow.currentVersionId,
    status,
    triggerType: "MANUAL",
    createdAt: T0,
    startedAt: T0,
    finishedAt: finished ? T1 : null,
    nodes: [
      { nodeExecutionId: "60000000-0000-4000-8000-000000000001", nodeId: "manual", nodeType: "trigger.manual", status: "SUCCESS", attemptCount: 1, startedAt: T0, finishedAt: T0, output: { ok: true }, error: null, attempts: [] },
      {
        nodeExecutionId: "60000000-0000-4000-8000-000000000002",
        nodeId: "call",
        nodeType: "http.request",
        status: status === "SUCCESS" ? "SUCCESS" : status === "CANCELLED" ? "CANCELLED" : "RUNNING",
        attemptCount: 1,
        startedAt: T0,
        finishedAt: status === "SUCCESS" ? T1 : null,
        output: null,
        error: null,
        attempts: [],
      },
    ],
    logs: { items: [], page: 0, size: 100, totalElements: 0, hasNext: false },
  };
}

type State = { status: string; cancelCalls: number; cancelAnswer: () => { status: number; body: unknown } };

async function install(page: Page, state: State) {
  await page.addInitScript(() => {
    localStorage.setItem("weav_token", "execution-cancel-token");
    localStorage.setItem("weav_lang_v1", "VI");
  });
  await page.route("**/api/auth/me", (route) => json(route, user));
  await page.route("**/api/v2/notifications/unread-count", (route) => json(route, { count: 0 }));
  await page.route("**/api/v1/workspaces**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const base = `/api/v1/workspaces/${WS}`;
    if (pathname === "/api/v1/workspaces") return json(route, { items: [workspace], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    if (pathname === base) return json(route, workspace);
    if (pathname === `${base}/members`) return json(route, { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    if (pathname === `${base}/workflows/${WF}`) return json(route, workflow);
    if (pathname === `${base}/workflows/${WF}/executions`) {
      return json(route, { items: [{ ...detail(state.status), nodes: undefined, logs: undefined }], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    }
    if (pathname === `${base}/workflows/${WF}/executions/${RUN}/cancel` && route.request().method() === "POST") {
      state.cancelCalls += 1;
      const answer = state.cancelAnswer();
      return json(route, answer.body, answer.status);
    }
    if (pathname === `${base}/workflows/${WF}/executions/${RUN}`) return json(route, detail(state.status));
    return json(route, { error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  });
}

const open = (page: Page) => page.goto(`/workflows/${WF}/executions?run=${RUN}`);

test.describe("stop a run (stubbed backend)", () => {
  test("a running run can be stopped after a confirm, shows Đang dừng… and then Đã dừng", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
    page.on("pageerror", (error) => problems.push(error.message));
    const state: State = { status: "RUNNING", cancelCalls: 0, cancelAnswer: () => ({ status: 202, body: { status: "CANCEL_REQUESTED" } }) };
    await install(page, state);
    await open(page);

    const badge = page.getByTestId("execution-status");
    await expect(badge).toHaveText("Đang chạy");
    await page.getByTestId("execution-stop").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Bước đang chạy sẽ hoàn tất trước");
    await dialog.getByRole("button", { name: "Dừng lượt chạy" }).click();

    await expect(badge).toHaveText("Đang dừng…");
    await expect(page.getByTestId("execution-stop")).toBeDisabled();
    expect(state.cancelCalls).toBe(1);

    state.status = "CANCELLED";
    await expect(badge).toHaveText("Đã dừng", { timeout: 8000 });
    await expect(page.getByTestId("execution-stop")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("keeping the run does not call the API", async ({ page }) => {
    const state: State = { status: "RUNNING", cancelCalls: 0, cancelAnswer: () => ({ status: 202, body: { status: "CANCEL_REQUESTED" } }) };
    await install(page, state);
    await open(page);

    await page.getByTestId("execution-stop").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Để chạy tiếp" }).click();

    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(state.cancelCalls).toBe(0);
    await expect(page.getByTestId("execution-status")).toHaveText("Đang chạy");
  });

  test("a run that finished in the meantime answers 409 and says so", async ({ page }) => {
    const state: State = {
      status: "RUNNING",
      cancelCalls: 0,
      cancelAnswer: () => {
        state.status = "SUCCESS";
        return { status: 409, body: { error: { code: "EXECUTION_ALREADY_FINISHED", message: "The execution has already finished" } } };
      },
    };
    await install(page, state);
    await open(page);

    await page.getByTestId("execution-stop").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Dừng lượt chạy" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Lượt chạy đã kết thúc, không thể dừng." })).toBeVisible();
    await expect(page.getByTestId("execution-status")).toHaveText("Thành công");
    await expect(page.getByTestId("execution-stop")).toHaveCount(0);
  });

  test("a finished run has no stop button", async ({ page }) => {
    const state: State = { status: "SUCCESS", cancelCalls: 0, cancelAnswer: () => ({ status: 409, body: {} }) };
    await install(page, state);
    await open(page);

    await expect(page.getByTestId("execution-status")).toHaveText("Thành công");
    await expect(page.getByTestId("execution-stop")).toHaveCount(0);
  });
});

// W6-C3: the variable picker offers the run values ({{ now }}, {{ run.id }}, ...) under "Lần chạy".
test.describe("run values in the variable picker (stubbed backend)", () => {
  const BUILDER_WF = "00000000-0000-4000-8000-000000000002";
  const base = `**/api/v1/workspaces/${WS}/workflows/${BUILDER_WF}`;
  const draft = {
    workflowId: BUILDER_WF,
    name: "Picker",
    status: "DRAFT",
    schemaVersion: "1.0",
    definition: { schemaVersion: "1.0", nodes: [{ id: "manual", type: "trigger.manual", config: {} }], edges: [], variables: {} },
    editorState: { nodes: { manual: { name: "Manual trigger", position: { x: 100, y: 120 } } } },
    currentVersionId: null,
    createdAt: "2026-10-07T10:00:00Z",
    updatedAt: "2026-10-07T10:00:00Z",
    publishedAt: null,
    triggers: [],
  };

  test("lists the four run values and inserts them without a prefix", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("weav_token", "execution-cancel-token");
      localStorage.setItem("weav_lang_v1", "VI");
    });
    await page.route("**/api/auth/me", (route) => json(route, { id: USER, email: "test@example.test", displayName: "Playwright User" }));
    await page.route("**/api/v1/workspaces?**", (route) => json(route, { items: [{ id: WS, name: "Real Workspace", role: "OWNER" }], page: 0, size: 100, totalElements: 1, totalPages: 1 }));
    await page.route(`**/api/v1/workspaces/${WS}/connections**`, (route) => json(route, { items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }));
    await page.route(base, (route) => json(route, draft));
    await page.route(`${base}/draft`, (route) => json(route, draft));

    await page.goto(`/workflows/${BUILDER_WF}/builder`);
    await page.getByTestId("workflow-add-step").click();
    await page.locator('[data-testid="workflow-palette-item"][data-node-type="http.request"]').click();
    await page.locator("#http-body").click();
    await page.getByTestId("variable-picker-toggle").click();

    const group = page.getByTestId("variable-run-group");
    await expect(group).toContainText("Lần chạy");
    await expect(group.getByTestId("variable-option")).toHaveText(["now", "run.id", "workflow.id", "workflow.name"]);
    await group.getByRole("button", { name: "workflow.name", exact: true }).click();
    await expect(page.locator("#http-body")).toHaveAttribute("data-value", "{{ workflow.name }}");
    await group.getByRole("button", { name: "now", exact: true }).click();
    await expect(page.locator("#http-body")).toHaveAttribute("data-value", "{{ workflow.name }}{{ now }}");
  });
});
