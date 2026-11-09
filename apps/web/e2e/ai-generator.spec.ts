import { expect, test, type Page, type Route } from "@playwright/test";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const WORKFLOW_ID = "40000000-0000-4000-8000-000000000001";

const user = {
  id: USER_ID,
  email: "owner@example.test",
  displayName: "Workspace Owner",
  avatarUrl: null,
  systemRole: "USER",
  status: "ACTIVE",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  emailVerifiedAt: null,
};

const workspace = {
  id: WORKSPACE_ID,
  name: "Alpha workspace",
  createdBy: USER_ID,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installAuthFixture(page: Page, extraWorkspaces: unknown[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem("weav_token", "assistant-token");
    localStorage.setItem("weav_lang_v1", "EN");
  });
  await page.route("**/api/auth/me", (route) => fulfillJson(route, user));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/v2/notifications/unread-count", (route) => fulfillJson(route, { count: 0 }));
  await page.route("**/api/v1/workspaces**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/workspaces" && route.request().method() === "GET") {
      return fulfillJson(route, { items: [workspace, ...extraWorkspaces], page: 0, size: 20, totalElements: 1 + extraWorkspaces.length, totalPages: 1 });
    }
    if (url.pathname === `/api/v1/workspaces/${WORKSPACE_ID}`) return fulfillJson(route, workspace);
    if (url.pathname === `/api/v1/workspaces/${WORKSPACE_ID}/members`) {
      return fulfillJson(route, { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    }
    return fulfillJson(route, { error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  });
}


const PROMPT = "When a new email arrives in Gmail, add the sender to Google Sheets.";
const emptyDetail = { workflowId: WORKFLOW_ID, name: "x", status: "DRAFT", definition: { schemaVersion: "1.0", nodes: [], edges: [], variables: {} }, editorState: { nodes: {} } };

async function stubWorkflows(
  page: Page,
  opts: { createStatus?: number; detail?: unknown; hold?: Promise<void>; generate?: (body: Record<string, unknown>) => unknown } = {},
) {
  const posts: unknown[] = [];
  const generates: unknown[] = [];
  const drafts: Array<{ definition: { nodes: Array<{ type: string; config: Record<string, unknown> }> } }> = [];
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/workflows**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/workflows/generate")) {
      generates.push(request.postDataJSON());
      await opts.hold;
      if (opts.generate) return fulfillJson(route, opts.generate(request.postDataJSON()));
      return fulfillJson(route, { error: { code: "AI_DISABLED", message: "AI disabled" } }, 503);
    }
    if (request.method() === "POST") {
      posts.push(request.postDataJSON());
      if (opts.createStatus) return fulfillJson(route, { error: { code: "INTERNAL", message: "boom" } }, opts.createStatus);
      return fulfillJson(route, { workflowId: WORKFLOW_ID }, 201);
    }
    if (request.method() === "PUT" && path.endsWith(`/workflows/${WORKFLOW_ID}/draft`)) {
      drafts.push(request.postDataJSON());
      return fulfillJson(route, opts.detail ?? emptyDetail);
    }
    if (path.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, opts.detail ?? emptyDetail);
    return fulfillJson(route, { items: [], page: 0, size: 100, totalElements: 0 });
  });
  return { posts, generates, drafts };
}

async function gotoGenerator(page: Page) {
  const profileResponse = page.waitForResponse((response) => response.url().includes("/api/auth/me"));
  await page.goto("/ai/workflow-generator");
  await profileResponse;
  if (new URL(page.url()).pathname === "/login") await page.goto("/ai/workflow-generator");
}

async function openGeneratePanel(page: Page) {
  const profileResponse = page.waitForResponse((response) => response.url().includes("/api/auth/me"));
  await page.goto(`/workflows/${WORKFLOW_ID}/builder`);
  await profileResponse;
  await page.getByTestId("workflow-generate-ai").click();
  return page.getByRole("dialog", { name: "Generate with AI" });
}

test.describe("Create with AI page", () => {
  test("shows the AI-disabled error in plain words and keeps the prompt", async ({ page }) => {
    await installAuthFixture(page);
    const { generates } = await stubWorkflows(page);
    await gotoGenerator(page);

    await page.getByLabel("What should this workflow do?").fill(PROMPT);
    await page.getByRole("button", { name: "Generate workflow", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText("AI is unavailable right now.");
    await expect(page.getByLabel("What should this workflow do?")).toHaveValue(PROMPT);
    expect(generates).toHaveLength(1);
    expect((generates[0] as { prompt: string }).prompt).toBe(PROMPT);
  });

  const gmailConnection = {
    id: "20000000-0000-4000-8000-000000000001",
    workspaceId: WORKSPACE_ID,
    createdBy: USER_ID,
    name: "Work Gmail",
    provider: "GMAIL",
    authType: "OAUTH2",
    status: "ACTIVE",
    config: null,
    hasCredential: true,
    credentialExpiresAt: null,
    lastVerifiedAt: null,
    canManage: true,
    canAttach: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
  const ready = {
    status: "ready",
    name: "Email report",
    definition: {
      schemaVersion: "1.0",
      nodes: [
        { id: "start", type: "trigger.manual", config: {} },
        { id: "send_email", type: "email.send", config: { to: "owner@example.test" } },
      ],
      edges: [{ id: "e1", source: "start", target: "send_email" }],
      variables: {},
    },
    layout: { start: { x: 100, y: 100 }, send_email: { x: 400, y: 100 } },
  };

  // Registered after installAuthFixture, so it wins over that fixture's 404 for unknown workspace paths.
  async function stubConnections(page: Page, response: { status?: number; body: unknown }) {
    await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/connections`, (route) =>
      fulfillJson(route, response.body, response.status ?? 200),
    );
  }

  const emailConnectionId = (draft: { definition: { nodes: Array<{ type: string; config: Record<string, unknown> }> } }) =>
    draft.definition.nodes.find((node) => node.type === "email.send")?.config.connectionId;

  async function generateFromPrompt(page: Page, mode: "click" | "dblclick" = "click") {
    await gotoGenerator(page);
    await page.getByLabel("What should this workflow do?").fill(PROMPT);
    await page.getByRole("button", { name: "Generate workflow", exact: true })[mode]();
  }

  test("builds the draft at once and opens the builder", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { body: [gmailConnection] });
    const { generates, posts, drafts } = await stubWorkflows(page, { generate: () => ready });
    await generateFromPrompt(page);

    await page.waitForURL(`**/workflows/${WORKFLOW_ID}/builder`);
    expect(generates).toHaveLength(1);
    expect(generates[0]).toMatchObject({ prompt: PROMPT, allowBlanks: true });
    expect(generates[0]).not.toHaveProperty("answers");
    expect(generates[0]).not.toHaveProperty("connections");
    expect(posts).toHaveLength(1);
    expect(drafts).toHaveLength(1);
    expect(emailConnectionId(drafts[0])).toBe(gmailConnection.id);
  });

  test("leaves the connection blank when none fits", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { body: [] });
    const { posts, drafts } = await stubWorkflows(page, { generate: () => ready });
    await generateFromPrompt(page);

    await page.waitForURL(`**/workflows/${WORKFLOW_ID}/builder`);
    expect(posts).toHaveLength(1);
    expect(emailConnectionId(drafts[0])).toBeUndefined();
  });

  test("keeps going when connections cannot load", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { status: 500, body: { error: { code: "INTERNAL", message: "boom" } } });
    const { posts, drafts } = await stubWorkflows(page, { generate: () => ready });
    await generateFromPrompt(page);

    await page.waitForURL(`**/workflows/${WORKFLOW_ID}/builder`);
    expect(posts).toHaveLength(1);
    expect(emailConnectionId(drafts[0])).toBeUndefined();
  });

  test("creates only one draft on a double click", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { body: [gmailConnection] });
    const { generates, posts, drafts } = await stubWorkflows(page, { generate: () => ready });
    await generateFromPrompt(page, "dblclick");

    await page.waitForURL(`**/workflows/${WORKFLOW_ID}/builder`);
    expect(generates).toHaveLength(1);
    expect(posts).toHaveLength(1);
    expect(drafts).toHaveLength(1);
  });

  test("shows what is unclear and keeps the prompt", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { body: [] });
    const { posts } = await stubWorkflows(page, {
      generate: () => ({ status: "needs_input", questions: [{ code: "SCHEDULE", field: "trigger.schedule.cron" }] }),
    });
    await generateFromPrompt(page);

    await expect(page.getByText("The AI needs a clearer description")).toBeVisible();
    await expect(page.getByText("When should it run?")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.getByLabel("What should this workflow do?")).toHaveValue(PROMPT);
    expect(posts).toHaveLength(0);
  });

  test("keeps the prompt when the draft cannot be created", async ({ page }) => {
    await installAuthFixture(page);
    await stubConnections(page, { body: [] });
    await stubWorkflows(page, { generate: () => ready, createStatus: 500 });
    await generateFromPrompt(page);

    await expect(page.getByRole("alert")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/ai/workflow-generator");
    await expect(page.getByLabel("What should this workflow do?")).toHaveValue(PROMPT);
    await expect(page.getByRole("button", { name: "Generate workflow", exact: true })).toBeEnabled();
  });

  test("drops a late AI result after the workspace changes", async ({ page }) => {
    const otherWorkspace = { ...workspace, id: "00000000-0000-4000-8000-000000000002", name: "Beta workspace" };
    await installAuthFixture(page, [otherWorkspace]);
    await stubConnections(page, { body: [gmailConnection] });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const { generates } = await stubWorkflows(page, { generate: () => ready, hold });
    // Any workspace's workflow writes count; the stub only sees the first workspace.
    const writes: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() !== "GET" && pathname.includes("/workflows") && !pathname.endsWith("/generate")) writes.push(pathname);
    });
    await generateFromPrompt(page);
    await expect.poll(() => generates.length).toBe(1);

    await page.getByTestId("topbar-workspace-selector").selectOption(otherWorkspace.id);
    release();
    await page.waitForTimeout(500);

    expect(writes).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/ai/workflow-generator");
  });
});

test.describe("Generate with AI panel in the builder", () => {
  test("shows the AI-disabled error from the generate route in plain words", async ({ page }) => {
    await installAuthFixture(page);
    const { generates } = await stubWorkflows(page);
    const dialog = await openGeneratePanel(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("AI is unavailable right now.");
    expect(generates).toHaveLength(1);
    expect((generates[0] as { prompt: string }).prompt).toBe(PROMPT);
  });

  test("builds the workflow at once with blanks allowed and no questions", async ({ page }) => {
    await installAuthFixture(page);
    const ready = {
      status: "ready",
      name: "Welcome email",
      definition: {
        schemaVersion: "1.0",
        nodes: [
          { id: "start", type: "trigger.manual", config: {} },
          { id: "send_email", type: "email.send", config: { to: "a@example.test", subject: "Hi" } },
        ],
        edges: [{ id: "e1", source: "start", target: "send_email" }],
        variables: {},
      },
      layout: { start: { x: 100, y: 100 }, send_email: { x: 400, y: 100 } },
    };
    const { generates } = await stubWorkflows(page, { generate: () => ready });
    const dialog = await openGeneratePanel(page);
    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    expect(generates).toHaveLength(1);
    expect(generates[0]).toMatchObject({ prompt: PROMPT, allowBlanks: true });
    expect(generates[0]).not.toHaveProperty("answers");
  });
  test("shows one notice instead of questions when the request is unclear", async ({ page }) => {
    await installAuthFixture(page);
    await stubWorkflows(page, {
      generate: () => ({ status: "needs_input", questions: [{ code: "VALUE", field: "send_email.config.to" }] }),
    });
    const dialog = await openGeneratePanel(page);
    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByText("The AI needs a clearer description")).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Continue" })).toHaveCount(0);
  });
  test("keeps the panel open and the prompt when the request is unsupported", async ({ page }) => {
    await installAuthFixture(page);
    const { generates } = await stubWorkflows(page, {
      generate: () => ({ status: "unsupported", reasons: [{ code: "OUT_OF_SCOPE" }] }),
    });
    const dialog = await openGeneratePanel(page);
    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByText("AI cannot build this workflow:")).toBeVisible();
    await expect(dialog.getByText("This request is out of scope.")).toBeVisible();
    await expect(dialog.getByRole("textbox").first()).toHaveValue(PROMPT);
    expect(generates).toHaveLength(1);
  });
});

test.describe("Unfinished steps", () => {
  test("marks a step without a connection in red", async ({ page }) => {
    await installAuthFixture(page);
    await stubWorkflows(page, {
      detail: {
        ...emptyDetail,
        definition: {
          schemaVersion: "1.0",
          nodes: [
            { id: "start", type: "trigger.manual", config: {} },
            { id: "send_email", type: "email.send", config: { to: "owner@example.test", subject: "Hi" } },
          ],
          edges: [{ id: "e1", source: "start", target: "send_email" }],
          variables: {},
        },
      },
    });
    const profileResponse = page.waitForResponse((response) => response.url().includes("/api/auth/me"));
    await page.goto(`/workflows/${WORKFLOW_ID}/builder`);
    await profileResponse;

    const email = page.locator('[data-testid="workflow-node"][data-node-type="email.send"]');
    await expect(email).toHaveAttribute("data-readiness", "not-configured");
    await expect(email).toHaveClass(/border-err/);
    await expect(email.getByTestId("workflow-node-readiness")).toHaveClass(/text-err/);
    await expect(page.locator('[data-testid="workflow-node"][data-node-type="trigger.manual"]')).not.toHaveClass(/border-err/);
  });
  const openBuilderWith = async (page: Page, nodes: unknown[], edges: unknown[] = []) => {
    await installAuthFixture(page);
    await stubWorkflows(page, {
      detail: { ...emptyDetail, definition: { schemaVersion: "1.0", nodes, edges, variables: {} } },
    });
    const profileResponse = page.waitForResponse((response) => response.url().includes("/api/auth/me"));
    await page.goto(`/workflows/${WORKFLOW_ID}/builder`);
    await profileResponse;
  };
  const emailNodes = [
    { id: "start", type: "trigger.manual", config: {} },
    { id: "send_email", type: "email.send", config: { to: "owner@example.test", subject: "Hi" } },
  ];
  const emailEdges = [{ id: "e1", source: "start", target: "send_email" }];

  test("lists unfinished steps and opens one on click", async ({ page }) => {
    await openBuilderWith(page, emailNodes, emailEdges);
    const chip = page.getByTestId("publish-blocker-summary").getByRole("button", { name: /^Set up step / });
    await expect(chip).toHaveCount(1);
    await chip.click();
    await expect(page.getByTestId("workflow-inspector")).toBeVisible();
    await expect(page.getByTestId("inspector-readiness-badge")).toHaveClass(/text-err/);
    await expect(page.locator('[data-testid="workflow-node"][data-node-type="email.send"]')).toHaveClass(/ring-run/);
  });

  test("a step without a name falls back to its type label", async ({ page }) => {
    await openBuilderWith(page, emailNodes, emailEdges);
    const chip = page.getByTestId("setup-step-chip");
    await expect(chip).toContainText("Send an email with Gmail");
    await expect(chip).not.toContainText("send_email");
  });

  test("shows no step chips when every step is ready", async ({ page }) => {
    await openBuilderWith(page, [
      { id: "start", type: "trigger.manual", config: {} },
      { id: "check", type: "logic.condition", config: { left: "{{a}}", operator: "equals", right: "1" } },
    ], [{ id: "e1", source: "start", target: "check" }]);
    await expect(page.locator('[data-testid="workflow-node"]')).toHaveCount(2);
    await expect(page.getByTestId("setup-step-chip")).toHaveCount(0);
  });

  test("lists a red step even when it has no publish blocker message", async ({ page }) => {
    await openBuilderWith(page, [{ id: "events", type: "trigger.workflow_event", config: {} }]);
    await expect(page.locator('[data-testid="workflow-node"][data-node-type="trigger.workflow_event"]')).toHaveAttribute("data-readiness", "not-configured");
    await expect(page.getByTestId("setup-step-chip")).toHaveCount(1);
  });
});
