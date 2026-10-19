import { test, expect, type Page, type Route } from '@playwright/test';

// Shell, workflow list, builder canvas and account surfaces against a stubbed Workflow Service (HTTP mode).

const workspaceId = '00000000-0000-4000-8000-000000000101';
const userId = '00000000-0000-4000-8000-000000000110';
const builderId = '00000000-0000-4000-8000-000000000201';
const wfIds = [builderId, '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000203'];
const wfNames = ['Invoice intake', 'Weekly report', 'Customer sync'];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pageOf = (items: unknown[]) => ({ items, page: 0, size: 100, totalElements: items.length, totalPages: 1, hasNext: false });

// Five steps in a chain: trigger -> http -> AI -> email -> OCR.
const builderNodes = [
  { id: 'manual', type: 'trigger.manual', config: {}, name: 'Manual trigger' },
  { id: 'http_1', type: 'http.request', config: {}, name: 'Fetch invoice' },
  { id: 'ai_1', type: 'ai.extract', config: {}, name: 'AI Extract Core' },
  { id: 'mail', type: 'email.send', config: {}, name: 'Send email' },
  { id: 'ocr_1', type: 'ocr.extract', config: {}, name: 'Read invoice text' },
];

function detail(workflowId: string) {
  const index = wfIds.indexOf(workflowId);
  const status = index === 1 ? 'DRAFT' : 'PUBLISHED';
  const nodes = workflowId === builderId ? builderNodes : builderNodes.slice(0, 2);
  return {
    workflowId,
    name: wfNames[index],
    description: null,
    status,
    schemaVersion: '1.0',
    definition: {
      schemaVersion: '1.0',
      nodes: nodes.map(({ id, type, config }) => ({ id, type, config })),
      edges: nodes.slice(1).map((node, i) => ({ id: `e${i}`, source: nodes[i].id, target: node.id })),
      variables: {},
    },
    editorState: {
      nodes: Object.fromEntries(nodes.map((node, i) => [node.id, { name: node.name, position: { x: 80 + i * 280, y: 160 } }])),
    },
    currentVersionId: null,
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
    publishedAt: status === 'PUBLISHED' ? '2026-10-10T10:00:00Z' : null,
    triggers: [],
  };
}

let unmatched: string[] = [];
test.beforeEach(() => { unmatched = []; });
test.afterEach(() => { expect(unmatched, 'API calls the stub does not cover').toEqual([]); });

async function stubBackend(page: Page, lang: 'EN' | 'VI' = 'EN', ocrSources: string[] = []) {
  const remaining = new Set(wfIds);
  await page.addInitScript(([language]) => {
    localStorage.setItem('weav_lang_v1', language);
    // Sign in once per tab: a test can sign out and the next navigation must not sign it back in.
    if (!sessionStorage.getItem('e2e_signed_in_once')) {
      sessionStorage.setItem('e2e_signed_in_once', '1');
      localStorage.setItem('weav_token', 'playwright-test-token');
    }
  }, [lang]);
  // Fallback first (later routes win): an API call no stub covers fails with 501 and is recorded, and afterEach fails the test.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    unmatched.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return json(route, { error: 'not stubbed' }, 501);
  });
  await page.route('**/api/auth/me', (route) => json(route, { id: userId, email: 'ui@example.test', displayName: 'UI Tester', systemRole: 'USER', status: 'ACTIVE' }));
  const ws = `/api/v1/workspaces/${workspaceId}`;
  const get = (answer: (route: Route) => Promise<void>) => (route: Route) =>
    route.request().method() === 'GET' ? answer(route) : route.fallback();
  await page.route((url) => url.pathname === '/api/v2/notifications/unread-count', get((route) => json(route, { count: 0 })));
  await page.route((url) => url.pathname === '/api/v2/notifications', get((route) => json(route, { items: [], nextCursor: null })));
  const workspace = { id: workspaceId, name: 'Weav Test Workspace', role: 'OWNER', createdBy: userId, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.route('**/api/v1/workspaces?**', (route) => json(route, pageOf([workspace])));
  await page.route(`**/api/v1/workspaces/${workspaceId}`, (route) => json(route, workspace));
  await page.route(`**/api/v1/workspaces/${workspaceId}/monitoring/summary**`, (route) => json(route, {
    days: 7,
    from: '2026-10-11T00:00:00Z',
    to: '2026-10-18T00:00:00Z',
    workflows: { published: 2, paused: 0, draft: 1 },
    runs: { total: 0, today: 0, success: 0, failed: 0, active: 0 },
    successRate: null,
    averageDurationMs: null,
    p95DurationMs: null,
    trend: [],
    topFailingWorkflows: [],
    recentFailures: [],
  }));
  await page.route((url) => url.pathname === `/api/v1/workspaces/${workspaceId}/executions`, (route) =>
    json(route, { items: [], page: 0, size: 6, totalElements: 0, hasNext: false }));
  await page.route((url) => url.pathname === '/api/auth/sessions', get((route) => json(route, pageOf([]))));
  await page.route((url) => url.pathname === '/api/v1/invitations', get((route) => json(route, pageOf([]))));
  await page.route((url) => url.pathname === `${ws}/members`, get((route) => json(route, pageOf([]))));
  await page.route((url) => url.pathname === `${ws}/connections`, get((route) => json(route, [])));
  await page.route((url) => /\/workflows\/[^/]+\/executions$/.test(url.pathname) && url.pathname.startsWith(ws), get((route) =>
    json(route, { items: [], page: 0, size: 20, totalElements: 0, hasNext: false })));
  // Workflow list (GET) and one workflow (GET detail, DELETE); sub-paths such as /draft or /publish stay unstubbed.
  await page.route((url) => url.pathname === `${ws}/workflows`, get((route) => {
    return json(route, pageOf(wfIds.filter((wf) => remaining.has(wf)).map((wf) => {
      const { workflowId, name, status, schemaVersion, currentVersionId, createdAt, updatedAt, publishedAt } = detail(wf);
      return { workflowId, name, status, schemaVersion, currentVersionId, createdAt, updatedAt, publishedAt };
    })));
  }));
  await page.route((url) => url.pathname.startsWith(`${ws}/workflows/`) && url.pathname.split('/').length === ws.split('/').length + 2, (route) => {
    const id = new URL(route.request().url()).pathname.split('/workflows/')[1];
    const method = route.request().method();
    if (method === 'DELETE') {
      remaining.delete(id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (method !== 'GET') return route.fallback();
    return wfIds.includes(id) ? json(route, detail(id)) : json(route, { error: 'not found' }, 404);
  });
  // Workflow Service capabilities: OCR is only usable when it lists at least one enabled source.
  await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/node-capabilities`, (route) =>
    json(route, { nodes: ocrSources.length ? { 'ocr.extract': { available: true, sources: ocrSources } } : {} }));
}

async function clickEmptyWorkflowCanvas(page: Page) {
  const point = await page.evaluate(() => {
    type CanvasBounds = { left: number; top: number; width: number; height: number };
    type CanvasPane = { getBoundingClientRect: () => CanvasBounds };
    const browserDocument = (globalThis as unknown as {
      document: {
        querySelector: (selector: string) => CanvasPane | null;
        elementFromPoint: (x: number, y: number) => unknown;
      };
    }).document;
    const pane = browserDocument.querySelector('.react-flow__pane');
    const bounds = pane?.getBoundingClientRect();
    if (!pane || !bounds) return null;

    const candidates = [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.05, 0.95],
      [0.95, 0.95],
      [0.5, 0.95],
      [0.05, 0.5],
      [0.95, 0.5],
      [0.5, 0.05],
      [0.25, 0.75],
      [0.75, 0.75],
    ];

    for (const [xRatio, yRatio] of candidates) {
      const x = bounds.left + bounds.width * xRatio;
      const y = bounds.top + bounds.height * yRatio;
      if (browserDocument.elementFromPoint(x, y) === pane) {
        return { x: bounds.width * xRatio, y: bounds.height * yRatio };
      }
    }
    return null;
  });

  if (!point) throw new Error('No unobstructed empty point found on the workflow canvas');
  await page.locator('.react-flow__pane').click({ position: point });
}

test.describe('workflow shell', () => {
  test('uses the WEAV mark in the shell and auth brand, and the SVG favicon', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/dashboard');
    await expect(page.getByTestId('app-sidebar').locator('svg path[d="M6 9l4 11 4-8 4 8 4-11"]')).toBeAttached();
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');

    // The auth layout shows the same W tile next to the brand name.
    await page.evaluate(() => localStorage.removeItem('weav_token'));
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('app-sidebar')).toHaveCount(0);
    await expect(page.getByText('Weav', { exact: true }).first()).toBeVisible();
    await expect(page.locator('svg path[d="M6 9l4 11 4-8 4 8 4-11"]').first()).toBeAttached();
  });

  test('shows readable navigation and moves the active indicator to Workflows', async ({ page }) => {
    await stubBackend(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/workflows');

    const sidebar = page.getByTestId('app-sidebar');
    const workflowsLink = sidebar.getByRole('link', { name: 'Workflows', exact: true });

    await expect(sidebar).toBeVisible();
    await expect(workflowsLink).toHaveAttribute('aria-current', 'page');
    await expect(workflowsLink).toHaveCSS('font-size', '14px');
    await expect(workflowsLink.getByTestId('active-nav-indicator')).toBeVisible();

    const sidebarLightness = await sidebar.evaluate((element) => {
      const el = element as unknown as {
        ownerDocument: { defaultView: { getComputedStyle: (e: unknown) => { backgroundColor: string } } };
      };
      const [red, green, blue] = el.ownerDocument.defaultView
        .getComputedStyle(el)
        .backgroundColor.match(/\d+/g)!
        .slice(0, 3)
        .map(Number);
      return (red + green + blue) / (255 * 3);
    });
    expect(sidebarLightness).toBeGreaterThan(0.75);
  });
});

test.describe('dark sidebar palette', () => {
  test('keeps the support footer on the same surface as the sidebar in dark mode', async ({ page }) => {
    await stubBackend(page);
    await page.addInitScript(() => localStorage.setItem('weav_theme_v1', 'dark'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveClass(/dark/);

    const sidebar = page.getByTestId('app-sidebar');
    const footer = sidebar.getByTestId('sidebar-footer');
    await expect(footer).toBeVisible();
    // The footer has no fill of its own, so it shows the sidebar's token background.
    await expect(footer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const sidebarBackground = await sidebar.evaluate((element) => {
      const el = element as unknown as { ownerDocument: { defaultView: { getComputedStyle: (e: unknown) => { backgroundColor: string } } } };
      return el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor;
    });
    expect(sidebarBackground).not.toBe('rgba(0, 0, 0, 0)');
    const [red, green, blue] = sidebarBackground.match(/\d+/g)!.slice(0, 3).map(Number);
    expect((red + green + blue) / (255 * 3)).toBeLessThan(0.35);
  });
});

test.describe('topbar breadcrumbs', () => {
  test('tracks the active route in the current page breadcrumb', async ({ page }) => {
    await stubBackend(page);

    await page.goto('/executions');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Executions');

    await page.goto('/workflows');
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Workflows');
  });
});

test.describe('dashboard quick actions', () => {
  test('surfaces the three ways to start a workflow on the overview', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toBeVisible();
    await expect(quickActions.getByRole('heading', { name: 'Quick start' })).toBeVisible();
    await expect(quickActions.getByRole('link', { name: /Start from scratch/ })).toHaveAttribute('href', '/workflows/new');
    await expect(quickActions.getByRole('link', { name: /Use a ready-made template/ })).toBeVisible();
    await expect(quickActions.getByRole('button', { name: /Describe it/ })).toBeVisible();
  });

  test('opens the existing AI creation flow from quick actions', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/dashboard');

    await page.getByTestId('dashboard-quick-actions').getByRole('button', { name: /Describe it/ }).click();
    await expect(page.getByTestId('ai-generator-dialog')).toBeVisible();
    await expect(page.getByTestId('ai-generator-dialog').getByText('Create with AI', { exact: true }).first()).toBeVisible();
  });

  test('keeps OCR available in Builder instead of Dashboard quick actions', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/dashboard');

    const quickActions = page.getByTestId('dashboard-quick-actions');
    await expect(quickActions).toBeVisible();
    await expect(quickActions.getByTestId('dashboard-ocr-action')).toHaveCount(0);
    await expect(quickActions).not.toContainText(/OCR/i);
  });
});

test.describe('language switching', () => {
  test('translates the dashboard shell and quick actions between Vietnamese and English', async ({ page }) => {
    await stubBackend(page, 'VI');
    await page.goto('/dashboard');

    const nav = page.getByTestId('app-sidebar');
    await expect(nav.getByRole('link', { name: 'Tổng quan', exact: true })).toBeVisible();
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Tổng quan');
    await expect(page.getByTestId('dashboard-quick-actions').getByRole('heading', { name: 'Bắt đầu nhanh' })).toBeVisible();
    await page.getByRole('button', { name: 'Chuyển sang tiếng Anh', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Dashboard');
    await expect(page.getByTestId('dashboard-quick-actions').getByRole('heading', { name: 'Quick start' })).toBeVisible();

    await page.getByRole('button', { name: 'Switch to Vietnamese', exact: true }).click();
    await expect(page.getByTestId('topbar-breadcrumb-current')).toHaveText('Tổng quan');
    await expect(page.getByTestId('dashboard-quick-actions').getByRole('button', { name: /Mô tả bằng lời/ })).toBeVisible();
  });
});

test.describe('workflow operations list', () => {
  test('filters rows without losing operational context', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await page.getByTestId('workflow-search').fill('Invoice');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Invoice intake');
    await expect(rows.first().getByTestId('workflow-summary')).toBeVisible();
  });

  test('opens row actions with an accessible trigger', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/workflows');
    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await rows.first().getByRole('button', { name: /^More workflow actions/ }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('keeps the row menu of the last row inside a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await stubBackend(page);
    await page.goto('/workflows');
    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    const trigger = rows.last().getByRole('button', { name: /^More workflow actions/ });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  });
});

test.describe('bulk workflow actions', () => {
  test('turns row selection into a confirmable delete action', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByRole('checkbox', { name: /Select / }).check();
    await rows.nth(1).getByRole('checkbox', { name: /Select / }).check();

    const bulkActions = page.getByTestId('workflow-bulk-actions');
    await expect(bulkActions).toContainText('2 workflows selected');
    await bulkActions.getByRole('button', { name: 'Delete selected workflows' }).click();
    await expect(page.getByText('Delete selected workflows?', { exact: true })).toBeVisible();

    await page.getByRole('alertdialog').getByRole('textbox').fill('delete 2');
    await page.getByRole('button', { name: 'Delete workflows', exact: true }).click();
    await expect(bulkActions).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('workflow-row')).toHaveCount(1);
  });
});

test.describe('workflow responsive layout', () => {
  test('keeps the workflow filter toolbar inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubBackend(page, 'VI');
    await page.goto('/workflows');

    await expect(page.getByTestId('workflow-row')).toHaveCount(3);
    const toolbar = page.getByTestId('workflow-search').locator('xpath=ancestor::div[contains(@class, "flex-wrap")][1]');
    await expect(toolbar).toBeVisible();

    const dimensions = await toolbar.evaluate((element) => {
      const htmlElement = element as unknown as { clientWidth: number; scrollWidth: number };
      return {
        clientWidth: htmlElement.clientWidth,
        scrollWidth: htmlElement.scrollWidth,
      };
    });

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test('keeps selected workflow actions within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubBackend(page, 'VI');
    await page.goto('/workflows');

    const rows = page.getByTestId('workflow-row');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).getByRole('checkbox', { name: /^Chọn / }).check();
    await rows.nth(1).getByRole('checkbox', { name: /^Chọn / }).check();
    await expect(page.getByTestId('workflow-bulk-actions')).toBeVisible();

    const dimensions = await page.evaluate(() => {
      const globalObj = globalThis as unknown as {
        document: { documentElement: { clientWidth: number; scrollWidth: number } };
      };
      return {
        clientWidth: globalObj.document.documentElement.clientWidth,
        scrollWidth: globalObj.document.documentElement.scrollWidth,
      };
    });

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await expect(page.locator('main')).toHaveCSS('min-width', '0px');
    await expect(page.locator('main')).toHaveCSS('overflow-x', 'hidden');
  });
});

test.describe('workflow builder execution motion', () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
  });

  const aiNode = (page: Page) => page.getByTestId('workflow-node').filter({ hasText: 'AI Extract Core' });
  const ocrNode = (page: Page) => page.getByTestId('workflow-node').filter({ hasText: 'Read invoice text' });
  const openBuilder = async (page: Page) => {
    await page.goto(`/workflows/${builderId}/builder`);
    await expect(aiNode(page)).toBeVisible();
  };

  test('keeps the minimap contained and the selected workflow visible', async ({ page }) => {
    await openBuilder(page);

    const minimap = page.locator('.react-flow__minimap');
    await expect(minimap).toBeVisible();
    const minimapBox = await minimap.boundingBox();
    expect(minimapBox).not.toBeNull();
    expect(minimapBox?.width).toBeGreaterThan(150);
    expect(minimapBox?.height).toBeGreaterThan(90);

    // The viewport window is stroked with the --border-strong token; resolve the token to a computed colour.
    const mask = minimap.locator('.react-flow__minimap-mask');
    await expect(mask).toBeVisible();
    const tokenColour = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { createElement: (t: string) => { style: { color: string } }; body: { appendChild: (e: unknown) => void; removeChild: (e: unknown) => void } }; getComputedStyle: (e: unknown) => { color: string } });
      const probe = doc.document.createElement('span');
      probe.style.color = 'var(--border-strong)';
      doc.document.body.appendChild(probe);
      const colour = doc.getComputedStyle(probe).color;
      doc.document.body.removeChild(probe);
      return colour;
    });
    expect(tokenColour).toMatch(/^rgb/);
    await expect(mask).toHaveCSS('stroke', tokenColour);
  });

  test('keeps the visual preview separate from workflow execution', async ({ page }) => {
    await openBuilder(page);
    const previewButton = page.getByRole('button', { name: 'Preview workflow (visual only)' }).first();
    await expect(previewButton).toBeVisible();

    await expect(aiNode(page)).toHaveAttribute('data-status', 'idle');
    // No OCR source is enabled in the capabilities, so the OCR step is still marked unavailable.
    await expect(ocrNode(page)).toHaveAttribute('data-readiness', 'unavailable');
    await previewButton.click();
    await expect(page.getByTestId('workflow-preview-notice')).toContainText('no workflow or provider calls');
    await expect(page.getByTestId('execution-edge-active')).toBeVisible();
    await expect(aiNode(page)).toHaveAttribute('data-status', 'idle');
    await expect(page.getByTestId('workflow-telemetry-preview-notice'))
      .toContainText('does not call the Workflow Service or node integrations');
    await expect(ocrNode(page)).toHaveAttribute('data-readiness', 'unavailable');
    await expect(page.getByText(/Workflow finished successfully|Resolved 4 schema parameters/)).toHaveCount(0);
  });

  test('stops marking the OCR step unavailable once the Workflow Service enables a source', async ({ page }) => {
    await stubBackend(page, 'EN', ['file']);
    await openBuilder(page);
    await expect(ocrNode(page)).toHaveAttribute('data-readiness', 'not-configured');
  });

  test('shows an active connection while previewing an edge', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBuilder(page);
    await expect(page.getByTestId('execution-edge-flow')).toHaveCount(4);
    await page.getByRole('button', { name: 'Preview workflow (visual only)' }).first().click();

    const activeEdge = page.getByTestId('execution-edge-active');
    await expect(activeEdge).toBeVisible();
    await expect(activeEdge.locator('animateMotion')).toHaveAttribute('repeatCount', 'indefinite');
  });

  test('shows a subtle flow preview before an execution starts', async ({ page }) => {
    await openBuilder(page);

    const flowPreview = page.getByTestId('execution-edge-flow');
    await expect(flowPreview).toHaveCount(4);
    await expect(flowPreview.first().locator('animate')).toHaveAttribute('repeatCount', 'indefinite');
  });

  test('opens the inspector on node click and dismisses it outside the panel', async ({ page }) => {
    await openBuilder(page);

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toHaveCount(0);

    await aiNode(page).click();
    await expect(inspector).toBeVisible();

    await clickEmptyWorkflowCanvas(page);
    await expect(inspector).toHaveCount(0);
  });

  test('keeps canvas geometry stable while the inspector opens and closes', async ({ page }) => {
    await openBuilder(page);

    const canvas = page.getByTestId('workflow-canvas');
    const before = await canvas.boundingBox();
    await aiNode(page).click();
    await expect(page.getByTestId('workflow-inspector')).toBeVisible();
    const open = await canvas.boundingBox();

    expect(open?.x).toBe(before?.x);
    expect(open?.width).toBe(before?.width);

    await clickEmptyWorkflowCanvas(page);
    await expect(page.getByTestId('workflow-inspector')).toHaveCount(0);
    const after = await canvas.boundingBox();
    expect(after?.width).toBe(before?.width);
  });

  test('keeps the builder mounted after deleting three nodes', async ({ page }) => {
    await openBuilder(page);

    const canvas = page.getByTestId('workflow-canvas');
    const nodes = page.getByTestId('workflow-node');
    const inspector = page.getByTestId('workflow-inspector');
    await expect(nodes).toHaveCount(5);

    await nodes.nth(1).click();
    await expect(inspector).toBeVisible();

    await page.keyboard.press('Backspace');
    await expect(nodes).toHaveCount(4);
    await expect(inspector).toHaveCount(0);
    await expect(canvas).toBeVisible();

    for (const expectedCount of [3, 2]) {
      await nodes.first().click();
      await page.keyboard.press('Backspace');
      await expect(nodes).toHaveCount(expectedCount);
      await expect(inspector).toHaveCount(0);
      await expect(canvas).toBeVisible();
    }
  });

  test('keeps preview truthful when reduced motion is enabled', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBuilder(page);
    await page.getByRole('button', { name: 'Preview workflow (visual only)' }).first().click();

    await expect(aiNode(page)).toHaveAttribute('data-status', 'idle');
    await expect(page.getByTestId('execution-edge-active')).toHaveCount(0);
    await expect(page.getByTestId('workflow-telemetry-preview-notice'))
      .toContainText('does not call the Workflow Service or node integrations');
  });
});

test.describe('OCR workflow node', () => {
  test('adds OCR to the canvas and previews extracted document text', async ({ page }) => {
    await stubBackend(page, 'EN', ['file']);
    await page.route(`**/api/v1/workspaces/${workspaceId}/ocr/extractions`, (route) => json(route, {
      schemaVersion: '1.0',
      requestId: 'eeb24fb2-df80-4dcb-b22d-3a4884799c73',
      document: {
        fileName: 'invoice.png',
        mimeType: 'image/png',
        pages: 2,
        pageInfo: [{ page: 1, width: 1200, height: 1600, dpi: null }],
      },
      text: { rawText: 'INVOICE INV-2026-0042\nVendor: Công ty TNHH Minh Long\nTotal: 15,000,000 VND' },
      confidence: 0.984,
      blocks: [],
      tables: [],
      metadata: { language: 'vi+en', processingTimeMs: 850, engine: 'paddleocr', quality: 'OK', warnings: [] },
    }));
    // Hold the workflow load so the loading state is observable (later route wins over the stub's).
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/v1/workspaces/${workspaceId}/workflows/${builderId}`, async (route) => {
      await gate;
      await route.fallback();
    });
    await page.goto(`/workflows/${builderId}/builder`);
    await expect(page.getByText('Loading workflow…', { exact: true })).toBeVisible();

    const addStep = page.getByTestId('workflow-add-step');
    await expect(addStep).toBeDisabled();
    release();
    await expect(page.getByText('Loading workflow…', { exact: true })).toBeHidden();
    await expect(addStep).toBeEnabled();
    await addStep.click();
    const ocrPaletteItem = page.getByRole('button', { name: 'Read text from a file' });
    await expect(ocrPaletteItem).toBeEnabled();
    await ocrPaletteItem.click();

    const inspector = page.getByTestId('workflow-inspector');
    await expect(inspector).toContainText('Read text from a file');
    // Trying OCR on a sample file sits in a collapsed "try" section; the input itself is visually hidden behind its label.
    await inspector.getByTestId('ocr-try').locator('summary').click();
    await expect(inspector.getByTestId('ocr-try').getByText('Choose image or PDF', { exact: true })).toBeVisible();
    const fileInput = inspector.getByTestId('ocr-file-input');
    await expect(fileInput).toBeAttached();
    await fileInput.setInputFiles({
      name: 'invoice.png',
      mimeType: 'image/png',
      buffer: Buffer.from('mock invoice image'),
    });
    await expect(inspector.getByText('invoice.png', { exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Extract text' }).click();

    const result = inspector.getByTestId('ocr-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Detected text');
    await expect(result).toContainText('98.4%');
  });
});

test.describe('workspace account surfaces', () => {
  test('keeps workspace, profile settings, and help surfaces discoverable', async ({ page }) => {
    await stubBackend(page, 'VI');
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-page')).toBeVisible();
    await expect(page.getByTestId('workspace-selected-name')).toContainText('Weav Test Workspace');

    await page.goto('/workspace/members');
    await expect(page.getByTestId('workspace-selected-heading')).toHaveText('Weav Test Workspace');
    await expect(page.getByRole('button', { name: 'Thêm thành viên', exact: true })).toBeVisible();

    await page.goto('/settings/profile');
    await expect(page.getByTestId('settings-profile-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(Cài đặt|Settings)$/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();

    await page.goto('/help');
    await expect(page.getByTestId('help-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^(Trợ giúp & Tài liệu|Help & Docs)$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bắt đầu nhanh', exact: true })).toBeVisible();
  });
});

test.describe('AI workflow generator focus', () => {
  test('keeps the first action focused on one prompt and one primary action', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/ai/workflow-generator');

    await expect(page.getByTestId('ai-generator-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create with AI', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What should this workflow do?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate workflow', exact: true })).toBeVisible();
    await expect(page.getByText('Natural Language to Pipeline AST', { exact: true })).toHaveCount(0);
    await expect(page.getByText('5 steps ready', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('ai-generator-preview')).toHaveCount(0);
  });

  test('enables generation only once a prompt is entered', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/ai/workflow-generator');
    await expect(page.getByRole('button', { name: 'Generate workflow', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'What should this workflow do?' }).fill('Ping a site every hour');
    await expect(page.getByRole('button', { name: 'Generate workflow', exact: true })).toBeEnabled();
  });
});
