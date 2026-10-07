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

async function stubWorkflows(page: Page, opts: { createStatus?: number } = {}) {
  const posts: unknown[] = [];
  const generates: unknown[] = [];
  await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/workflows**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/workflows/generate")) {
      generates.push(request.postDataJSON());
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

test.describe("Create with AI page", () => {
  test("creates a draft and opens the builder with the generate panel prefilled, once", async ({ page }) => {
    await installAuthFixture(page);
    const { posts, generates } = await stubWorkflows(page);
    await gotoGenerator(page);

    await page.locator("#workflow-prompt").fill(PROMPT);
    await page.getByTestId("ai-generator-continue").click();

    await expect(page).toHaveURL(new RegExp(`/workflows/${WORKFLOW_ID}/builder$`));
    expect(posts).toEqual([{ name: "When a new email arrives in Gmail, add the sender to Google…" }]);
    const dialog = page.getByRole("dialog", { name: "Generate with AI" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox").first()).toHaveValue(PROMPT);
    expect(generates).toEqual([]);

    // AI-disabled error from the generate route is shown in plain words.
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("AI is unavailable right now.");
    expect(generates).toHaveLength(1);
    expect((generates[0] as { prompt: string }).prompt).toBe(PROMPT);

    await page.reload();
    await expect(page.getByTestId("workflow-generate-ai")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Generate with AI" })).toHaveCount(0);
    expect(generates).toHaveLength(1);
  });

  test("shows a friendly error and stays when the draft cannot be created", async ({ page }) => {
    await installAuthFixture(page);
    const { posts } = await stubWorkflows(page, { createStatus: 500 });
    await gotoGenerator(page);

    await page.locator("#workflow-prompt").fill(PROMPT);
    await page.getByTestId("ai-generator-continue").click();

    await expect(page.getByTestId("ai-generator-error")).toHaveText("We could not create the draft. Please try again in a few minutes.");
    await expect(page).toHaveURL(/\/ai\/workflow-generator$/);
    await expect(page.locator("#workflow-prompt")).toHaveValue(PROMPT);
    expect(posts).toHaveLength(1);
  });

  test("the button stays disabled until something is typed; examples fill the box", async ({ page }) => {
    await installAuthFixture(page);
    await stubWorkflows(page);
    await gotoGenerator(page);

    await expect(page.getByTestId("ai-generator-continue")).toBeDisabled();
    await page.getByRole("button", { name: "Daily email summary" }).click();
    await expect(page.locator("#workflow-prompt")).toHaveValue(/summarize new Gmail emails/);
    await expect(page.getByTestId("ai-generator-continue")).toBeEnabled();
  });
});
