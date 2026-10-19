import { expect, type Page, type Route } from '@playwright/test';

// Opens the builder in HTTP mode against a stubbed Workflow Service. The saved draft is the former
// mock starter canvas (manual + webhook -> AI extract -> condition -> email), under the same node ids.

export const STUB_WORKSPACE_ID = '00000000-0000-4000-8000-000000000101';
export const STUB_WORKFLOW_ID = '00000000-0000-4000-8000-000000000201';
const USER_ID = '00000000-0000-4000-8000-000000000110';
const base = `**/api/v1/workspaces/${STUB_WORKSPACE_ID}/workflows/${STUB_WORKFLOW_ID}`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const pageOf = (items: unknown[]) => ({ items, page: 0, size: 100, totalElements: items.length, totalPages: 1, hasNext: false });

type StubNode = { id: string; type: string; config: Record<string, unknown>; name: string; position?: { x: number; y: number } };
type StubEdge = { id: string; source: string; target: string; sourcePort?: string };

export const STARTER_NODES: StubNode[] = [
  { id: 'node-manual', type: 'trigger.manual', config: {}, name: 'Manual trigger', position: { x: 80, y: 80 } },
  { id: 'node-webhook', type: 'trigger.webhook', config: {}, name: 'Webhook Trigger', position: { x: 80, y: 300 } },
  { id: 'node-extract', type: 'ai.extract', config: {}, name: 'AI Extract Core', position: { x: 420, y: 180 } },
  { id: 'node-condition', type: 'logic.condition', config: { left: '', operator: 'eq', right: '' }, name: 'High Value Check', position: { x: 760, y: 180 } },
  { id: 'node-notify', type: 'email.send', config: {}, name: 'Notify Priority Queue', position: { x: 1100, y: 180 } },
];
export const STARTER_EDGES: StubEdge[] = [
  { id: 'edge-manual-extract', source: 'node-manual', target: 'node-extract' },
  { id: 'edge-1-2', source: 'node-webhook', target: 'node-extract' },
  { id: 'edge-2-3', source: 'node-extract', target: 'node-condition' },
  { id: 'edge-3-4', source: 'node-condition', target: 'node-notify', sourcePort: 'true' },
];

/** API calls no stub covers: they get a 501 and are recorded; call expectNoUnmatched() in afterEach. */
export const unmatched: string[] = [];
export const resetUnmatched = () => { unmatched.length = 0; };
export const expectNoUnmatched = () => expect(unmatched, 'API calls the stub does not cover').toEqual([]);

/** Answers GET only; every other method falls through to the 501 fallback. */
export const getOnly = (answer: (route: Route) => Promise<void>) => (route: Route) =>
  route.request().method() === 'GET' ? answer(route) : route.fallback();

/** Unknown workflow id: a 404 that is also recorded, so a request to the wrong workflow fails the test. */
export const notFound = (route: Route) => {
  unmatched.push(`${route.request().method()} ${new URL(route.request().url()).pathname} (404)`);
  return json(route, { error: 'not found' }, 404);
};

/** Registers the 501 fallback first (later routes win), so register specific stubs after it. */
export async function registerApiFallback(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    unmatched.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return json(route, { error: 'not stubbed' }, 501);
  });
}

/** Stubs the backend, opens the builder and waits for the draft to load. Returns the drafts the page saved. */
export async function openStubbedBuilder(
  page: Page,
  options: { nodes?: StubNode[]; edges?: StubEdge[]; capabilities?: Record<string, unknown> } = {},
) {
  const nodes = options.nodes ?? STARTER_NODES;
  const edges = options.edges ?? STARTER_EDGES;
  let current: Record<string, unknown> = {
    workflowId: STUB_WORKFLOW_ID,
    name: 'Catalog fixture',
    description: null,
    status: 'DRAFT',
    schemaVersion: '1.0',
    definition: {
      schemaVersion: '1.0',
      nodes: nodes.map(({ id, type, config }) => ({ id, type, config })),
      edges,
      variables: {},
    },
    editorState: {
      nodes: Object.fromEntries(nodes.map((node, index) => [node.id, { name: node.name, position: node.position ?? { x: 80 + (index % 3) * 340, y: 120 + Math.floor(index / 3) * 200 } }])),
    },
    currentVersionId: null,
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T10:00:00Z',
    publishedAt: null,
    triggers: [],
  };
  const savedDrafts: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    localStorage.setItem('weav_token', 'playwright-test-token');
    localStorage.setItem('weav_lang_v1', 'EN');
  });
  await registerApiFallback(page);
  await page.route('**/api/auth/me', getOnly((route) => json(route, { id: USER_ID, email: 'ui@example.test', displayName: 'UI Tester', systemRole: 'USER', status: 'ACTIVE' })));
  await page.route('**/api/v2/notifications**', (route) =>
    route.request().method() === 'GET'
      ? json(route, route.request().url().includes('unread-count') ? { count: 0 } : { items: [], nextCursor: null })
      : route.fallback());
  const workspace = { id: STUB_WORKSPACE_ID, name: 'Weav Test Workspace', role: 'OWNER', createdBy: USER_ID, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
  await page.route('**/api/v1/workspaces?**', getOnly((route) => json(route, pageOf([workspace]))));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}`, getOnly((route) => json(route, workspace)));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}/members**`, (route) => route.request().method() === 'GET' ? json(route, pageOf([])) : route.fallback());
  await page.route((url) => url.pathname === `/api/v1/workspaces/${STUB_WORKSPACE_ID}/connections`, getOnly((route) => json(route, [])));
  await page.route(/\/workflows\?page=/, (route) => json(route, pageOf([])));
  await page.route(`**/api/v1/workspaces/${STUB_WORKSPACE_ID}/workflows/node-capabilities`, getOnly((route) => json(route, { nodes: options.capabilities ?? {} })));
  // Workflow detail: only the fixture id exists; any other id is a 404.
  await page.route((url) => url.pathname.startsWith(`/api/v1/workspaces/${STUB_WORKSPACE_ID}/workflows/`) && !url.pathname.endsWith('/node-capabilities') && !url.pathname.endsWith('/draft') && !url.pathname.endsWith('/publish'), (route) => {
    const id = new URL(route.request().url()).pathname.split('/workflows/')[1];
    return route.request().method() === 'GET' && id === STUB_WORKFLOW_ID ? json(route, current) : route.request().method() === 'GET' ? notFound(route) : route.fallback();
  });
  await page.route(`${base}/draft`, (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    current = { ...current, ...(route.request().postDataJSON() as object) };
    savedDrafts.push(current);
    return json(route, current);
  });
  await page.goto(`/workflows/${STUB_WORKFLOW_ID}/builder`);
  await expect(page.getByTestId('workflow-title')).toHaveValue('Catalog fixture');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  return savedDrafts;
}
