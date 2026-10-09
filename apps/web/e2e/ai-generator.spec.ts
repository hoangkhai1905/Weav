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

async function installAuthFixture(page: Page) {
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
      return fulfillJson(route, { items: [workspace], page: 0, size: 20, totalElements: 1, totalPages: 1 });
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
  opts: { createStatus?: number; generate?: (body: Record<string, unknown>) => unknown } = {},
) {
  const posts: unknown[] = [];
  const generates: unknown[] = [];
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/workflows**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/workflows/generate")) {
      generates.push(request.postDataJSON());
      if (opts.generate) return fulfillJson(route, opts.generate(request.postDataJSON()));
      return fulfillJson(route, { error: { code: "AI_DISABLED", message: "AI disabled" } }, 503);
    }
    if (request.method() === "POST") {
      posts.push(request.postDataJSON());
      if (opts.createStatus) return fulfillJson(route, { error: { code: "INTERNAL", message: "boom" } }, opts.createStatus);
      return fulfillJson(route, { workflowId: WORKFLOW_ID }, 201);
    }
    if (path.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, emptyDetail);
    return fulfillJson(route, { items: [], page: 0, size: 100, totalElements: 0 });
  });
  return { posts, generates };
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

  test("asks a plain question for a missing value, then builds the workflow from the answer", async ({ page }) => {
    await installAuthFixture(page);
    const ready = {
      status: "ready",
      name: "Welcome email",
      definition: {
        schemaVersion: "1.0",
        nodes: [
          { id: "start", type: "trigger.manual", config: {} },
          { id: "send_email", type: "email.send", config: { to: "a@example.test", subject: "Hi", body: "Hello there" } },
        ],
        edges: [{ id: "e1", source: "start", target: "send_email" }],
        variables: {},
      },
      layout: { start: { x: 100, y: 100 }, send_email: { x: 400, y: 100 } },
    };
    const { generates } = await stubWorkflows(page, {
      generate: (body) =>
        (body.answers as Record<string, string> | undefined)?.["email.send.body"]
          ? ready
          : { status: "needs_input", questions: [{ code: "VALUE", field: "email.send.body" }] },
    });
    const dialog = await openGeneratePanel(page);
    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    const question = dialog.getByLabel("What should the email say?");
    await expect(question).toBeVisible();
    await expect(dialog.getByTestId("generate-questions")).not.toContainText("email.send");
    await expect(dialog.getByTestId("generate-questions")).not.toContainText("config");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();

    await question.fill("Hello there");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    expect(generates).toHaveLength(2);
    expect((generates[1] as { prompt: string }).prompt).toBe(PROMPT);
    expect((generates[1] as { answers: unknown }).answers).toEqual({ "email.send.body": "Hello there" });
  });
});
