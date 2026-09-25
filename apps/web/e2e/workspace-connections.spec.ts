import { expect, test, type Page, type Route } from "@playwright/test";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const WORKSPACE_B_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_GMAIL_ID = "20000000-0000-4000-8000-000000000001";
const CONNECTION_SHEETS_ID = "20000000-0000-4000-8000-000000000002";
const CONNECTION_TELEGRAM_ID = "20000000-0000-4000-8000-000000000003";
const CONNECTION_HTTP_ID = "20000000-0000-4000-8000-000000000004";
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

function connection(
  id: string,
  provider: "TELEGRAM" | "HTTP" | "GMAIL" | "GOOGLE_SHEETS",
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
  await page.route("**/api/notifications/unread-count", (route) =>
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
    ).toHaveAttribute("href", "/connections");
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
    await expect.poll(() => alphaListCalls).toBeGreaterThan(1);
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
    ).toBe("/connections");
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
      .toBe("/connections");
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
    expect(renameBody).toEqual({ name: "Renamed Gmail" });

    await page.getByTestId(`connection-test-${CONNECTION_GMAIL_ID}`).click();
    await expect(
      page.getByTestId(`connection-action-message-${CONNECTION_GMAIL_ID}`),
    ).toContainText("Google access needs to be renewed");
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "INVALID");

    await page.getByTestId(`connection-disable-${CONNECTION_GMAIL_ID}`).click();
    await expect(
      page.getByTestId(`connection-status-${CONNECTION_GMAIL_ID}`),
    ).toHaveAttribute("data-status", "DISABLED");

    page.on("dialog", (dialog) => dialog.accept());
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
