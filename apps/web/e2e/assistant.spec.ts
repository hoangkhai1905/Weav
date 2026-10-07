import { expect, test, type Page, type Route } from "@playwright/test";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_A = "30000000-0000-4000-8000-00000000000a";
const CONVERSATION_B = "30000000-0000-4000-8000-00000000000b";
const NEW_CONVERSATION = "30000000-0000-4000-8000-00000000000c";
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

const conversations = [
  { conversationId: CONVERSATION_A, title: "Failed runs", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" },
  { conversationId: CONVERSATION_B, title: "Daily report", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
];

const draftDefinition = {
  schemaVersion: "1.0",
  nodes: [
    { id: "t1", type: "trigger.manual", config: {} },
    { id: "n2", type: "email.send", config: { subject: "Hi" } },
  ],
  edges: [{ id: "e1", source: "t1", target: "n2" }],
  variables: {},
};
const draftLayout = { t1: { name: "Start", position: { x: 10, y: 20 } }, n2: { name: "Mail", position: { x: 300, y: 20 } } };

function sse(...frames: Array<[string, unknown]>) {
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function fulfillStream(route: Route, body: string) {
  await route.fulfill({ status: 200, contentType: "text/event-stream", body });
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

async function stubConversationList(page: Page, items = conversations) {
  await page.route("**/api/v1/assistant/conversations?**", (route) => fulfillJson(route, { items }));
}

async function gotoAssistant(page: Page) {
  const profileResponse = page.waitForResponse((response) => response.url().includes("/api/auth/me"));
  await page.goto("/assistant");
  await profileResponse;
  if (new URL(page.url()).pathname === "/login") await page.goto("/assistant");
}

async function ask(page: Page, text: string) {
  await page.getByTestId("assistant-input").fill(text);
  await page.getByTestId("assistant-send").click();
}

test.describe("AI assistant page", () => {
  test("lists conversations and opens history", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page);
    await page.route(`**/api/v1/assistant/conversations/${CONVERSATION_A}/messages`, (route) =>
      fulfillJson(route, {
        conversationId: CONVERSATION_A,
        workspaceId: WORKSPACE_ID,
        title: "Failed runs",
        messages: [
          { role: "user", content: "What failed today?", createdAt: "2026-10-03T00:00:00Z" },
          { role: "assistant", content: "Line one\nLine two", createdAt: "2026-10-03T00:00:01Z" },
        ],
      }),
    );

    await gotoAssistant(page);
    await expect(page.getByTestId("assistant-conversation")).toHaveCount(2);
    await page.getByRole("button", { name: "Failed runs", exact: true }).click();
    await expect(page.getByTestId("assistant-message-user")).toHaveText("What failed today?");
    const reply = page.getByTestId("assistant-message-assistant");
    await expect(reply).toContainText("Line one");
    await expect(reply.locator("div.whitespace-pre-wrap")).toHaveText("Line one\nLine two");
  });

  test("streams deltas, shows tool chip and reuses conversationId", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page, []);
    const bodies: Array<Record<string, unknown>> = [];
    let authorization = "";
    await page.route("**/api/v1/assistant/chat", async (route) => {
      bodies.push(route.request().postDataJSON());
      authorization = route.request().headers().authorization ?? "";
      // CRLF frames, a comment line, multi-line data, "data:" without a space and an unknown event.
      const body =
        bodies.length === 1
          ? `event: conversation\r\ndata: {"conversationId":"${NEW_CONVERSATION}"}\r\n\r\n` +
            `: keep-alive\n\n` +
            `event: tool_call\ndata: {"name":"list_workflows","arguments":{}}\n\n` +
            `event: tool_result\ndata: {"name":"list_workflows","ok":true}\n\n` +
            `event: ping\ndata: {}\n\n` +
            `event: delta\ndata:{"text":"Hello "}\n\n` +
            `event: delta\ndata: {"text":"wor\\nld",\ndata: "extra":1}\n\n` +
            `event: done\ndata: {}\n\n`
          : sse(["conversation", { conversationId: NEW_CONVERSATION }], ["delta", { text: "Second" }], ["done", {}]);
      await fulfillStream(route, body);
    });

    await gotoAssistant(page);
    await ask(page, "List my workflows");
    await expect(page.getByTestId("assistant-tool")).toHaveText("Looking up workflows");
    const reply = page.getByTestId("assistant-message-assistant");
    await expect(reply.locator("div.whitespace-pre-wrap")).toHaveText("Hello wor\nld");
    await expect(page.getByTestId("assistant-send")).toBeVisible();
    await expect(page.getByTestId("assistant-input")).toBeFocused();

    expect(authorization).toBe("Bearer assistant-token");
    expect(bodies[0]).toEqual({
      workspaceId: WORKSPACE_ID,
      message: "List my workflows",
      timezone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    });

    await ask(page, "And again");
    await expect(page.getByTestId("assistant-message-assistant").last()).toContainText("Second");
    expect(bodies[1]).toMatchObject({ workspaceId: WORKSPACE_ID, conversationId: NEW_CONVERSATION, message: "And again" });
  });

  test("draft card opens a new workflow in the builder", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page, []);
    await page.route("**/api/v1/assistant/chat", (route) =>
      fulfillStream(
        route,
        sse(
          ["conversation", { conversationId: NEW_CONVERSATION }],
          ["delta", { text: "Here is a draft." }],
          ["draft", { name: "Welcome mail", definition: draftDefinition, layout: draftLayout }],
          ["done", {}],
        ),
      ),
    );
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    await page.route(`**/api/v1/workspaces/${WORKSPACE_ID}/workflows**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" || request.method() === "PUT") {
        calls.push({ method: request.method(), path, body: request.postDataJSON() });
        return request.method() === "POST"
          ? fulfillJson(route, { workflowId: WORKFLOW_ID }, 201)
          : fulfillJson(route, { workflowId: WORKFLOW_ID, name: "Welcome mail", status: "DRAFT", definition: draftDefinition, editorState: { nodes: draftLayout } });
      }
      if (path.endsWith(`/workflows/${WORKFLOW_ID}`)) {
        return fulfillJson(route, { workflowId: WORKFLOW_ID, name: "Welcome mail", status: "DRAFT", definition: draftDefinition, editorState: { nodes: draftLayout } });
      }
      return fulfillJson(route, { items: [], page: 0, size: 100, totalElements: 0 });
    });

    await gotoAssistant(page);
    await ask(page, "Draft a welcome mail workflow");
    const card = page.getByTestId("assistant-draft");
    await expect(card).toContainText("Welcome mail");
    await expect(card).toContainText("2 nodes");
    await page.getByTestId("assistant-open-draft").click();

    await expect(page).toHaveURL(new RegExp(`/workflows/${WORKFLOW_ID}/builder$`));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /api/v1/workspaces/${WORKSPACE_ID}/workflows`,
      `PUT /api/v1/workspaces/${WORKSPACE_ID}/workflows/${WORKFLOW_ID}/draft`,
    ]);
    expect(calls[0].body).toEqual({ name: "Welcome mail" });
    expect(calls[1].body).toEqual({
      name: "Welcome mail",
      definition: draftDefinition,
      editorState: { nodes: draftLayout },
    });
  });

  test("maps pre-stream and stream errors to friendly messages", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page, []);
    const outcomes: Array<(route: Route) => Promise<void>> = [
      (route) => fulfillJson(route, { error: { code: "AI_BUSY", message: "upstream text" } }, 429),
      (route) => fulfillJson(route, { error: { code: "AI_QUOTA_EXCEEDED", message: "upstream text" } }, 429),
      (route) => fulfillJson(route, { error: { code: "TOO_MANY_REQUESTS", message: "x" } }, 429),
      (route) => fulfillStream(route, sse(["conversation", { conversationId: NEW_CONVERSATION }], ["delta", { text: "Partial" }], ["error", { code: "AI_TIMEOUT", message: "raw" }])),
    ];
    let call = 0;
    await page.route("**/api/v1/assistant/chat", (route) => outcomes[call++](route));

    await gotoAssistant(page);
    await ask(page, "one");
    await expect(page.getByTestId("assistant-error")).toHaveText("The assistant is busy. Please try again in a few minutes.");
    // The failed message is restored to the input so it can be resent.
    await expect(page.getByTestId("assistant-input")).toHaveValue("one");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-error").last()).toHaveText("You have used up today's assistant requests.");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-error").last()).toHaveText("You are sending requests too fast. Wait a moment and try again.");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByTestId("assistant-error").last()).toHaveText("The assistant took too long to respond. Please try again.");
    await expect(page.getByTestId("assistant-message-assistant").last()).toContainText("Partial");
  });

  test("shows the disabled state on 503", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/assistant/conversations?**", (route) =>
      fulfillJson(route, { error: { code: "SERVICE_UNAVAILABLE", message: "off" } }, 503),
    );
    await gotoAssistant(page);
    await expect(page.getByTestId("assistant-disabled")).toContainText("not enabled");
    await expect(page.getByTestId("assistant-input")).toHaveCount(0);
  });

  test("deletes a conversation after confirmation", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page);
    let deleted = "";
    await page.route(`**/api/v1/assistant/conversations/${CONVERSATION_A}`, (route) => {
      deleted = `${route.request().method()} ${new URL(route.request().url()).pathname}`;
      return route.fulfill({ status: 204, body: "" });
    });

    await gotoAssistant(page);
    await page.getByRole("button", { name: "Delete: Failed runs" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("assistant-conversation")).toHaveCount(1);
    expect(deleted).toBe(`DELETE /api/v1/assistant/conversations/${CONVERSATION_A}`);
  });

  test("retries the chat once after a 401 when the token was renewed", async ({ page }) => {
    await installAuthFixture(page);
    await stubConversationList(page, []);
    const tokens: string[] = [];
    await page.route("**/api/v1/assistant/chat", async (route) => {
      tokens.push(route.request().headers().authorization ?? "");
      if (tokens.length === 1) {
        await page.evaluate(() => localStorage.setItem("weav_token", "renewed-token"));
        return fulfillJson(route, { error: { code: "UNAUTHENTICATED", message: "expired" } }, 401);
      }
      return fulfillStream(route, sse(["conversation", { conversationId: NEW_CONVERSATION }], ["delta", { text: "Back again" }], ["done", {}]));
    });

    await gotoAssistant(page);
    await ask(page, "hello");
    await expect(page.getByTestId("assistant-message-assistant")).toContainText("Back again");
    expect(tokens).toEqual(["Bearer assistant-token", "Bearer renewed-token"]);
  });

  test("fits a 375px viewport without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installAuthFixture(page);
    await stubConversationList(page);
    await gotoAssistant(page);
    await expect(page.getByTestId("assistant-input")).toBeVisible();
    await page.getByRole("button", { name: "Conversations" }).click();
    await expect(page.getByTestId("assistant-conversation")).toHaveCount(2);
    const overflow = await page.evaluate(() => {
      const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
