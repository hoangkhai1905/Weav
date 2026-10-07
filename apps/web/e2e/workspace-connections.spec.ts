import { expect, test, type Page, type Route } from "@playwright/test";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const WORKSPACE_B_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_GMAIL_ID = "20000000-0000-4000-8000-000000000001";
const CONNECTION_SHEETS_ID = "20000000-0000-4000-8000-000000000002";
const CONNECTION_TELEGRAM_ID = "20000000-0000-4000-8000-000000000003";
const CONNECTION_HTTP_ID = "20000000-0000-4000-8000-000000000004";
const CONNECTION_DRIVE_ID = "20000000-0000-4000-8000-000000000005";
const CONNECTION_DRIVE_DISABLED_ID = "20000000-0000-4000-8000-000000000006";
const CONNECTION_DRIVE_LOCKED_ID = "20000000-0000-4000-8000-000000000007";
const CONNECTION_CALENDAR_ID = "20000000-0000-4000-8000-000000000008";
const ACCESS_TOKEN = "connection-adapter-token";
const PENDING_OAUTH_CONTEXT_KEY = "weav.workspaceConnectionOAuth.pending";

type BrowserNavigationContext = {
  history: { pushState: (...args: unknown[]) => void };
  dispatchEvent: (event: unknown) => boolean;
  PopStateEvent: new (type: string) => unknown;
  location: { pathname: string; search: string };
};

type OAuthContextCapture = {
  __captureOAuthPendingContext?: (storedValue: string) => void;
};

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

const pageResult = <T>(items: T[]) => ({
  items,
  page: 0,
  size: 20,
  totalElements: items.length,
  totalPages: items.length ? 1 : 0,
});

/** Row actions other than the primary one live in the "..." menu. */
async function openRowMenu(page: Page, id: string) {
  await page.getByTestId(`connection-row-${id}`).getByTestId("connection-row-menu").click();
}

function connection(
  id: string,
  provider:
    | "TELEGRAM"
    | "HTTP"
    | "GMAIL"
    | "GOOGLE_SHEETS"
    | "GOOGLE_CALENDAR"
    | "GOOGLE_DRIVE",
  workspaceId = WORKSPACE_ID,
  status: "DISABLED" | "ACTIVE" | "INVALID" = "DISABLED",
  canManage = true,
) {
  return {
    id,
    workspaceId,
    createdBy: USER_ID,
    name:
      provider === "GMAIL"
        ? "Work Gmail"
        : provider === "GOOGLE_SHEETS"
          ? "Project Sheets"
          : provider === "GOOGLE_DRIVE"
            ? "Team Drive"
            : provider === "GOOGLE_CALENDAR"
              ? "Team Calendar"
              : `${provider} integration`,
    provider,
    authType: "OAUTH2",
    status,
    config: null,
    hasCredential: false,
    credentialExpiresAt: null,
    lastVerifiedAt: null,
    canManage,
    canAttach: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installAuthFixture(page: Page, workspaces = [workspace]) {
  await page.addInitScript(() => {
    localStorage.setItem("weav_token", "connection-adapter-token");
    localStorage.setItem("weav_lang_v1", "EN");
  });

  await page.route("**/api/auth/me", (route) => fulfillJson(route, user));
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/v2/notifications/unread-count", (route) =>
    fulfillJson(route, { count: 0 }),
  );
  await page.route("**/api/v1/workspaces**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/v1/workspaces" &&
      route.request().method() === "GET"
    ) {
      return fulfillJson(route, pageResult(workspaces));
    }
    for (const item of workspaces) {
      if (url.pathname === `/api/v1/workspaces/${item.id}`) {
        return fulfillJson(route, item);
      }
      if (url.pathname === `/api/v1/workspaces/${item.id}/members`) {
        return fulfillJson(route, pageResult([]));
      }
    }
    return fulfillJson(
      route,
      { error: { code: "NOT_FOUND", message: "Not found" } },
      404,
    );
  });
}

async function gotoAuthenticatedWorkspace(page: Page) {
  await gotoAuthenticatedPath(page, "/workspace");
}

async function gotoAuthenticatedPath(page: Page, path: string) {
  const profileResponse = page.waitForResponse((response) =>
    response.url().includes("/api/auth/me"),
  );
  await page.goto(path);
  await profileResponse;
  if (new URL(page.url()).pathname === "/login") await page.goto(path);
}

async function gotoAuthenticatedConnections(page: Page) {
  await gotoAuthenticatedPath(page, "/connections");
}

function pendingOAuthContext(
  workspaceId = WORKSPACE_ID,
  connectionId = CONNECTION_GMAIL_ID,
  userId = USER_ID,
) {
  return { userId, workspaceId, connectionId, createdAt: Date.now() };
}

async function setPendingOAuthContext(
  page: Page,
  context = pendingOAuthContext(),
) {
  await page.evaluate(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: PENDING_OAUTH_CONTEXT_KEY, value: context },
  );
}

async function pushSpaPath(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    const browser = globalThis as unknown as BrowserNavigationContext;
    browser.history.pushState({}, "", nextPath);
    browser.dispatchEvent(new browser.PopStateEvent("popstate"));
  }, path);
}

test.describe("workspace connection API adapter", () => {
  test("adapter: list uses selected workspace", async ({ page }) => {
    await installAuthFixture(page);
    let receivedUrl = "";
    let receivedAuthorization = "";

    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      receivedUrl = new URL(route.request().url()).pathname;
      receivedAuthorization = route.request().headers().authorization ?? "";
      await fulfillJson(route, [
        connection(CONNECTION_GMAIL_ID, "GMAIL"),
        connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS"),
      ]);
    });

    await gotoAuthenticatedWorkspace(page);
    const result = await page.evaluate(async (workspaceId) => {
      const modulePath = "/src/api/connection.api.ts";
      const { connectionApi } = await import(/* @vite-ignore */ modulePath);
      return connectionApi.list(workspaceId);
    }, WORKSPACE_ID);

    expect(receivedUrl).toBe(`/api/v1/workspaces/${WORKSPACE_ID}/connections`);
    expect(receivedAuthorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(result).toEqual([
      expect.objectContaining({
        id: CONNECTION_GMAIL_ID,
        workspaceId: WORKSPACE_ID,
        createdBy: USER_ID,
        provider: "GMAIL",
        status: "DISABLED",
        config: null,
      }),
      expect.objectContaining({
        id: CONNECTION_SHEETS_ID,
        workspaceId: WORKSPACE_ID,
        createdBy: USER_ID,
        provider: "GOOGLE_SHEETS",
        status: "DISABLED",
        config: null,
      }),
    ]);
  });

  test("adapter: create sends only the normalized Google OAuth contract", async ({
    page,
  }) => {
    await installAuthFixture(page);
    let receivedMethod = "";
    let receivedBody: unknown;
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      receivedMethod = route.request().method();
      receivedBody = route.request().postDataJSON();
      await fulfillJson(route, connection(CONNECTION_GMAIL_ID, "GMAIL"), 201);
    });

    await gotoAuthenticatedWorkspace(page);
    await page.evaluate(async (workspaceId) => {
      const modulePath = "/src/api/connection.api.ts";
      const { connectionApi } = await import(/* @vite-ignore */ modulePath);
      await connectionApi.create(workspaceId, {
        name: "  Work Gmail  ",
        provider: "GMAIL",
        authType: "OAUTH2",
        credential: "must-not-be-sent",
      } as never);
    }, WORKSPACE_ID);

    expect(receivedMethod).toBe("POST");
    expect(receivedBody).toEqual({
      name: "Work Gmail",
      provider: "GMAIL",
      authType: "OAUTH2",
    });
  });

  test("adapter: 403 rejects", async ({ page }) => {
    await installAuthFixture(page);
    let receivedAuthorization = "";

    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      receivedAuthorization = route.request().headers().authorization ?? "";
      await fulfillJson(
        route,
        {
          error: { code: "FORBIDDEN", message: "Workspace access denied." },
          requestId: "connection-request-403",
        },
        403,
      );
    });

    await gotoAuthenticatedWorkspace(page);
    const result = await page.evaluate(async (workspaceId) => {
      const modulePath = "/src/api/connection.api.ts";
      const { connectionApi } = await import(/* @vite-ignore */ modulePath);
      try {
        await connectionApi.list(workspaceId);
        return { rejected: false };
      } catch (error) {
        const apiError = error as {
          status?: number;
          code?: string;
          requestId?: string;
        };
        return {
          rejected: true,
          status: apiError.status,
          code: apiError.code,
          requestId: apiError.requestId,
        };
      }
    }, WORKSPACE_ID);

    expect(receivedAuthorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(result).toEqual({
      rejected: true,
      status: 403,
      code: "FORBIDDEN",
      requestId: "connection-request-403",
    });
  });

  test("adapter accepts Workspace top-level error envelopes", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      await fulfillJson(
        route,
        {
          code: "WORKSPACE_UNAVAILABLE",
          message: "Workspace service is temporarily unavailable.",
          requestId: "workspace-request-503",
        },
        503,
      );
    });

    await gotoAuthenticatedWorkspace(page);
    const result = await page.evaluate(async (workspaceId) => {
      const modulePath = "/src/api/connection.api.ts";
      const { connectionApi } = await import(/* @vite-ignore */ modulePath);
      try {
        await connectionApi.list(workspaceId);
        return { rejected: false };
      } catch (error) {
        const apiError = error as {
          status?: number;
          code?: string;
          requestId?: string;
        };
        return {
          rejected: true,
          status: apiError.status,
          code: apiError.code,
          requestId: apiError.requestId,
        };
      }
    }, WORKSPACE_ID);

    expect(result).toEqual({
      rejected: true,
      status: 503,
      code: "WORKSPACE_UNAVAILABLE",
      requestId: "workspace-request-503",
    });
  });

  test("workspace selector shares the active workspace with the Workspace page", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await gotoAuthenticatedWorkspace(page);

    const topbarSelector = page.getByTestId("topbar-workspace-selector");
    await expect(topbarSelector).toHaveValue(WORKSPACE_ID);
    await topbarSelector.selectOption(WORKSPACE_B_ID);

    await expect(topbarSelector).toHaveValue(WORKSPACE_B_ID);
    await expect(page.getByTestId("workspace-selector")).toHaveValue(
      WORKSPACE_B_ID,
    );
    await expect(page.getByTestId("workspace-selected-heading")).toHaveText(
      "Beta workspace",
    );
    await expect(
      page.getByTestId("workspace-connections-link"),
    ).toHaveAttribute("href", "/workspace/connections");
  });

  test("topbar links to workspace management when no workspace is accessible", async ({
    page,
  }) => {
    await installAuthFixture(page, []);
    await gotoAuthenticatedWorkspace(page);

    await expect(page.getByTestId("topbar-no-workspace")).toBeVisible();
    await expect(page.getByTestId("topbar-no-workspace")).toHaveAttribute(
      "href",
      "/workspace",
    );
  });

  test("connections shows the selected workspace name and a truthful empty state", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await gotoAuthenticatedConnections(page);

    await expect(page.getByTestId("connections-workspace-name")).toHaveText(
      "Alpha workspace",
    );
    await expect(page.getByText("Connection created.", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("connections-empty-state")).toBeVisible();
    await expect(page.getByTestId("connection-row")).toHaveCount(0);
    await expect(page.getByText("PostgreSQL", { exact: true })).toHaveCount(0);
  });

  test("connections exposes a loading state while the selected workspace request is pending", async ({
    page,
  }) => {
    await installAuthFixture(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseResponse!: () => void;
    const waitingRoute = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      releaseResponse();
      await pending;
      await fulfillJson(route, []);
    });

    await gotoAuthenticatedConnections(page);
    await waitingRoute;
    await expect(page.getByTestId("connections-loading")).toBeVisible();
    release();
    await expect(page.getByTestId("connections-empty-state")).toBeVisible();
  });

  for (const [status, code, expectedMessage] of [
    [401, "UNAUTHORIZED", "Your session expired. Please sign in again."],
    [403, "FORBIDDEN", "You do not have access to this connection."],
    [
      404,
      "NOT_FOUND",
      "This connection was not found in the selected workspace.",
    ],
    [
      503,
      "DEPENDENCY_UNAVAILABLE",
      "The connection service is temporarily unavailable. Please try again.",
    ],
  ] as const) {
    test(`connections displays the ${status} API failure instead of an empty success`, async ({
      page,
    }) => {
      await installAuthFixture(page);
      await page.route("**/api/v1/workspaces/*/connections", (route) =>
        fulfillJson(
          route,
          {
            error: {
              code,
              message: `Connection request failed with ${status}.`,
            },
            requestId: `connections-request-${status}`,
          },
          status,
        ),
      );
      await gotoAuthenticatedConnections(page);

      await expect(page.getByTestId("connections-error")).toHaveText(
        expectedMessage,
      );
      await expect(page.getByTestId("connections-empty-state")).toHaveCount(0);
    });
  }

  test("connections isolates workspace lists and displays server-owned provider metadata", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await page.route("**/api/v1/workspaces/*/connections", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(WORKSPACE_ID + "/connections")) {
        return fulfillJson(route, [
          connection(CONNECTION_TELEGRAM_ID, "TELEGRAM"),
          connection(CONNECTION_HTTP_ID, "HTTP", WORKSPACE_ID, "ACTIVE"),
        ]);
      }
      return fulfillJson(route, []);
    });
    await gotoAuthenticatedConnections(page);

    await expect(
      page.getByTestId(`connection-row-${CONNECTION_TELEGRAM_ID}`),
    ).toContainText("TELEGRAM");
    await expect(
      page.getByTestId(`connection-row-${CONNECTION_HTTP_ID}`),
    ).toContainText("HTTP");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_HTTP_ID}`),
    ).toHaveAttribute("data-status", "ACTIVE");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_HTTP_ID}`),
    ).toHaveText("Active");
    await page
      .getByTestId("topbar-workspace-selector")
      .selectOption(WORKSPACE_B_ID);

    await expect(page.getByTestId("connections-workspace-name")).toHaveText(
      "Beta workspace",
    );
    await expect(page.getByTestId("connection-row")).toHaveCount(0);
    await expect(page.getByTestId("connections-empty-state")).toBeVisible();
  });

  test("create persists and renders the server's DISABLED Google connection", async ({
    page,
  }) => {
    await installAuthFixture(page);
    let connections: ReturnType<typeof connection>[] = [];
    let createBody: unknown;
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      const method = route.request().method();
      if (method === "GET") return fulfillJson(route, connections);
      if (method === "POST") {
        createBody = route.request().postDataJSON();
        const created = connection(CONNECTION_GMAIL_ID, "GMAIL");
        connections = [created];
        return fulfillJson(route, created, 201);
      }
      return fulfillJson(
        route,
        { error: { code: "NOT_FOUND", message: "Not found" } },
        404,
      );
    });
    await gotoAuthenticatedConnections(page);
    await page.getByTestId("connections-create-open").click();
    await page.getByTestId("connection-create-name").fill("  Work Gmail  ");
    await page.getByTestId("connection-create-provider").selectOption("GMAIL");
    await page.getByTestId("connection-create-submit").click();

    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "DISABLED");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveText("Disabled");
    expect(createBody).toEqual({
      name: "Work Gmail",
      provider: "GMAIL",
      authType: "OAUTH2",
    });
    await expect(page.getByTestId("connections-workspace-name")).toHaveText(
      "Alpha workspace",
    );
  });

  test("create stores a Telegram bot token through the credential endpoint, verifies it and shows a Test action", async ({
    page,
  }) => {
    await installAuthFixture(page);
    const TOKEN = "123456:TEST-token";
    const telegram = (status: "DISABLED" | "ACTIVE", hasCredential: boolean) => ({
      ...connection(CONNECTION_TELEGRAM_ID, "TELEGRAM", WORKSPACE_ID, status),
      name: "Support bot",
      authType: "TOKEN",
      hasCredential,
    });
    let connections: unknown[] = [];
    const calls: string[] = [];
    let createBody: unknown;
    let credentialBody: unknown;
    let testCalls = 0;
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      if (route.request().method() === "GET") return fulfillJson(route, connections);
      calls.push("create");
      createBody = route.request().postDataJSON();
      connections = [telegram("DISABLED", false)];
      return fulfillJson(route, connections[0], 201);
    });
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_TELEGRAM_ID}/credential`,
      (route) => {
        calls.push("credential");
        credentialBody = route.request().postDataJSON();
        connections = [telegram("DISABLED", true)];
        return fulfillJson(route, connections[0]);
      },
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_TELEGRAM_ID}/test`,
      (route) => {
        calls.push("test");
        testCalls += 1;
        connections = [telegram("ACTIVE", true)];
        return fulfillJson(route, { outcome: "VERIFIED" });
      },
    );
    await gotoAuthenticatedConnections(page);
    await page.getByTestId("connections-create-open").click();
    await page.getByTestId("connection-create-name").fill("Support bot");
    await expect(page.getByTestId("connection-create-token")).toHaveCount(0);
    await page.getByTestId("connection-create-provider").selectOption("TELEGRAM");
    const tokenInput = page.getByTestId("connection-create-token");
    await expect(tokenInput).toHaveAttribute("type", "password");
    await expect(tokenInput).toHaveAttribute("autocomplete", "off");
    await tokenInput.fill(TOKEN);
    await page.getByTestId("connection-create-submit").click();

    const row = page.getByTestId(`connection-row-${CONNECTION_TELEGRAM_ID}`);
    await expect(row).toContainText("TELEGRAM");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_TELEGRAM_ID}`),
    ).toHaveAttribute("data-status", "ACTIVE");
    expect(createBody).toEqual({ name: "Support bot", provider: "TELEGRAM", authType: "TOKEN" });
    expect(credentialBody).toEqual({ payload: { token: TOKEN } });
    expect(calls).toEqual(["create", "credential", "test"]);
    await expect(page.getByTestId(`connection-oauth-${CONNECTION_TELEGRAM_ID}`)).toHaveCount(0);
    await expect(page.getByText(TOKEN)).toHaveCount(0);

    // The row's Test action verifies the stored token again.
    await row.getByTestId(`connection-test-${CONNECTION_TELEGRAM_ID}`).click();
    await expect.poll(() => testCalls).toBe(2);
  });

  test("Telegram create without a token is blocked and a failed token save removes the empty connection", async ({
    page,
  }) => {
    await installAuthFixture(page);
    const removed: string[] = [];
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      route.request().method() === "GET"
        ? fulfillJson(route, [])
        : fulfillJson(route, { ...connection(CONNECTION_TELEGRAM_ID, "TELEGRAM"), authType: "TOKEN" }, 201),
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_TELEGRAM_ID}**`,
      (route) => {
        if (route.request().method() === "DELETE") {
          removed.push(CONNECTION_TELEGRAM_ID);
          return route.fulfill({ status: 204, body: "" });
        }
        return fulfillJson(route, { error: { code: "BAD_REQUEST", message: "bad" } }, 400);
      },
    );
    await gotoAuthenticatedConnections(page);
    await page.getByTestId("connections-create-open").click();
    await page.getByTestId("connection-create-name").fill("Support bot");
    await page.getByTestId("connection-create-provider").selectOption("TELEGRAM");
    await page.getByTestId("connection-create-token").fill("   ");
    await page.getByTestId("connection-create-submit").click();
    await expect(page.getByTestId("connection-create-error")).toHaveText("Enter the Telegram bot token.");
    expect(removed).toEqual([]);

    await page.getByTestId("connection-create-token").fill("123456:TEST-token");
    await page.getByTestId("connection-create-submit").click();
    await expect(page.getByTestId("connection-create-error")).toBeVisible();
    expect(removed).toEqual([CONNECTION_TELEGRAM_ID]);
    // The token is cleared after a submit attempt.
    await expect(page.getByTestId("connection-create-token")).toHaveValue("");
  });

  test("Connect Google starts Workspace OAuth and stores only safe pending context", async ({
    page,
  }) => {
    await installAuthFixture(page);
    let capturedContext: string | null = null;
    let oauthAuthorizationHeader = "";
    await page.exposeBinding(
      "__captureOAuthPendingContext",
      (_source, value) => {
        capturedContext = String(value);
      },
    );
    await page.addInitScript((key) => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (storageKey, value) {
        if (storageKey === key) {
          const captureGlobal = globalThis as unknown as OAuthContextCapture;
          captureGlobal.__captureOAuthPendingContext?.(value);
        }
        return originalSetItem.call(this, storageKey, value);
      };
    }, PENDING_OAUTH_CONTEXT_KEY);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [connection(CONNECTION_GMAIL_ID, "GMAIL")]),
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/oauth/authorize`,
      async (route) => {
        oauthAuthorizationHeader =
          route.request().headers().authorization ?? "";
        await fulfillJson(route, {
          authorizationUrl:
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=one-time-state",
        });
      },
    );
    await page.route("https://accounts.google.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "Google consent fixture",
      });
    });
    await gotoAuthenticatedConnections(page);
    await page.getByTestId(`connection-oauth-${CONNECTION_GMAIL_ID}`).click();
    await expect(page).toHaveURL(/https:\/\/accounts\.google\.com\//);
    await expect.poll(() => capturedContext).not.toBeNull();

    expect(oauthAuthorizationHeader).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(capturedContext).not.toBeNull();
    const stored = JSON.parse(capturedContext!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      "connectionId",
      "createdAt",
      "userId",
      "workspaceId",
    ]);
    expect(stored).toMatchObject({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      connectionId: CONNECTION_GMAIL_ID,
    });
    expect(typeof stored.createdAt).toBe("number");
    expect(capturedContext).not.toMatch(
      /authorizationUrl|state|accessToken|refreshToken|https?:/i,
    );
  });

  test("OAuth success restores only the accessible pending workspace and refreshes server status", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    let alphaListCalls = 0;
    const gmail = connection(CONNECTION_GMAIL_ID, "GMAIL");
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await page.route("**/api/v1/workspaces/*/connections", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`${WORKSPACE_ID}/connections`)) {
        alphaListCalls += 1;
        return fulfillJson(route, [gmail]);
      }
      return fulfillJson(route, []);
    });
    await gotoAuthenticatedConnections(page);
    await page
      .getByTestId("topbar-workspace-selector")
      .selectOption(WORKSPACE_B_ID);
    await expect(page.getByTestId("connections-workspace-name")).toHaveText(
      "Beta workspace",
    );
    await setPendingOAuthContext(page);
    await pushSpaPath(
      page,
      `/connections?oauth=success&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "Authorization returned",
    );
    await expect(page.getByTestId("topbar-workspace-selector")).toHaveValue(
      WORKSPACE_ID,
    );
    await expect(page.getByTestId("connections-workspace-name")).toHaveText(
      "Alpha workspace",
    );
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "DISABLED");
    await expect.poll(() => alphaListCalls).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => sessionStorage.getItem(key),
          PENDING_OAUTH_CONTEXT_KEY,
        ),
      )
      .toBeNull();
    expect(
      await page.evaluate(() => {
        const browser = globalThis as unknown as BrowserNavigationContext;
        return `${browser.location.pathname}${browser.location.search}`;
      }),
    ).toBe("/workspace/connections");
  });

  test("OAuth denial shows safe guidance and never trusts an uncorrelated callback ID", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await gotoAuthenticatedConnections(page);
    await page
      .getByTestId("topbar-workspace-selector")
      .selectOption(WORKSPACE_B_ID);
    await setPendingOAuthContext(page, pendingOAuthContext(WORKSPACE_ID));
    await pushSpaPath(
      page,
      `/connections?oauth=failed&reason=authorization_denied&connectionId=${CONNECTION_SHEETS_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "Google access was not granted",
    );
    await expect(page.getByTestId("topbar-workspace-selector")).toHaveValue(
      WORKSPACE_B_ID,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (key) => sessionStorage.getItem(key),
          PENDING_OAUTH_CONTEXT_KEY,
        ),
      )
      .toBeNull();
  });

  test("OAuth invalid state does not restore workspace from an untrusted connection query", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await gotoAuthenticatedConnections(page);
    await page
      .getByTestId("topbar-workspace-selector")
      .selectOption(WORKSPACE_B_ID);
    await setPendingOAuthContext(page, pendingOAuthContext(WORKSPACE_ID));
    await pushSpaPath(
      page,
      `/connections?oauth=failed&reason=state_invalid&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "could not be verified. Start again",
    );
    await expect(page.getByTestId("topbar-workspace-selector")).toHaveValue(
      WORKSPACE_B_ID,
    );
  });

  test("OAuth changed-authorization callback restores its matching accessible workspace", async ({
    page,
  }) => {
    const secondWorkspace = {
      ...workspace,
      id: WORKSPACE_B_ID,
      name: "Beta workspace",
    };
    await installAuthFixture(page, [workspace, secondWorkspace]);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await gotoAuthenticatedConnections(page);
    await page
      .getByTestId("topbar-workspace-selector")
      .selectOption(WORKSPACE_B_ID);
    await setPendingOAuthContext(page, pendingOAuthContext(WORKSPACE_ID));
    await pushSpaPath(
      page,
      `/connections?oauth=failed&reason=authorization_changed&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "Workspace access changed",
    );
    await expect(page.getByTestId("topbar-workspace-selector")).toHaveValue(
      WORKSPACE_ID,
    );
  });

  test("OAuth pending return completes with the signed-in bearer token and clears the one-time id", async ({
    page,
  }) => {
    const completion = "c".repeat(43);
    let active = false;
    let completeBody = "";
    let completeAuthorization = "";
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        { ...connection(CONNECTION_GMAIL_ID, "GMAIL"), status: active ? "ACTIVE" : "DISABLED" },
      ]),
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/oauth/complete`,
      async (route) => {
        completeBody = route.request().postData() ?? "";
        completeAuthorization = route.request().headers().authorization ?? "";
        active = true;
        await fulfillJson(route, { outcome: "VERIFIED" });
      },
    );
    await gotoAuthenticatedConnections(page);
    await setPendingOAuthContext(page);
    await pushSpaPath(
      page,
      `/connections?oauth=pending&completion=${completion}&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "Authorization returned",
    );
    expect(JSON.parse(completeBody)).toEqual({ completion });
    expect(completeAuthorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "ACTIVE");
    expect(
      await page.evaluate(() => {
        const browser = globalThis as unknown as BrowserNavigationContext;
        return `${browser.location.pathname}${browser.location.search}`;
      }),
    ).toBe("/workspace/connections");
  });

  test("OAuth pending return with a consumed completion shows safe guidance", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [connection(CONNECTION_GMAIL_ID, "GMAIL")]),
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/oauth/complete`,
      (route) =>
        fulfillJson(
          route,
          { code: "CONFLICT", message: "private upstream detail", requestId: "r1" },
          409,
        ),
    );
    await gotoAuthenticatedConnections(page);
    await setPendingOAuthContext(page);
    await pushSpaPath(
      page,
      `/connections?oauth=pending&completion=${"d".repeat(43)}&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "could not be verified. Start again",
    );
    await expect(page.getByTestId("connections-oauth-notice")).not.toContainText(
      "private upstream detail",
    );
  });

  test("OAuth pending return without a matching local context never calls complete", async ({
    page,
  }) => {
    let completeCalls = 0;
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await page.route("**/oauth/complete", (route) => {
      completeCalls += 1;
      return fulfillJson(route, { outcome: "VERIFIED" });
    });
    await gotoAuthenticatedConnections(page);
    await pushSpaPath(
      page,
      `/connections?oauth=pending&completion=${"e".repeat(43)}&connectionId=${CONNECTION_GMAIL_ID}`,
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "request context could not be verified",
    );
    expect(completeCalls).toBe(0);
  });

  test("unknown OAuth failure reasons use generic guidance", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, []),
    );
    await gotoAuthenticatedConnections(page);
    await pushSpaPath(
      page,
      "/connections?oauth=failed&reason=provider-private-error&connectionId=attacker-id",
    );

    await expect(page.getByTestId("connections-oauth-notice")).toContainText(
      "could not be completed",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const browser = globalThis as unknown as BrowserNavigationContext;
          return `${browser.location.pathname}${browser.location.search}`;
        }),
      )
      .toBe("/workspace/connections");
  });

  test("Identity Google login callback route remains independent", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.goto("/auth/callback?oauth_error=access_denied");

    await expect(
      page.getByRole("heading", {
        name: "Google sign-in could not be completed.",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("connections-oauth-notice")).toHaveCount(0);
  });

  test("connection lifecycle uses Workspace calls and renders actual test outcome", async ({
    page,
  }) => {
    await installAuthFixture(page);
    let serverConnection: ReturnType<typeof connection> | null = connection(
      CONNECTION_GMAIL_ID,
      "GMAIL",
    );
    let deleteCalls = 0;
    let renameBody: unknown;
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      if (route.request().method() === "GET") {
        return fulfillJson(route, serverConnection ? [serverConnection] : []);
      }
      return fulfillJson(
        route,
        { error: { code: "NOT_FOUND", message: "Not found" } },
        404,
      );
    });
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/test`,
      async (route) => {
        if (!serverConnection) {
          return fulfillJson(route, { error: { code: "NOT_FOUND" } }, 404);
        }
        serverConnection = { ...serverConnection, status: "INVALID" };
        await fulfillJson(route, { outcome: "AUTH_INVALID" });
      },
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/disable`,
      async (route) => {
        if (!serverConnection) {
          return fulfillJson(route, { error: { code: "NOT_FOUND" } }, 404);
        }
        serverConnection = { ...serverConnection, status: "DISABLED" };
        await fulfillJson(route, serverConnection);
      },
    );
    await page.route(
      `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}`,
      async (route) => {
        const method = route.request().method();
        if (method === "PATCH") {
          if (!serverConnection) {
            return fulfillJson(route, { error: { code: "NOT_FOUND" } }, 404);
          }
          renameBody = route.request().postDataJSON();
          serverConnection = {
            ...serverConnection,
            name: (renameBody as { name: string }).name,
          };
          return fulfillJson(route, serverConnection);
        }
        if (method === "DELETE") {
          deleteCalls += 1;
          serverConnection = null;
          return route.fulfill({ status: 204, body: "" });
        }
        return fulfillJson(
          route,
          { error: { code: "NOT_FOUND", message: "Not found" } },
          404,
        );
      },
    );
    await gotoAuthenticatedConnections(page);
    await openRowMenu(page, CONNECTION_GMAIL_ID);
    await page.getByTestId(`connection-rename-${CONNECTION_GMAIL_ID}`).click();
    await page
      .getByTestId(`connection-rename-input-${CONNECTION_GMAIL_ID}`)
      .fill("Renamed Gmail");
    await page
      .getByTestId(`connection-rename-submit-${CONNECTION_GMAIL_ID}`)
      .click();
    await expect(
      page.getByTestId(`connection-row-${CONNECTION_GMAIL_ID}`),
    ).toContainText("Renamed Gmail");
    await expect(page.getByText("Connection updated.", { exact: true })).toHaveCount(1);
    expect(renameBody).toEqual({ name: "Renamed Gmail" });

    await openRowMenu(page, CONNECTION_GMAIL_ID);
    await page.getByTestId(`connection-test-${CONNECTION_GMAIL_ID}`).click();
    await expect(
      page.getByTestId(`connection-action-message-${CONNECTION_GMAIL_ID}`),
    ).toContainText("Google access needs to be renewed");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "INVALID");

    await openRowMenu(page, CONNECTION_GMAIL_ID);
    await page.getByTestId(`connection-disable-${CONNECTION_GMAIL_ID}`).click();
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "DISABLED");
    await expect(page.getByText("Connection disabled.", { exact: true })).toHaveCount(1);

    page.on("dialog", (dialog) => dialog.accept());
    await openRowMenu(page, CONNECTION_GMAIL_ID);
    await page.getByTestId(`connection-delete-${CONNECTION_GMAIL_ID}`).click();
    await expect(page.getByTestId("connections-empty-state")).toBeVisible();
    expect(deleteCalls).toBe(1);
  });

  for (const status of [409, 503] as const) {
    test(`failed ${status} delete preserves the connection row`, async ({
      page,
    }) => {
      await installAuthFixture(page);
      await page.route("**/api/v1/workspaces/*/connections", (route) =>
        fulfillJson(route, [connection(CONNECTION_GMAIL_ID, "GMAIL")]),
      );
      await page.route(
        `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}`,
        (route) =>
          fulfillJson(
            route,
            {
              error: {
                code: status === 409 ? "CONFLICT" : "DEPENDENCY_UNAVAILABLE",
                message: `Delete failed with ${status}.`,
              },
              requestId: `delete-request-${status}`,
            },
            status,
          ),
      );
      await gotoAuthenticatedConnections(page);
      page.on("dialog", (dialog) => dialog.accept());
      await openRowMenu(page, CONNECTION_GMAIL_ID);
      await page
        .getByTestId(`connection-delete-${CONNECTION_GMAIL_ID}`)
        .click();

      await expect(
        page.getByTestId(`connection-row-${CONNECTION_GMAIL_ID}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`connection-action-message-${CONNECTION_GMAIL_ID}`),
      ).toContainText(
        status === 409
          ? "cannot be changed while it is in use"
          : "temporarily unavailable. Please try again",
      );
    });
  }

  for (const [status, code, expectedMessage] of [
    [400, "BAD_REQUEST", "Check the connection details and try again."],
    [401, "UNAUTHORIZED", "Your session expired. Please sign in again."],
  ] as const) {
    test(`connection test maps Gateway ${code} (${status}) errors`, async ({
      page,
    }) => {
      await installAuthFixture(page);
      await page.route("**/api/v1/workspaces/*/connections", (route) =>
        fulfillJson(route, [connection(CONNECTION_GMAIL_ID, "GMAIL")]),
      );
      await page.route(
        `**/api/v1/workspaces/*/connections/${CONNECTION_GMAIL_ID}/test`,
        (route) =>
          fulfillJson(
            route,
            {
              error: {
                code,
                message: `Backend ${code} message must not be shown.`,
              },
              requestId: `connection-test-request-${status}`,
            },
            status,
          ),
      );
      await gotoAuthenticatedConnections(page);
      await openRowMenu(page, CONNECTION_GMAIL_ID);
    await page.getByTestId(`connection-test-${CONNECTION_GMAIL_ID}`).click();

      const actionMessage = page.getByTestId(
        `connection-action-message-${CONNECTION_GMAIL_ID}`,
      );
      await expect(actionMessage).toHaveText(expectedMessage);
      await expect(actionMessage).not.toContainText(`Backend ${code} message`);
    });
  }

  test("Google OAuth action is hidden for legacy and non-OAuth connections", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(CONNECTION_TELEGRAM_ID, "TELEGRAM"),
        connection(CONNECTION_HTTP_ID, "HTTP"),
        {
          ...connection(CONNECTION_GMAIL_ID, "GMAIL"),
          authType: "API_KEY",
        },
      ]),
    );
    await gotoAuthenticatedConnections(page);

    for (const id of [
      CONNECTION_TELEGRAM_ID,
      CONNECTION_HTTP_ID,
      CONNECTION_GMAIL_ID,
    ]) {
      await expect(page.getByTestId(`connection-oauth-${id}`)).toHaveCount(0);
    }
  });

  test("member sees safe metadata but no management actions", async ({
    page,
  }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(
          CONNECTION_GMAIL_ID,
          "GMAIL",
          WORKSPACE_ID,
          "DISABLED",
          false,
        ),
      ]),
    );
    await gotoAuthenticatedConnections(page);

    await expect(
      page.getByTestId(`connection-row-${CONNECTION_GMAIL_ID}`),
    ).toContainText("Safe metadata only");
    await expect(
      page.getByTestId(`connection-test-${CONNECTION_GMAIL_ID}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`connection-delete-${CONNECTION_GMAIL_ID}`),
    ).toHaveCount(0);
  });
});

test.describe("workflow builder Gmail connection picker", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000001";
  const INVALID_GMAIL_ID = "20000000-0000-4000-8000-000000000009";

  const workflowDetail = (emailConfig: Record<string, unknown>) => ({
    workflowId: WORKFLOW_ID,
    name: "Mail report",
    status: "DRAFT",
    schemaVersion: "1.0",
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    definition: {
      schemaVersion: "1.0",
      nodes: [
        { id: "manual", type: "trigger.manual", config: {} },
        { id: "email", type: "email.send", config: emailConfig },
      ],
      edges: [{ id: "manual-email", source: "manual", target: "email" }],
      variables: {},
    },
    editorState: {
      nodes: {
        manual: { name: "Start", position: { x: 0, y: 0 } },
        email: { name: "Send report", position: { x: 320, y: 0 } },
      },
    },
  });

  test("lists only active attachable Gmail connections and saves the selected connectionId", async ({ page }) => {
    await installAuthFixture(page);
    const savedDrafts: Array<Record<string, unknown>> = [];
    let emailConfig: Record<string, unknown> = { to: "team@example.test", subject: "Weekly", body: "Hi" };
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
        connection(INVALID_GMAIL_ID, "GMAIL", WORKSPACE_ID, "INVALID"),
        connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE"),
      ]),
    );
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        savedDrafts.push(body);
        const nodes = (body.definition as { nodes: Array<{ id: string; config: Record<string, unknown> }> }).nodes;
        emailConfig = nodes.find((node) => node.id === "email")?.config ?? {};
        return fulfillJson(route, workflowDetail(emailConfig));
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) {
        return fulfillJson(route, workflowDetail(emailConfig));
      }
      return fulfillJson(route, pageResult([]));
    });

    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    await page.locator('[data-testid="workflow-node"][data-node-type="email.send"]').click();

    const picker = page.getByTestId("email-connection");
    await expect(picker.locator("option")).toHaveText(["Select a Gmail connection", "Work Gmail"]);
    await expect(page.getByTestId("integration-readiness")).toContainText("select an authorized Gmail connection");
    await expect(page.getByTestId("workflow-publish")).toBeDisabled();

    await picker.selectOption(CONNECTION_GMAIL_ID);
    await expect(page.getByTestId("integration-readiness")).toHaveCount(0);
    await page.getByTestId("workflow-save-inspector").click();
    await expect.poll(() => savedDrafts.length).toBe(1);
    expect(emailConfig).toMatchObject({ connectionId: CONNECTION_GMAIL_ID, to: "team@example.test" });

    await picker.selectOption("");
    await page.getByTestId("workflow-save-inspector").click();
    await expect.poll(() => savedDrafts.length).toBe(2);
    expect(emailConfig).not.toHaveProperty("connectionId");
  });

  test("lists only active attachable Google Sheets connections and saves the selected connectionId", async ({ page }) => {
    await installAuthFixture(page);
    const savedDrafts: Array<Record<string, unknown>> = [];
    let sheetsConfig: Record<string, unknown> = { operation: "read" };
    const connections: unknown[] = [
      connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE"),
      connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
      connection("00000000-0000-4000-8000-0000000000e9", "GOOGLE_SHEETS", WORKSPACE_ID, "INVALID"),
    ];
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, connections));
    const detail = () => ({
      workflowId: WORKFLOW_ID,
      name: "Sheet report",
      status: "DRAFT",
      schemaVersion: "1.0",
      currentVersionId: null,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      definition: {
        schemaVersion: "1.0",
        nodes: [
          { id: "manual", type: "trigger.manual", config: {} },
          { id: "sheets", type: "google.sheets", config: sheetsConfig },
        ],
        edges: [{ id: "manual-sheets", source: "manual", target: "sheets" }],
        variables: {},
      },
      editorState: { nodes: { manual: { name: "Start", position: { x: 0, y: 0 } }, sheets: { name: "Read sheet", position: { x: 320, y: 0 } } } },
    });
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        savedDrafts.push(body);
        const nodes = (body.definition as { nodes: Array<{ id: string; config: Record<string, unknown> }> }).nodes;
        sheetsConfig = nodes.find((node) => node.id === "sheets")?.config ?? {};
        return fulfillJson(route, detail());
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail());
      return fulfillJson(route, pageResult([]));
    });

    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    await page.locator('[data-testid="workflow-node"][data-node-type="google.sheets"]').click();

    const picker = page.getByTestId("google-connection");
    await expect(picker.locator("option")).toHaveText(["Select a Google Sheets connection", "Project Sheets"]);
    await expect(picker).not.toHaveClass(/font-mono/);

    await picker.selectOption(CONNECTION_SHEETS_ID);
    await page.getByTestId("workflow-save-inspector").click();
    await expect.poll(() => savedDrafts.length).toBe(1);
    expect(sheetsConfig).toMatchObject({ connectionId: CONNECTION_SHEETS_ID });

    await picker.selectOption("");
    await page.getByTestId("workflow-save-inspector").click();
    await expect.poll(() => savedDrafts.length).toBe(2);
    expect(sheetsConfig).not.toHaveProperty("connectionId");
  });

  test("shows a hint linking to Workspace connections when no Google Sheets connection exists", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, [connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE")]));
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, (route) =>
      fulfillJson(route, {
        workflowId: WORKFLOW_ID, name: "Sheet report", status: "DRAFT", schemaVersion: "1.0", currentVersionId: null,
        createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
        definition: { schemaVersion: "1.0", nodes: [{ id: "sheets", type: "google.sheets", config: {} }], edges: [], variables: {} },
        editorState: { nodes: { sheets: { name: "Read sheet", position: { x: 0, y: 0 } } } },
      }),
    );
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    await page.locator('[data-testid="workflow-node"][data-node-type="google.sheets"]').click();
    const hint = page.getByTestId("google-connection-empty");
    await expect(hint).toBeVisible();
    await expect(hint.getByRole("link")).toHaveAttribute("href", "/workspace/connections");
  });

  test("row menu is keyboard accessible, shows one primary action and returns focus on Escape", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [{ ...connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"), hasCredential: true }]),
    );
    await gotoAuthenticatedConnections(page);
    const row = page.getByTestId(`connection-row-${CONNECTION_GMAIL_ID}`);
    // A healthy Google connection shows "test" as the primary action; authorization moves into the menu.
    await expect(row.getByTestId(`connection-test-${CONNECTION_GMAIL_ID}`)).toBeVisible();
    await expect(row.getByTestId(`connection-oauth-${CONNECTION_GMAIL_ID}`)).toHaveCount(0);
    const trigger = row.getByTestId("connection-row-menu");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(row.getByRole("menu")).toBeVisible();
    await expect(row.getByTestId(`connection-rename-${CONNECTION_GMAIL_ID}`)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(row.getByTestId(`connection-delete-${CONNECTION_GMAIL_ID}`)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(row.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("workflow builder connection readiness", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000002";
  const NEW_SHEETS_ID = "20000000-0000-4000-8000-0000000000aa";
  const INVALID_GMAIL_ID = "20000000-0000-4000-8000-0000000000e8";
  const sheetsNode = '[data-testid="workflow-node"][data-node-type="google.sheets"]';
  const emailNode = '[data-testid="workflow-node"][data-node-type="email.send"]';

  const detail = (sheetsConfig: Record<string, unknown>, emailConfig: Record<string, unknown>) => ({
    workflowId: WORKFLOW_ID,
    name: "Sheet to mail",
    status: "DRAFT",
    schemaVersion: "1.0",
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    definition: {
      schemaVersion: "1.0",
      nodes: [
        { id: "manual", type: "trigger.manual", config: {} },
        { id: "sheets", type: "google.sheets", config: sheetsConfig },
        { id: "email", type: "email.send", config: emailConfig },
      ],
      edges: [
        { id: "manual-sheets", source: "manual", target: "sheets" },
        { id: "sheets-email", source: "sheets", target: "email" },
      ],
      variables: {},
    },
    editorState: {
      nodes: {
        manual: { name: "Start", position: { x: 0, y: 0 } },
        sheets: { name: "Read sheet", position: { x: 320, y: 0 } },
        email: { name: "Mail it", position: { x: 640, y: 0 } },
      },
    },
  });

  async function routeWorkflow(page: Page, state: { sheets: Record<string, unknown>; email: Record<string, unknown> }, drafts: unknown[] = []) {
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { definition: { nodes: Array<{ id: string; config: Record<string, unknown> }> } };
        drafts.push(body);
        state.sheets = body.definition.nodes.find((node) => node.id === "sheets")?.config ?? {};
        state.email = body.definition.nodes.find((node) => node.id === "email")?.config ?? {};
        return fulfillJson(route, detail(state.sheets, state.email));
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail(state.sheets, state.email));
      return fulfillJson(route, pageResult([]));
    });
  }

  test("badge, inspector warning and publish blocker share one verdict", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE"),
        connection(INVALID_GMAIL_ID, "GMAIL", WORKSPACE_ID, "INVALID"),
      ]),
    );
    const state = {
      sheets: { connectionId: CONNECTION_SHEETS_ID, operation: "read", spreadsheetId: "sheet-1", range: "Sheet1!A1:B2" },
      email: { connectionId: INVALID_GMAIL_ID, to: "team@example.test", subject: "Weekly", body: "Hi" },
    };
    await routeWorkflow(page, state);
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);

    // An ACTIVE, attachable connection plus the required fields is ready (it used to say "Authorization required").
    await expect(page.locator(sheetsNode)).toHaveAttribute("data-readiness", "ready");
    await page.locator(sheetsNode).click();
    await expect(page.getByTestId("integration-readiness")).toHaveCount(0);

    await page.locator(emailNode).click();
    await expect(page.locator(emailNode)).toHaveAttribute("data-readiness", "authorization-required");
    await expect(page.getByTestId("integration-readiness")).toContainText("must authorize this Gmail connection");
    await expect(page.getByTestId("workflow-publish")).toBeDisabled();

    // Missing required fields means not configured, even with a valid connection.
    await page.locator(sheetsNode).click();
    await page.locator("#google-spreadsheet-id").fill("");
    await expect(page.locator(sheetsNode)).toHaveAttribute("data-readiness", "not-configured");
    await expect(page.getByTestId("integration-readiness")).toContainText("spreadsheet ID");
  });

  test("Sheets writes are entered cell by cell and drafts carry only Workflow Service fields", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE")]),
    );
    const drafts: unknown[] = [];
    const state = {
      sheets: { connectionId: CONNECTION_SHEETS_ID, operation: "read", spreadsheetId: "sheet-1", range: "B1:Z100" } as Record<string, unknown>,
      email: { to: "team@example.test", subject: "Weekly", body: "Hi" } as Record<string, unknown>,
    };
    await routeWorkflow(page, state, drafts);
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);

    await page.locator(sheetsNode).click();
    await page.locator("#google-operation").selectOption("append");
    await expect(page.locator(sheetsNode)).toHaveAttribute("data-readiness", "not-configured");
    const cells = page.getByTestId("google-cell");
    await expect(cells).toHaveCount(1);
    // Column labels follow the range start column (B).
    await expect(page.getByTestId("google-row-editor")).toContainText("Col B");
    await cells.first().fill("{{ trigger.input.email }}");
    await page.getByTestId("google-add-cell").click();
    await cells.nth(1).fill("42");
    await expect(page.getByTestId("google-row-editor")).toContainText("Col C");
    await expect(page.locator(sheetsNode)).toHaveAttribute("data-readiness", "ready");

    await page.getByTestId("workflow-save-inspector").click();
    await expect.poll(() => drafts.length).toBe(1);
    expect(Object.keys(state.sheets).sort()).toEqual(["connectionId", "operation", "range", "spreadsheetId", "values"]);
    expect(state.sheets.values).toEqual([["{{ trigger.input.email }}", "42"]]);
  });

  test("a step added from the palette follows the selected step and is linked to it", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, []));
    await routeWorkflow(page, { sheets: { operation: "read" }, email: { to: "a@example.test", subject: "s" } });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    const edges = page.locator(".react-flow__edge");
    await expect(edges).toHaveCount(2);

    await page.locator(emailNode).click();
    await page.getByTestId("workflow-add-step").click();
    await page.locator('[data-testid="workflow-palette-item"][data-node-type="http.request"]').click();
    await expect(edges).toHaveCount(3);
    const x = async (selector: string) => (await page.locator(selector).boundingBox())!.x;
    expect(await x('[data-testid="workflow-node"][data-node-type="http.request"]')).toBeGreaterThan(await x(emailNode));

    // Deleting the Sheets step leaves the mail step unreachable, which blocks publication before the server does.
    await page.locator(sheetsNode).click();
    await page.keyboard.press("Backspace");
    await expect(page.locator(sheetsNode)).toHaveCount(0);
    await expect(page.getByText("A step is not connected to a trigger")).toBeVisible();
    await expect(page.getByTestId("workflow-publish")).toBeDisabled();
  });

  test("editor header sections do not overlap at a narrow desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await installAuthFixture(page);
    // Vietnamese labels are the longest ("Trình chỉnh sửa", "Lịch sử chạy").
    await page.addInitScript(() => localStorage.setItem("weav_lang_v1", "VI"));
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, []));
    await routeWorkflow(page, { sheets: { operation: "read" }, email: { to: "a@example.test", subject: "s" } });
    // Published: the header also shows the on/off switch and Run, its widest state.
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}`, (route) =>
      fulfillJson(route, { ...detail({ operation: "read" }, { to: "a@example.test", subject: "s" }), status: "PUBLISHED", currentVersionId: "40000000-0000-4000-8000-000000000001" }),
    );
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    await expect(page.getByTestId("workflow-active-switch")).toBeVisible();
    const nav = page.getByRole("navigation", { name: /sections|Các phần/i });
    await expect(nav).toBeVisible();
    const navBox = (await nav.boundingBox())!;
    // The actions are right-aligned, so on overflow their leftmost control slides over the tabs.
    const firstAction = (await page.getByTestId("workflow-publish").locator("xpath=../*[1]").boundingBox())!;
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(firstAction.x);
  });

  test("run history section tabs stay on one line at a narrow desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    await installAuthFixture(page);
    await page.addInitScript(() => localStorage.setItem("weav_lang_v1", "VI"));
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, []));
    await routeWorkflow(page, { sheets: { operation: "read" }, email: { to: "a@example.test", subject: "s" } });
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}`, (route) =>
      fulfillJson(route, { ...detail({ operation: "read" }, { to: "a@example.test", subject: "s" }), name: "Untitled Automation Pipeline for monthly invoices" }),
    );
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/executions`);
    const tabs = page.getByTestId("executions-tripane").getByRole("navigation").locator("a, span");
    await expect(tabs.first()).toBeVisible();
    // One client rect per text node means the label did not wrap.
    const lines = await tabs.evaluateAll((els) => els.map((el) => {
      type RangeLike = { selectNodeContents(node: unknown): void; getClientRects(): Iterable<{ top: number }> };
      const range = (globalThis as unknown as { document: { createRange(): RangeLike } }).document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    }));
    expect(lines.every((count) => count === 1)).toBe(true);
  });

  test("run publishes unpublished draft changes first", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE"),
        connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
      ]),
    );
    const calls: string[] = [];
    const published = {
      ...detail(
        { connectionId: CONNECTION_SHEETS_ID, operation: "read", spreadsheetId: "sheet-1", range: "A1:Z100" },
        { connectionId: CONNECTION_GMAIL_ID, to: "a@example.test", subject: "s", body: "b" },
      ),
      status: "PUBLISHED",
      currentVersionId: "40000000-0000-4000-8000-000000000001",
      publishedAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-02T00:00:00Z",
    };
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST") {
        calls.push(path.split("/").pop() ?? "");
        if (path.endsWith("/publish")) {
          return fulfillJson(route, { workflow: { ...published, publishedAt: "2026-08-03T00:00:00Z", updatedAt: "2026-08-03T00:00:00Z" }, webhooks: [] });
        }
        return fulfillJson(route, { executionId: "50000000-0000-4000-8000-000000000001", status: "QUEUED" }, 202);
      }
      if (path.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, published);
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);

    const run = page.getByTestId("workflow-run");
    await expect(run).toHaveText("Publish and run");
    await run.click();
    await expect.poll(() => calls).toEqual(["publish", expect.any(String)]);
    expect(calls[1]).not.toBe("publish");
  });

  test("workflow list deletes through the Workflow Service in HTTP mode", async ({ page }) => {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, []));
    const deleted: string[] = [];
    const summary = { workflowId: WORKFLOW_ID, name: "Sheet to mail", status: "DRAFT", schemaVersion: "1.0", currentVersionId: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" };
    await page.route("**/api/v1/workspaces/*/workflows**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "DELETE") {
        deleted.push(url.pathname);
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname.endsWith("/workflows")) return fulfillJson(route, pageResult(deleted.length ? [] : [summary]));
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, "/workflows");

    const row = page.getByTestId("workflow-row").filter({ hasText: "Sheet to mail" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "More workflow actions" }).click();
    const deleteItem = page.getByRole("menuitem", { name: /Delete/ });
    // The table cell must not clip the menu: its item has to be the element under its own center.
    const unclipped = await deleteItem.evaluate((item) => {
      const el = item as unknown as {
        getBoundingClientRect: () => { x: number; y: number; width: number; height: number };
        contains: (other: unknown) => boolean;
        ownerDocument: { elementFromPoint: (x: number, y: number) => unknown };
      };
      const box = el.getBoundingClientRect();
      return el.contains(el.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
    expect(unclipped).toBe(true);
    await deleteItem.click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("textbox").fill("delete 1");
    await dialog.getByRole("button", { name: "Delete workflows" }).click();

    await expect.poll(() => deleted).toEqual([`/api/v1/workspaces/${WORKSPACE_ID}/workflows/${WORKFLOW_ID}`]);
    await expect(page.getByTestId("workflow-row").filter({ hasText: "Sheet to mail" })).toHaveCount(0);
  });

  test("adds a Google Sheets connection from the inspector, saves the draft and returns to the step after OAuth", async ({ page }) => {
    await installAuthFixture(page);
    let created = false;
    let authorized = false;
    let createdProvider = "";
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      if (route.request().method() === "POST") {
        createdProvider = String((route.request().postDataJSON() as { provider?: unknown }).provider);
        created = true;
        return fulfillJson(route, connection(NEW_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "DISABLED"), 201);
      }
      return fulfillJson(
        route,
        created ? [connection(NEW_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, authorized ? "ACTIVE" : "DISABLED")] : [],
      );
    });
    await page.route(`**/api/v1/workspaces/*/connections/${NEW_SHEETS_ID}/oauth/authorize`, (route) =>
      fulfillJson(route, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=s" }),
    );
    await page.route("https://accounts.google.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "Google consent fixture" }),
    );
    const drafts: unknown[] = [];
    const state = {
      sheets: { operation: "read", spreadsheetId: "sheet-1", range: "Sheet1!A1:B2" } as Record<string, unknown>,
      email: { to: "team@example.test", subject: "Weekly", body: "Hi" } as Record<string, unknown>,
    };
    await routeWorkflow(page, state, drafts);
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);

    await page.locator(sheetsNode).click();
    await page.getByTestId("add-connection-GOOGLE_SHEETS").click();
    const dialog = page.getByTestId("connection-create-dialog");
    await expect(dialog.getByTestId("connection-create-provider")).toHaveValue("GOOGLE_SHEETS");
    await dialog.getByTestId("connection-create-name").fill("Finance Sheets");
    await dialog.getByTestId("connection-create-submit").click();

    await expect(page).toHaveURL(/https:\/\/accounts\.google\.com\//);
    expect(createdProvider).toBe("GOOGLE_SHEETS");
    expect(drafts).toHaveLength(1);
    expect(state.sheets).toMatchObject({ connectionId: NEW_SHEETS_ID, spreadsheetId: "sheet-1" });

    // Google sends the user back to the Connections callback; a verified connection returns to the step.
    authorized = true;
    await gotoAuthenticatedPath(page, `/connections?oauth=success&connectionId=${NEW_SHEETS_ID}`);
    await expect(page).toHaveURL(new RegExp(`/workflows/${WORKFLOW_ID}[?]step=sheets$`));
    await expect(page.getByTestId("google-connection")).toHaveValue(NEW_SHEETS_ID);
    await expect(page.locator(sheetsNode)).toHaveAttribute("data-readiness", "ready");
  });
});

test.describe("workflow builder Week 4 node fields", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000004";
  const node = (type: string) => `[data-testid="workflow-node"][data-node-type="${type}"]`;
  type Configs = Record<string, Record<string, unknown>>;
  const TYPES: Record<string, string> = {
    sheets: "google.sheets",
    email: "email.send",
    condition: "logic.condition",
    telegram: "telegram.send_message",
  };

  const detail = (configs: Configs) => ({
    workflowId: WORKFLOW_ID,
    name: "Week 4 fields",
    status: "DRAFT",
    schemaVersion: "1.0",
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    definition: {
      schemaVersion: "1.0",
      nodes: [
        { id: "manual", type: "trigger.manual", config: {} },
        ...Object.entries(TYPES).map(([id, type]) => ({ id, type, config: configs[id] })),
      ],
      edges: Object.keys(TYPES).map((id) => ({ id: `manual-${id}`, source: "manual", target: id })),
      variables: {},
    },
    editorState: {
      nodes: Object.fromEntries(
        ["manual", ...Object.keys(TYPES)].map((id, index) => [id, { name: id, position: { x: index === 0 ? 0 : 320, y: index * 140 } }]),
      ),
    },
  });

  async function openBuilder(page: Page, configs: Configs) {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        connection(CONNECTION_SHEETS_ID, "GOOGLE_SHEETS", WORKSPACE_ID, "ACTIVE"),
        connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
        connection(CONNECTION_TELEGRAM_ID, "TELEGRAM", WORKSPACE_ID, "ACTIVE"),
      ]),
    );
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { definition: { nodes: Array<{ id: string; config: Record<string, unknown> }> } };
        for (const item of body.definition.nodes) configs[item.id] = item.config;
        return fulfillJson(route, detail(configs));
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail(configs));
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
  }

  const baseConfigs = (): Configs => ({
    sheets: { connectionId: CONNECTION_SHEETS_ID, operation: "read", spreadsheetId: "sheet-1", range: "A1:D50" },
    email: { connectionId: CONNECTION_GMAIL_ID, to: "team@example.test", subject: "Weekly", body: "Hi" },
    condition: { left: "{{ trigger.input.total }}", operator: "eq", right: "1" },
    telegram: { chatId: "", text: "" },
  });

  async function saveDraft(page: Page) {
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/draft"));
    await page.getByTestId("workflow-save-inspector").click();
    await saved;
  }

  test("Sheets lookup needs a column and a value and saves only lookup fields", async ({ page }) => {
    const configs = baseConfigs();
    await openBuilder(page, configs);

    await page.locator(node("google.sheets")).click();
    await page.locator("#google-operation").selectOption("lookup");
    await expect(page.locator(node("google.sheets"))).toHaveAttribute("data-readiness", "not-configured");
    await expect(page.getByTestId("google-row-editor")).toHaveCount(0);
    await page.getByLabel("Lookup column").fill("B");
    await page.getByLabel("Value to find").fill("{{ trigger.input.email }}");
    await page.getByLabel("Maximum rows").fill("5");
    await expect(page.locator(node("google.sheets"))).toHaveAttribute("data-readiness", "ready");

    await saveDraft(page);
    expect(configs.sheets).toEqual({
      connectionId: CONNECTION_SHEETS_ID,
      operation: "lookup",
      spreadsheetId: "sheet-1",
      range: "A1:D50",
      lookupColumn: "B",
      lookupValue: "{{ trigger.input.email }}",
      limit: 5,
    });
  });

  test("email cc, HTML body, sender name and attachments are saved in the Workflow Service shape", async ({ page }) => {
    const configs = baseConfigs();
    await openBuilder(page, configs);

    await page.locator(node("email.send")).click();
    await page.getByLabel("Body format").selectOption("html");
    await page.getByLabel("Cc", { exact: true }).fill("a@example.test, b@example.test");
    await page.getByTestId("attachment-add").click();
    // The source select is narrow so the URL input keeps usable width inside the 400px inspector.
    expect((await page.getByTestId("attachment-source").boundingBox())!.width).toBeGreaterThan(150);
    await page.getByTestId("attachment-source").fill("https://files.example.test/report.pdf");
    await page.getByTestId("attachment-filename").fill("report.pdf");
    await page.getByTestId("attachment-add").click();
    await page.getByLabel("Source of file 2").selectOption("fileId");
    await page.getByTestId("attachment-source").nth(1).fill("{{ trigger.input.attachments[0].fileId }}");
    await page.getByTestId("email-advanced").locator("summary").click();
    await page.getByLabel("Sender name").fill("Weav bot");
    await expect(page.locator(node("email.send"))).toHaveAttribute("data-readiness", "ready");

    await saveDraft(page);
    expect(configs.email).toEqual({
      connectionId: CONNECTION_GMAIL_ID,
      to: "team@example.test",
      subject: "Weekly",
      body: "Hi",
      bodyType: "html",
      cc: "a@example.test, b@example.test",
      attachments: [
        { url: "https://files.example.test/report.pdf", filename: "report.pdf" },
        { fileId: "{{ trigger.input.attachments[0].fileId }}" },
      ],
      senderName: "Weav bot",
    });

    // A mapping replaces the list; at most five files can be listed.
    await page.getByTestId("attachments-mode").selectOption("mapping");
    await page.getByTestId("attachments-mapping").fill("{{ trigger.input.attachments }}");
    await saveDraft(page);
    expect(configs.email.attachments).toBe("{{ trigger.input.attachments }}");
    await page.getByTestId("attachments-mode").selectOption("list");
    for (let i = 0; i < 5; i += 1) await page.getByTestId("attachment-add").click();
    await expect(page.getByTestId("attachment-add")).toBeDisabled();
  });

  test("a condition switches to AND/OR form without mixing keys and saves numeric ordering operands", async ({ page }) => {
    const configs = baseConfigs();
    await openBuilder(page, configs);

    await page.locator(node("logic.condition")).click();
    await page.getByTestId("condition-mode-multi").click();
    await expect(page.getByTestId("condition-row")).toHaveCount(1);
    await page.getByTestId("condition-combinator").selectOption("or");
    await page.getByTestId("condition-add").click();
    await expect(page.locator(node("logic.condition"))).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("condition-left").nth(1).fill("{{ trigger.input.amount }}");
    await page.getByTestId("condition-operator").nth(1).selectOption("gt");
    await page.getByTestId("condition-right").nth(1).fill("500");
    await expect(page.locator(node("logic.condition"))).toHaveAttribute("data-readiness", "ready");

    await saveDraft(page);
    expect(configs.condition).toEqual({
      combinator: "or",
      conditions: [
        { left: "{{ trigger.input.total }}", operator: "eq", right: "1" },
        { left: "{{ trigger.input.amount }}", operator: "gt", right: 500 },
      ],
    });

    // Back to one condition keeps the first one and drops the multi keys.
    await page.getByTestId("condition-mode-single").click();
    await saveDraft(page);
    expect(configs.condition).toEqual({ left: "{{ trigger.input.total }}", operator: "eq", right: "1" });
  });

  test("Telegram send picks a bot connection and saves its new options", async ({ page }) => {
    const configs = baseConfigs();
    await openBuilder(page, configs);

    await page.locator(node("telegram.send_message")).click();
    await expect(page.getByTestId("integration-readiness")).toContainText("select a Telegram bot connection");
    await page.getByLabel("Telegram bot connection").selectOption(CONNECTION_TELEGRAM_ID);
    await page.locator("#telegram-chat-id").fill("-100123");
    await page.locator("#telegram-text").fill("<b>Hi</b>");
    await page.getByLabel("Parse mode").selectOption("HTML");
    await page.getByLabel("Send silently").check();
    await page.getByLabel("Reply to message ID").fill("42");
    await expect(page.locator(node("telegram.send_message"))).toHaveAttribute("data-readiness", "ready");
    await expect(page.getByTestId("integration-readiness")).toHaveCount(0);

    await saveDraft(page);
    expect(configs.telegram).toEqual({
      connectionId: CONNECTION_TELEGRAM_ID,
      chatId: "-100123",
      text: "<b>Hi</b>",
      parseMode: "HTML",
      disableNotification: true,
      replyToMessageId: 42,
    });
  });
});

test.describe("workflow builder Week 4 new nodes", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000005";
  const node = (type: string) => `[data-testid="workflow-node"][data-node-type="${type}"]`;
  type Cfg = Record<string, unknown>;
  type NodeSpec = { id: string; type: string; config: Cfg };
  type Edge = { id: string; source: string; target: string; sourcePort?: string };
  type Definition = { nodes: NodeSpec[]; edges: Edge[] };

  const driveConnections = () => [
    connection(CONNECTION_DRIVE_ID, "GOOGLE_DRIVE", WORKSPACE_ID, "ACTIVE"),
    connection(CONNECTION_DRIVE_DISABLED_ID, "GOOGLE_DRIVE", WORKSPACE_ID, "DISABLED"),
    { ...connection(CONNECTION_DRIVE_LOCKED_ID, "GOOGLE_DRIVE", WORKSPACE_ID, "ACTIVE"), canAttach: false },
    connection(CONNECTION_CALENDAR_ID, "GOOGLE_CALENDAR", WORKSPACE_ID, "ACTIVE"),
    connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
  ];

  /** Opens the builder on a workflow made of `specs`; the returned state holds the last PUT /draft definition. */
  async function openBuilder(page: Page, specs: NodeSpec[], edges: Edge[] = []) {
    const state: { saved?: Definition } = {};
    const detail = (definition: Definition) => ({
      workflowId: WORKFLOW_ID,
      name: "Week 4 new nodes",
      status: "DRAFT",
      schemaVersion: "1.0",
      currentVersionId: null,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      definition: { schemaVersion: "1.0", ...definition, variables: {} },
      editorState: {
        nodes: Object.fromEntries(
          definition.nodes.map((item, index) => [item.id, { name: item.id, position: { x: index * 340, y: (index % 2) * 160 } }]),
        ),
      },
    });
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, driveConnections()));
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        state.saved = (route.request().postDataJSON() as { definition: Definition }).definition;
        return fulfillJson(route, detail(state.saved));
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail({ nodes: specs, edges }));
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    return state;
  }

  async function saveDraft(page: Page) {
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/draft"));
    await page.getByTestId("workflow-save-inspector").click();
    await saved;
  }

  const savedConfig = (state: { saved?: Definition }, id: string) => state.saved?.nodes.find((item) => item.id === id)?.config;

  test("Google Drive lists only attachable ACTIVE Drive connections and validates upload content", async ({ page }) => {
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "drive", type: "google.drive", config: { connectionId: CONNECTION_DRIVE_ID, operation: "upload", content: "hello" } },
    ], [{ id: "manual-drive", source: "manual", target: "drive" }]);
    const drive = page.locator(node("google.drive"));

    await drive.click();
    const options = await page.getByTestId("field-connectionId").locator("option").evaluateAll((items) => items.map((item) => item.getAttribute("value")));
    expect(options).toEqual(["", CONNECTION_DRIVE_ID]);
    await expect(drive).toHaveAttribute("data-readiness", "not-configured");

    await page.getByTestId("field-name").fill("notes.txt");
    await expect(drive).toHaveAttribute("data-readiness", "ready");

    await page.getByTestId("field-file").fill("{{ trigger.input.file }}");
    await expect(drive).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("field-file").fill("");
    await expect(drive).toHaveAttribute("data-readiness", "ready");

    await saveDraft(page);
    expect(savedConfig(state, "drive")).toEqual({ connectionId: CONNECTION_DRIVE_ID, operation: "upload", content: "hello", name: "notes.txt" });

    // Friendly option names; the saved value stays the raw enum.
    await expect(page.getByTestId("field-operation")).toContainText("Upload a file");
    await expect(page.getByTestId("field-operation")).toContainText("List files");
    await page.getByTestId("field-operation").selectOption("list");
    await expect(page.getByTestId("field-folderId")).toBeVisible();
    await expect(page.getByTestId("field-nameContains")).toBeVisible();
    await expect(page.getByTestId("field-content")).toHaveCount(0);
    await page.getByTestId("field-folderId").fill("folder-1");
    await page.getByTestId("field-nameContains").fill("report");
    await page.getByTestId("field-pageSize").fill("20");
    await expect(drive).toHaveAttribute("data-readiness", "ready");
    await saveDraft(page);
    expect(savedConfig(state, "drive")).toMatchObject({
      connectionId: CONNECTION_DRIVE_ID,
      operation: "list",
      folderId: "folder-1",
      nameContains: "report",
      pageSize: 20,
    });
  });

  test("Google Calendar create needs title, start and end; list needs nothing", async ({ page }) => {
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "calendar", type: "google.calendar", config: { connectionId: CONNECTION_CALENDAR_ID, operation: "create" } },
    ], [{ id: "manual-calendar", source: "manual", target: "calendar" }]);
    const calendar = page.locator(node("google.calendar"));

    await calendar.click();
    await expect(calendar).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("field-summary").fill("Kickoff");
    await page.getByTestId("field-start").fill("2026-10-07T09:00:00+07:00");
    await expect(calendar).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("field-end").fill("2026-10-07T10:00:00+07:00");
    await expect(calendar).toHaveAttribute("data-readiness", "ready");
    await page.getByTestId("field-attendees").fill("a@x.test, b@x.test");
    await page.getByTestId("field-sendInvitations").check();

    await saveDraft(page);
    expect(savedConfig(state, "calendar")).toEqual({
      connectionId: CONNECTION_CALENDAR_ID,
      operation: "create",
      summary: "Kickoff",
      start: "2026-10-07T09:00:00+07:00",
      end: "2026-10-07T10:00:00+07:00",
      attendees: ["a@x.test", "b@x.test"],
      sendInvitations: true,
    });

    await page.getByTestId("field-operation").selectOption("list");
    await expect(page.getByTestId("field-summary")).toHaveCount(0);
    await page.getByTestId("field-maxResults").fill("5");
    await expect(calendar).toHaveAttribute("data-readiness", "ready");
    await saveDraft(page);
    expect(savedConfig(state, "calendar")).toMatchObject({ operation: "list", maxResults: 5 });
  });

  test("Gmail trigger saves its connection, query and numeric poll interval", async ({ page }) => {
    const state = await openBuilder(page, [{ id: "gmail", type: "trigger.gmail", config: {} }]);
    const gmail = page.locator(node("trigger.gmail"));

    await gmail.click();
    await expect(gmail).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("field-connectionId").selectOption(CONNECTION_GMAIL_ID);
    await page.getByTestId("field-query").fill("from:boss@x.test has:attachment");
    await page.getByTestId("field-pollIntervalMinutes").fill("15");
    await expect(gmail).toHaveAttribute("data-readiness", "ready");

    await saveDraft(page);
    expect(savedConfig(state, "gmail")).toEqual({
      connectionId: CONNECTION_GMAIL_ID,
      query: "from:boss@x.test has:attachment",
      pollIntervalMinutes: 15,
    });
  });

  test("AI generate needs a prompt and saves instructions and a numeric max length", async ({ page }) => {
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "ai", type: "ai.generate", config: { prompt: "" } },
    ], [{ id: "manual-ai", source: "manual", target: "ai" }]);
    const ai = page.locator(node("ai.generate"));

    await ai.click();
    await expect(ai).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("field-prompt").fill("Summarize {{ trigger.input.text }}");
    await expect(ai).toHaveAttribute("data-readiness", "ready");
    await page.getByTestId("field-instructions").fill("Be brief");
    await page.getByTestId("field-maxLength").fill("300");

    await saveDraft(page);
    expect(savedConfig(state, "ai")).toEqual({
      prompt: "Summarize {{ trigger.input.text }}",
      instructions: "Be brief",
      maxLength: 300,
    });
  });

  test("Switch exposes one port per case plus Default, rejects bad cases and prunes removed ports", async ({ page }) => {
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "switch", type: "logic.switch", config: { value: "{{ trigger.input.status }}", cases: ["paid", "refunded"] } },
      { id: "after-refund", type: "data.set", config: { fields: { a: "1" } } },
      { id: "after-default", type: "data.set", config: { fields: { b: "2" } } },
    ], [
      { id: "manual-switch", source: "manual", target: "switch" },
      { id: "switch-refund", source: "switch", target: "after-refund", sourcePort: "refunded" },
      { id: "switch-default", source: "switch", target: "after-default", sourcePort: "default" },
    ]);
    const sw = page.locator(node("logic.switch"));

    await expect(sw).toHaveAttribute("data-readiness", "ready");
    await expect(page.getByTestId("condition-port-label-paid")).toHaveText("paid");
    await expect(page.getByTestId("condition-port-label-refunded")).toHaveText("refunded");
    await expect(page.getByTestId("condition-port-label-default")).toHaveText("Default");
    await expect(page.getByTestId("condition-source-paid")).toHaveCount(1);

    await sw.click();
    // "default" is reserved and a duplicate is rejected; each shows an alert and blocks readiness.
    await page.getByTestId("switch-add").click();
    await page.getByLabel("Case 3", { exact: true }).fill("default");
    await expect(page.getByRole("alert")).toContainText("reserved");
    await expect(sw).toHaveAttribute("data-readiness", "not-configured");
    await page.getByLabel("Case 3", { exact: true }).fill("paid");
    await expect(page.getByRole("alert")).toContainText("Duplicate");
    await expect(sw).toHaveAttribute("data-readiness", "not-configured");
    await page.getByLabel("Remove case 3").click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(sw).toHaveAttribute("data-readiness", "ready");

    // Removing "refunded" drops its edge from the canvas; the default edge stays.
    await page.getByLabel("Remove case 2").click();
    await expect(page.getByTestId("condition-port-label-refunded")).toHaveCount(0);
    await saveDraft(page);
    expect(savedConfig(state, "switch")).toEqual({ value: "{{ trigger.input.status }}", cases: ["paid"] });
    const edges = state.saved?.edges ?? [];
    expect(edges.find((edge) => edge.target === "after-refund")).toBeUndefined();
    expect(edges.find((edge) => edge.target === "after-default")).toMatchObject({ source: "switch", sourcePort: "default" });
    expect(edges.find((edge) => edge.target === "switch")).toBeDefined();
  });

  test("data.set saves named fields, flags a repeated name, supports a mapping and needs content", async ({ page }) => {
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "set", type: "data.set", config: { fields: {} } },
    ], [{ id: "manual-set", source: "manual", target: "set" }]);
    const set = page.locator(node("data.set"));

    await set.click();
    await expect(set).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("data-set-add").click();
    await page.getByLabel("Field 1 name").fill("email");
    await page.getByLabel("Value type of field 1").selectOption("mapping");
    await page.getByLabel("Field 1 value").fill("{{ trigger.input.email }}");
    await page.getByTestId("data-set-add").click();
    await page.getByLabel("Field 2 name").fill("plan");
    await page.getByLabel("Field 2 value").fill("pro");
    await expect(set).toHaveAttribute("data-readiness", "ready");
    await saveDraft(page);
    expect(savedConfig(state, "set")).toEqual({ fields: { email: "{{ trigger.input.email }}", plan: "pro" } });

    // Number is saved as a JSON number and Yes/No as a boolean; a text value that looks numeric stays text.
    await page.getByTestId("data-set-add").click();
    await page.getByLabel("Field 3 name").fill("count");
    await page.getByLabel("Value type of field 3").selectOption("number");
    await page.getByLabel("Field 3 value").fill("42");
    await page.getByTestId("data-set-add").click();
    await page.getByLabel("Field 4 name").fill("active");
    await page.getByLabel("Value type of field 4").selectOption("boolean");
    await page.getByLabel("Field 4 value").selectOption("false");
    await page.getByTestId("data-set-add").click();
    await page.getByLabel("Field 5 name").fill("code");
    await page.getByLabel("Field 5 value").fill("007");
    await saveDraft(page);
    expect(savedConfig(state, "set")).toEqual({
      fields: { email: "{{ trigger.input.email }}", plan: "pro", count: 42, active: false, code: "007" },
    });

    // An invalid number shows a friendly error and is left out of the saved fields until fixed.
    await page.getByLabel("Field 3 value").fill("forty");
    await expect(page.getByRole("alert")).toContainText("Enter a number");
    await saveDraft(page);
    expect(savedConfig(state, "set")).toEqual({
      fields: { email: "{{ trigger.input.email }}", plan: "pro", active: false, code: "007" },
    });
    await page.getByLabel("Field 3 value").fill("3.5");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await saveDraft(page);
    expect((savedConfig(state, "set") as { fields: Record<string, unknown> }).fields.count).toBe(3.5);
    for (let i = 0; i < 3; i += 1) await page.getByLabel("Remove field 3").click();

    await page.getByLabel("Field 2 name").fill("email");
    await expect(page.getByRole("alert")).toContainText("Duplicate");
    await page.getByLabel("Field 2 name").fill("plan");
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByTestId("data-set-mode").selectOption("mapping");
    await page.getByTestId("data-set-mapping").fill("{{ nodes.lookup.output.rows[0] }}");
    await expect(set).toHaveAttribute("data-readiness", "ready");
    await saveDraft(page);
    expect(savedConfig(state, "set")).toEqual({ fields: "{{ nodes.lookup.output.rows[0] }}" });

    await page.getByTestId("data-set-mapping").fill("");
    await expect(set).toHaveAttribute("data-readiness", "not-configured");
    await page.getByTestId("data-set-mode").selectOption("list");
    await page.getByLabel("Remove field 1").click();
    await page.getByLabel("Remove field 1").click();
    await expect(page.getByTestId("data-set-key")).toHaveCount(0);
    await expect(set).toHaveAttribute("data-readiness", "not-configured");
  });

  test("data.set infers the value type of an existing config and keeps advanced values unchanged", async ({ page }) => {
    const nested = { a: [1, 2], b: { c: true } };
    const state = await openBuilder(page, [
      { id: "manual", type: "trigger.manual", config: {} },
      { id: "set", type: "data.set", config: { fields: { name: "Ann", age: 30, vip: true, email: "{{ trigger.input.email }}", extra: nested } } },
    ], [{ id: "manual-set", source: "manual", target: "set" }]);

    await page.locator(node("data.set")).click();
    const types = page.getByTestId("data-set-type");
    await expect(types).toHaveCount(4);
    await expect(types.nth(0)).toHaveValue("text");
    await expect(types.nth(1)).toHaveValue("number");
    await expect(types.nth(2)).toHaveValue("boolean");
    await expect(types.nth(3)).toHaveValue("mapping");
    await expect(page.getByLabel("Field 2 value")).toHaveValue("30");
    await expect(page.getByLabel("Field 3 value")).toHaveValue("true");
    await expect(page.getByTestId("data-set-advanced")).toHaveText("Advanced value, kept as is.");

    await page.getByLabel("Field 1 value").fill("Bob");
    await saveDraft(page);
    expect(savedConfig(state, "set")).toEqual({
      fields: { name: "Bob", age: 30, vip: true, email: "{{ trigger.input.email }}", extra: nested },
    });
  });

  test("Connections page offers Google Calendar and Drive and lists them without a parse error", async ({ page }) => {
    await installAuthFixture(page);
    let createBody: { provider?: string } = {};
    let items = driveConnections();
    await page.route("**/api/v1/workspaces/*/connections", async (route) => {
      if (route.request().method() === "POST") {
        createBody = route.request().postDataJSON() as { provider?: string };
        const created = connection(CONNECTION_DRIVE_ID, "GOOGLE_DRIVE");
        items = [created];
        return fulfillJson(route, created, 201);
      }
      return fulfillJson(route, items);
    });
    await gotoAuthenticatedConnections(page);
    await expect(page.getByTestId(`connection-row-${CONNECTION_DRIVE_ID}`)).toContainText("Team Drive");
    await expect(page.getByTestId(`connection-row-${CONNECTION_CALENDAR_ID}`)).toContainText("Team Calendar");
    await expect(page.getByText(/invalid connection response/i)).toHaveCount(0);

    await page.getByTestId("connections-create-open").click();
    const providers = await page.getByTestId("connection-create-provider").locator("option").evaluateAll((list) => list.map((item) => item.getAttribute("value")));
    expect(providers).toEqual(expect.arrayContaining(["GOOGLE_CALENDAR", "GOOGLE_DRIVE"]));
    await page.getByTestId("connection-create-name").fill("Team Drive");
    await page.getByTestId("connection-create-provider").selectOption("GOOGLE_DRIVE");
    await page.getByTestId("connection-create-submit").click();
    await expect(page.getByTestId(`connection-status-${CONNECTION_DRIVE_ID}`)).toHaveAttribute("data-status", "DISABLED");
    expect(createBody.provider).toBe("GOOGLE_DRIVE");
  });

  test("the add-step palette offers the six new nodes", async ({ page }) => {
    await openBuilder(page, [{ id: "manual", type: "trigger.manual", config: {} }]);
    await page.getByTestId("workflow-add-step").click();
    for (const type of ["trigger.gmail", "google.drive", "google.calendar", "ai.generate", "logic.switch", "data.set"]) {
      await expect(page.locator(`[data-testid="workflow-palette-item"][data-node-type="${type}"]`)).toHaveCount(1);
    }
  });
});

test.describe("workflow builder Telegram trigger", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000006";
  const TG_ACTIVE_ID = "20000000-0000-4000-8000-000000000031";
  const TG_DISABLED_ID = "20000000-0000-4000-8000-000000000032";
  const TG_LOCKED_ID = "20000000-0000-4000-8000-000000000033";
  const triggerNode = '[data-testid="workflow-node"][data-node-type="trigger.telegram"]';
  let config: Record<string, unknown>;

  const detail = () => ({
    workflowId: WORKFLOW_ID,
    name: "Telegram trigger",
    status: "DRAFT",
    schemaVersion: "1.0",
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    definition: {
      schemaVersion: "1.0",
      nodes: [{ id: "tg", type: "trigger.telegram", config }],
      edges: [],
      variables: {},
    },
    editorState: { nodes: { tg: { name: "tg", position: { x: 0, y: 0 } } } },
  });

  test("lists only ACTIVE attachable Telegram bots, gates readiness on the choice and saves it", async ({ page }) => {
    config = {};
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) =>
      fulfillJson(route, [
        { ...connection(TG_ACTIVE_ID, "TELEGRAM", WORKSPACE_ID, "ACTIVE"), name: "Support bot" },
        { ...connection(TG_DISABLED_ID, "TELEGRAM", WORKSPACE_ID, "DISABLED"), name: "Disabled bot" },
        { ...connection(TG_LOCKED_ID, "TELEGRAM", WORKSPACE_ID, "ACTIVE"), name: "Locked bot", canAttach: false },
        connection(CONNECTION_GMAIL_ID, "GMAIL", WORKSPACE_ID, "ACTIVE"),
      ]),
    );
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        config = (route.request().postDataJSON() as { definition: { nodes: Array<{ config: Record<string, unknown> }> } })
          .definition.nodes[0].config;
        return fulfillJson(route, detail());
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail());
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);

    await page.locator(triggerNode).click();
    await expect(page.locator(triggerNode)).toHaveAttribute("data-readiness", "not-configured");
    await expect(page.getByTestId("integration-readiness")).toContainText("select a Telegram bot connection");
    await expect(page.getByTestId("publish-blocker-summary")).toContainText("select a Telegram bot connection");
    await expect(page.getByTestId("telegram-trigger-hint")).toContainText("WORKFLOW_PUBLIC_BASE_URL");
    await expect(page.getByTestId("add-connection-TELEGRAM")).toHaveAttribute("href", "/workspace/connections");

    const select = page.getByLabel("Telegram bot connection");
    await expect(select.locator("option")).toHaveCount(2);
    await expect(select).toContainText("Support bot");
    await expect(select).not.toContainText("Disabled bot");
    await expect(select).not.toContainText("Locked bot");
    await select.selectOption(TG_ACTIVE_ID);
    await expect(page.locator(triggerNode)).toHaveAttribute("data-readiness", "ready");
    await expect(page.getByTestId("integration-readiness")).toHaveCount(0);
    await expect(page.getByTestId("publish-blocker-summary")).toHaveCount(0);

    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/draft"));
    await page.getByTestId("workflow-save-inspector").click();
    await saved;
    expect(config).toEqual({ connectionId: TG_ACTIVE_ID });
  });
});

test.describe("workflow builder schedule picker", () => {
  const WORKFLOW_ID = "30000000-0000-4000-8000-000000000005";
  const node = '[data-testid="workflow-node"][data-node-type="trigger.schedule"]';
  type Config = Record<string, unknown>;
  const DEFAULT: Config = { cron: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" };

  const detail = (config: Config) => ({
    workflowId: WORKFLOW_ID,
    name: "Schedule picker",
    status: "DRAFT",
    schemaVersion: "1.0",
    currentVersionId: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    definition: { schemaVersion: "1.0", nodes: [{ id: "schedule", type: "trigger.schedule", config }], edges: [], variables: {} },
    editorState: { nodes: { schedule: { name: "schedule", position: { x: 0, y: 0 } } } },
  });

  async function openBuilder(page: Page, state: { config: Config }) {
    await installAuthFixture(page);
    await page.route("**/api/v1/workspaces/*/connections", (route) => fulfillJson(route, []));
    await page.route(`**/api/v1/workspaces/*/workflows/${WORKFLOW_ID}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/draft") && route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { definition: { nodes: Array<{ config: Config }> } };
        state.config = body.definition.nodes[0].config;
        return fulfillJson(route, detail(state.config));
      }
      if (url.pathname.endsWith(`/workflows/${WORKFLOW_ID}`)) return fulfillJson(route, detail(state.config));
      return fulfillJson(route, pageResult([]));
    });
    await gotoAuthenticatedPath(page, `/workflows/${WORKFLOW_ID}/builder`);
    await page.locator(node).click();
  }

  async function save(page: Page) {
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/draft"));
    await page.getByTestId("workflow-save-inspector").click();
    await saved;
  }

  test("the default config opens as daily 09:00 Vietnam time and saves nothing new until edited", async ({ page }) => {
    const state = { config: { ...DEFAULT } };
    await openBuilder(page, state);
    await expect(page.getByTestId("schedule-repeat")).toHaveValue("daily");
    await expect(page.getByTestId("schedule-time")).toHaveValue("09:00");
    await expect(page.getByTestId("schedule-timezone")).toHaveValue("Asia/Ho_Chi_Minh");
    await expect(page.getByTestId("schedule-summary")).toHaveText("Runs at 09:00 every day (Vietnam time)");
    await expect(page.getByTestId("schedule-cron")).toHaveCount(0);
    await expect(page.locator(node)).toHaveAttribute("data-readiness", "ready");

    await page.getByTestId("schedule-time").fill("18:05");
    await save(page);
    expect(state.config).toEqual({ cron: "0 5 18 * * *", timezone: "Asia/Ho_Chi_Minh" });
  });

  test("weekdays, every N minutes/hours and monthly build the expected cron", async ({ page }) => {
    const state = { config: { ...DEFAULT } };
    await openBuilder(page, state);

    await page.getByTestId("schedule-repeat").selectOption("weekly");
    await page.getByTestId("schedule-time").fill("08:30");
    await expect(page.getByTestId("schedule-summary")).toHaveText("Runs at 08:30 on Monday – Friday (Vietnam time)");
    await save(page);
    expect(state.config.cron).toBe("0 30 8 * * MON-FRI");

    await page.getByTestId("schedule-day-SAT").click();
    await page.getByTestId("schedule-day-WED").click();
    await save(page);
    expect(state.config.cron).toBe("0 30 8 * * MON,TUE,THU-SAT");
    await expect(page.getByTestId("schedule-day-WED")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("schedule-repeat").selectOption("minutes");
    await expect(page.getByTestId("schedule-summary")).toHaveText("Runs every 15 minutes");
    await save(page);
    expect(state.config.cron).toBe("0 */15 * * * *");
    await page.getByTestId("schedule-step").selectOption("5");
    await save(page);
    expect(state.config.cron).toBe("0 */5 * * * *");

    await page.getByTestId("schedule-repeat").selectOption("hours");
    await page.getByTestId("schedule-step").selectOption("6");
    await save(page);
    expect(state.config.cron).toBe("0 0 */6 * * *");

    await page.getByTestId("schedule-repeat").selectOption("monthly");
    await page.getByTestId("schedule-time").fill("07:00");
    await save(page);
    expect(state.config.cron).toBe("0 0 7 1 * *");
    await expect(page.getByTestId("schedule-summary")).toHaveText("Runs at 07:00 on day 1 of every month (Vietnam time)");
    await page.getByTestId("schedule-dom").selectOption("31");
    await expect(page.getByText("Months without this day")).toBeVisible();
    await save(page);
    expect(state.config.cron).toBe("0 0 7 31 * *");
  });

  test("the time zone comes from the list or from Other and a saved unlisted zone stays", async ({ page }) => {
    const state: { config: Config } = { config: { ...DEFAULT } };
    await openBuilder(page, state);

    await page.getByTestId("schedule-timezone").selectOption("Asia/Tokyo");
    await save(page);
    expect(state.config).toEqual({ cron: "0 0 9 * * *", timezone: "Asia/Tokyo" });

    await page.getByTestId("schedule-timezone").selectOption({ label: "Other…" });
    await page.getByTestId("schedule-timezone-other").fill("Africa/Cairo");
    await save(page);
    expect(state.config.timezone).toBe("Africa/Cairo");

    await page.reload();
    await page.locator(node).click();
    await expect(page.getByTestId("schedule-timezone-other")).toHaveValue("Africa/Cairo");
    await page.getByTestId("schedule-timezone").selectOption("UTC");
    await expect(page.getByTestId("schedule-timezone-other")).toHaveCount(0);
    await save(page);
    expect(state.config.timezone).toBe("UTC");
  });

  test("simple crons round-trip and unusual ones open in advanced mode and are saved unchanged", async ({ page }) => {
    const state: { config: Config } = { config: { ...DEFAULT } };
    await openBuilder(page, state);

    const simple: Array<[string, string]> = [
      ["0 0 9 * * *", "daily"],
      ["0 30 8 * * MON-FRI", "weekly"],
      ["0 30 8 * * MON,WED", "weekly"],
      ["0 */15 * * * *", "minutes"],
      ["0 0 */2 * * *", "hours"],
      ["0 0 9 1 * *", "monthly"],
    ];
    for (const [cron, repeat] of simple) {
      state.config = { cron, timezone: "Asia/Ho_Chi_Minh" };
      await page.reload();
      await page.locator(node).click();
      await expect(page.getByTestId("schedule-repeat"), cron).toHaveValue(repeat);
    }
    state.config = { cron: "0 30 8 * * MON,WED", timezone: "Asia/Ho_Chi_Minh" };
    await page.reload();
    await page.locator(node).click();
    await expect(page.getByTestId("schedule-summary")).toHaveText("Runs at 08:30 on Monday, Wednesday (Vietnam time)");

    for (const cron of ["0 15 10 ? * 6L", "0 0 9-17 * * MON-FRI", "0 */7 * * * *"]) {
      state.config = { cron, timezone: "Asia/Ho_Chi_Minh" };
      await page.reload();
      await page.locator(node).click();
      await expect(page.getByTestId("schedule-repeat"), cron).toHaveValue("advanced");
      await expect(page.getByTestId("schedule-cron")).toHaveValue(cron);
      await page.getByTestId("schedule-timezone").selectOption("Europe/London");
      await save(page);
      expect(state.config).toEqual({ cron, timezone: "Europe/London" });
    }
  });

  test("advanced mode edits the raw cron and the picker fits the inspector", async ({ page }) => {
    const state = { config: { ...DEFAULT } };
    await openBuilder(page, state);
    await page.getByTestId("schedule-repeat").selectOption("advanced");
    await expect(page.getByTestId("schedule-cron")).toHaveValue("0 0 9 * * *");
    await page.getByTestId("schedule-cron").fill("0 0 9 * * MON-FRI");
    await expect(page.getByTestId("schedule-repeat")).toHaveValue("advanced");
    await save(page);
    expect(state.config.cron).toBe("0 0 9 * * MON-FRI");

    const fits = () => page.getByTestId("workflow-inspector").evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(await fits()).toBe(true);
    await page.getByTestId("schedule-repeat").selectOption("weekly");
    expect(await fits()).toBe(true);
    const overflow = await page.getByTestId("schedule-config").evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
  });
});
