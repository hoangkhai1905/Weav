const { spawnSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const {
  sanitizeTask10Error,
  sanitizeTask10Path,
  formatTask10HttpSummary,
  formatTask10HttpFailure,
  formatTask10ConsoleFailure,
} = require('./task10-error-sanitizer.cjs');

const API_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;
const LIVE_TIMEOUT_MS = 90_000;
const observedHttp = new Set();
const observedFailures = new Set();
const runtimeEvidenceByPage = new WeakMap();

function apiPath(path) {
  return sanitizeTask10Path(path);
}

function recordHttp(method, path, status) {
  observedHttp.add(formatTask10HttpSummary({ method, url: path, status }));
}

function attachSanitizedRuntimeEvidence(page, label) {
  const runtimeEvidence = { label, phase: 'login' };
  runtimeEvidenceByPage.set(page, runtimeEvidence);
  page.on('response', (response) => {
    try {
      const url = new URL(response.url());
      const path = sanitizeTask10Path(response.url());
      if (url.pathname.startsWith('/api/')) {
        recordHttp(response.request().method(), path, response.status());
      }
      if (response.status() >= 400) {
        observedFailures.add(formatTask10HttpFailure({
          label: runtimeEvidence.label,
          phase: runtimeEvidence.phase,
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
        }));
      }
    } catch {
      observedFailures.add(`${runtimeEvidence.label} phase=${runtimeEvidence.phase} invalid-response-url`);
    }
  });
  page.on('requestfailed', (request) => {
    try {
      const url = new URL(request.url());
      const path = sanitizeTask10Path(request.url());
      const configuredGatewayOrigin = process.env.WEAV_TASK10_GATEWAY_URL
        ? new URL(process.env.WEAV_TASK10_GATEWAY_URL).origin
        : '';
      const originKind = url.pathname.startsWith('/api/')
        ? (url.origin === configuredGatewayOrigin ? 'gateway-origin' : 'unexpected-origin')
        : 'static-origin';
      const errorText = request.failure()?.errorText || '';
      const errorCode = /^(?:net::ERR_[A-Z_]+|NS_ERROR_[A-Z_]+)$/.exec(errorText)?.[0] || 'unknown';
      observedFailures.add(
        `${runtimeEvidence.label} phase=${runtimeEvidence.phase} request-failed ${request.method()} ${path} ${originKind}:${errorCode}`,
      );
    } catch {
      observedFailures.add(`${runtimeEvidence.label} phase=${runtimeEvidence.phase} network-failure`);
    }
  });
  page.on('pageerror', (error) => observedFailures.add(
    `${runtimeEvidence.label} phase=${runtimeEvidence.phase} pageerror:${sanitizeTask10Error(error)}`,
  ));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      observedFailures.add(formatTask10ConsoleFailure({
        label: runtimeEvidence.label,
        phase: runtimeEvidence.phase,
        locationUrl: message.location()?.url,
        message: message.text(),
      }));
    }
  });
}

function dockerCompose(args) {
  const docker = process.env.WEAV_TASK10_DOCKER_CLI || 'docker';
  const project = process.env.WEAV_TASK10_PROJECT_NAME;
  const composeFile = process.env.WEAV_TASK10_COMPOSE_FILE;
  const result = spawnSync(docker, [
    'compose', '--project-name', project,
    '--env-file', process.env.WEAV_TASK10_COMPOSE_ENV_FILE,
    '--file', composeFile, ...args,
  ], {
    cwd: process.env.WEAV_TASK10_REPO_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Task10 disposable Compose action failed (${args[0] || 'compose'}; exit ${result.status ?? 'unknown'}).`);
  }
}

function readOwnedDatabase(service, database, sql) {
  const docker = process.env.WEAV_TASK10_DOCKER_CLI || 'docker';
  const result = spawnSync(docker, [
    'compose', '--project-name', process.env.WEAV_TASK10_PROJECT_NAME,
    '--env-file', process.env.WEAV_TASK10_COMPOSE_ENV_FILE,
    '--file', process.env.WEAV_TASK10_COMPOSE_FILE,
    'exec', '-T', service,
    'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'task10_runtime', '-d', database, '-c', sql,
  ], {
    cwd: process.env.WEAV_TASK10_REPO_ROOT,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Task10 read-only probe failed for the disposable ${database} database (exit ${result.status ?? 'unknown'}).`);
  }
  try {
    return JSON.parse(result.stdout.trim() || '[]');
  } catch {
    throw new Error(`Task10 read-only probe returned invalid JSON for the disposable ${database} database.`);
  }
}

const outboxSql = (schema) => `
  SELECT COALESCE(json_agg(json_build_object(
    'eventId', event_id::text,
    'eventType', event_type,
    'payload', payload,
    'publishedAt', published_at,
    'attempts', attempts
  ) ORDER BY created_at, event_id), '[]'::json)::text
  FROM ${schema}.notification_outbox`;

function readProducerOutbox() {
  const identity = readOwnedDatabase('identity-db', 'task10_identity', outboxSql('identity'));
  const workspace = readOwnedDatabase('workspace-db', 'task10_workspace', outboxSql('workspace'));
  const workflow = readOwnedDatabase('workflow-db', 'task10_workflow', `
    SELECT COALESCE(json_agg(json_build_object(
      'eventId', event_id::text,
      'eventType', event_type,
      'payload', payload,
      'publishedAt', published_at,
      'attempts', retry_count,
      'retryCount', retry_count,
      'status', status
    ) ORDER BY sequence_id), '[]'::json)::text
    FROM workflow.notification_outbox`);
  return [...identity, ...workspace, ...workflow];
}

function readInboxAudit() {
  return readOwnedDatabase('notification-db', 'task10_notification', `
    SELECT COALESCE(json_agg(json_build_object(
      'sourceEventId', i.source_event_id::text,
      'userId', i.user_id::text,
      'eventType', i.event_type,
      'inboxId', i.id::text,
      'readAt', i.read_at,
      'deliveryCount', (
        SELECT count(*) FROM notification.notification_deliveries d WHERE d.inbox_id = i.id
      )
    ) ORDER BY i.created_at, i.id), '[]'::json)::text
    FROM notification.notification_inbox i`);
}

async function callApi(api, method, path, token, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const response = await api.fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { data: body }),
    timeout: API_TIMEOUT_MS,
  });
  recordHttp(method, path, response.status());
  return response;
}

async function expectApiStatus(api, method, path, token, body, expectedStatus) {
  const response = await callApi(api, method, path, token, body);
  expect(response.status(), `Task10 API ${method} ${apiPath(path)}`).toBe(expectedStatus);
  return response;
}

async function jsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('Task10 disposable service returned an invalid JSON response.');
  }
}

async function registerAndLogin(api, displayName) {
  const suffix = randomUUID().replaceAll('-', '');
  const email = `task10-${suffix}@example.invalid`;
  const password = `Task10!${randomBytes(18).toString('hex')}aA1`;
  const registeredResponse = await expectApiStatus(api, 'POST', '/api/auth/register', null, {
    email,
    password,
    displayName,
  }, 201);
  const registered = await jsonResponse(registeredResponse);
  const userId = registered.id || registered.user?.id;
  expect(typeof userId).toBe('string');

  const login = async (loginPassword) => {
    const response = await expectApiStatus(api, 'POST', '/api/auth/login', null, {
      email,
      password: loginPassword,
    }, 200);
    const body = await jsonResponse(response);
    expect(typeof body.accessToken).toBe('string');
    return body.accessToken;
  };

  return { email, password, userId, login };
}

async function readInbox(api, token, locale = 'vi') {
  const response = await expectApiStatus(
    api, 'GET', `/api/v2/notifications?limit=100&locale=${locale}`, token, undefined, 200,
  );
  const body = await jsonResponse(response);
  expect(Array.isArray(body.items)).toBe(true);
  return body.items;
}

async function readUnreadCount(api, token) {
  const response = await expectApiStatus(
    api, 'GET', '/api/v2/notifications/unread-count', token, undefined, 200,
  );
  return (await jsonResponse(response)).count;
}

async function waitUntil(label, predicate, timeoutMs = LIVE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Task10 bounded wait expired: ${label}.`);
}

async function waitForOutbox(predicate, label) {
  return waitUntil(label, () => readProducerOutbox().find(predicate));
}

async function waitForInboxRows(eventIds) {
  return waitUntil('producer event rows persisted in the Notification inbox', () => {
    const rows = readInboxAudit();
    const selected = rows.filter((row) => eventIds.includes(row.sourceEventId));
    return selected.length >= eventIds.length ? selected : null;
  });
}

async function waitForExecution(api, token, path) {
  return waitUntil('manual Workflow execution reaches a terminal state', async () => {
    const response = await callApi(api, 'GET', path, token);
    if (response.status() !== 200) return null;
    const body = await jsonResponse(response);
    return ['SUCCESS', 'FAILED', 'CANCELLED'].includes(body.status) ? body : null;
  });
}

function assertOutboxRecipients(events, expected) {
  expect(events.length).toBeGreaterThan(0);
  expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
  for (const event of events) {
    expect(event.payload).toBeTruthy();
    expect(event.payload.eventId).toBe(event.eventId);
    expect(event.payload.eventType).toBe(event.eventType);
    expect(event.payload.recipientUserIds).toEqual(expected);
  }
}

async function uiLogin(page, email, password, mobile = false) {
  attachSanitizedRuntimeEvidence(page, mobile ? 'expoweb' : 'web');
  await page.goto(mobile ? `${process.env.WEAV_TASK10_MOBILE_URL}/login` : '/login');
  if (mobile) {
    await page.getByPlaceholder('name@company.com').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByText(/^(Sign In to WEAV|Đăng nhập vào WEAV)$/i).click();
  } else {
    await page.getByLabel(/email/i).fill(email);
    try {
      await page.getByLabel(/password|mật khẩu/i).fill(password);
    } catch (error) {
      const visibleInputTypes = await page.locator('input:visible')
        .evaluateAll((inputs) => inputs.map((input) => input.getAttribute('type') || 'text'))
        .catch(() => []);
      const pagePath = new URL(page.url()).pathname;
      throw new Error(
        `Task10 UI login password-field action failed on ${pagePath} `
        + `(visible input types: ${visibleInputTypes.join(',') || 'none'}; ${error.name || 'Error'}).`,
      );
    }
    await page.getByRole('button', { name: /sign in|đăng nhập/i }).click();
  }
  if (mobile) {
    await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/, { timeout: 15_000 });
  } else {
    await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/, { timeout: 15_000 });
  }
}

async function setUiLocale(page, target, mobile = false, settingsNotificationId) {
  if (mobile) {
    expect(typeof settingsNotificationId).toBe('string');
    const notification = page.getByTestId(`notification-item-${settingsNotificationId}`);
    await expect(notification).toBeVisible();
    await notification.getByTestId(`notification-open-${settingsNotificationId}`).click();
    await expect(page).toHaveURL(/\/settings(?:[?#]|$)/);

    const currentLabel = target === 'en' ? '🇻🇳 VI' : '🇬🇧 EN';
    const nextLabel = target === 'en' ? '🇬🇧 EN' : '🇻🇳 VI';
    await page.getByText(currentLabel, { exact: true }).click();
    await expect(page.getByText(nextLabel, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/notifications(?:[?#]|$)/);
    await expect(page.getByText(
      target === 'en' ? 'Notifications & Alerts' : 'Thông báo & Cảnh báo',
      { exact: true },
    )).toBeVisible();
    return;
  }

  const currentLabel = target === 'en' ? /Chuyển sang tiếng Anh/ : /Switch to Vietnamese/;
  const nextLabel = target === 'en' ? /Switch to Vietnamese/ : /Chuyển sang tiếng Anh/;
  await page.getByRole('button', { name: currentLabel }).click();
  await expect(page.getByRole('button', { name: nextLabel })).toHaveText(target === 'en' ? 'EN' : 'VI', {
    timeout: 10_000,
  });
}

test('Task10 real Identity sessions carry producer events through Gateway to shared web and Expo Web inboxes', async ({ browser, playwright }) => {
  const api = await playwright.request.newContext({ baseURL: process.env.WEAV_TASK10_GATEWAY_URL });
  const browserContexts = [];
  let runTag = `Task10 ${randomUUID().slice(0, 8)}`;

  try {
    const owner = await registerAndLogin(api, 'Task10 Inbox Owner');
    const member = await registerAndLogin(api, 'Task10 Removed Member');
    let ownerToken = await owner.login(owner.password);
    // A successful lifecycle mutation must actually update the password; logging in with the generated replacement
    // yields a fresh Identity-issued access token after the original session has been revoked.
    const newPassword = `Task10!${randomBytes(18).toString('hex')}bB2`;
    const changedPasswordResponse = await expectApiStatus(api, 'POST', '/api/auth/change-password', ownerToken, {
      currentPassword: owner.password,
      newPassword,
    }, 204);
    expect(changedPasswordResponse.status()).toBe(204);
    owner.password = newPassword;
    ownerToken = await owner.login(owner.password);
    const ownerMe = await jsonResponse(await expectApiStatus(api, 'GET', '/api/auth/me', ownerToken, undefined, 200));
    expect(ownerMe.id || ownerMe.user?.id).toBe(owner.userId);

    const identityEvent = await waitForOutbox(
      (event) => event.eventType === 'identity.password_changed'
        && event.payload?.entity?.id === owner.userId && Boolean(event.publishedAt),
      'published Identity password-change outbox event',
    );
    expect(identityEvent.publishedAt).toBeTruthy();
    // A rejected same-password update is not used as event evidence; only the successful change should emit one.
    expect(readProducerOutbox().filter((event) => event.eventType === 'identity.password_changed')).toHaveLength(1);

    const createdWorkspaceResponse = await expectApiStatus(api, 'POST', '/api/v1/workspaces', ownerToken, {
      name: `${runTag} & <plain-text>`,
    }, 201);
    const workspace = await jsonResponse(createdWorkspaceResponse);
    expect(typeof workspace.id).toBe('string');
    const workspaceName = workspace.name;
    const workspaceCreated = await waitForOutbox(
      (event) => event.eventType === 'workspace.created'
        && event.payload?.data?.workspaceName === workspaceName && Boolean(event.publishedAt),
      'published Workspace creation outbox event',
    );
    expect(workspaceCreated.publishedAt).toBeTruthy();

    await expectApiStatus(api, 'POST', `/api/v1/workspaces/${workspace.id}/members`, ownerToken, {
      email: member.email,
    }, 201);
    await waitForOutbox(
      (event) => event.eventType === 'workspace.member_added'
        && event.payload?.workspaceId === workspace.id && Boolean(event.publishedAt),
      'published Workspace member-added outbox event',
    );
    await expectApiStatus(
      api, 'DELETE', `/api/v1/workspaces/${workspace.id}/members/${member.userId}`, ownerToken, undefined, 204,
    );
    await waitForOutbox(
      (event) => event.eventType === 'workspace.member_removed'
        && event.payload?.workspaceId === workspace.id && Boolean(event.publishedAt),
      'published Workspace member-removed outbox event',
    );

    const workflowName = `${runTag} terminal workflow`;
    const workflowResponse = await expectApiStatus(api, 'POST', `/api/v1/workspaces/${workspace.id}/workflows`, ownerToken, {
      name: workflowName,
      description: 'Task10 disposable manual-trigger terminal path',
    }, 201);
    const workflowCreatedBody = await jsonResponse(workflowResponse);
    const workflowId = workflowCreatedBody.workflowId;
    expect(typeof workflowId).toBe('string');
    const draft = {
      name: workflowName,
      description: 'Task10 disposable manual-trigger terminal path',
      definition: {
        schemaVersion: '1.0',
        nodes: [{ id: 'manual', type: 'trigger.manual', config: { buttonLabel: 'Task10 run' } }],
        edges: [],
        variables: {},
      },
      editorState: { nodes: { manual: { name: 'Manual trigger', position: { x: 100, y: 100 } } } },
    };
    await expectApiStatus(api, 'PUT', `/api/v1/workspaces/${workspace.id}/workflows/${workflowId}/draft`, ownerToken, draft, 200);
    await expectApiStatus(api, 'POST', `/api/v1/workspaces/${workspace.id}/workflows/${workflowId}/publish`, ownerToken, undefined, 200);
    const workflowEventRows = await waitUntil('Workflow created and published outbox events', async () => {
      const rows = readProducerOutbox().filter((event) =>
        ['workflow.created', 'workflow.published'].includes(event.eventType)
        && event.payload?.entity?.id === workflowId,
      );
      return rows.length === 2 && rows.every((row) => row.publishedAt) ? rows : null;
    });
    expect(workflowEventRows.map((event) => event.eventType).sort()).toEqual(['workflow.created', 'workflow.published']);

    const executionPath = `/api/v1/workspaces/${workspace.id}/workflows/${workflowId}/executions`;
    const admitted = await expectApiStatus(api, 'POST', executionPath, ownerToken, { input: {} }, 202);
    const acceptedExecution = await jsonResponse(admitted);
    const terminalExecution = await waitForExecution(
      api, ownerToken, `${executionPath}/${acceptedExecution.executionId}`,
    );
    expect(terminalExecution.status).toBe('SUCCESS');
    const completionEvent = await waitForOutbox(
      (event) => event.eventType === 'workflow.completed'
        && event.payload?.entity?.id === acceptedExecution.executionId && Boolean(event.publishedAt),
      'published Workflow actual terminal transition outbox event',
    );
    expect(completionEvent.publishedAt).toBeTruthy();
    expect(completionEvent.payload.entity.kind).toBe('EXECUTION');

    const ownerCountBeforeRename = readProducerOutbox().length;
    await expectApiStatus(api, 'PATCH', `/api/v1/workspaces/${workspace.id}`, ownerToken, { name: workspaceName }, 200);
    expect(readProducerOutbox()).toHaveLength(ownerCountBeforeRename);

    const memberLoginToken = await member.login(member.password);
    const lostAccess = await callApi(api, 'GET', `/api/v1/workspaces/${workspace.id}`, memberLoginToken);
    expect([403, 404]).toContain(lostAccess.status());

    const outageWorkspaceName = `${runTag} broker-retry`;
    const rowsBeforeOutage = readProducerOutbox().filter((event) => event.eventType === 'workspace.created');
    dockerCompose(['stop', '--timeout', '5', 'rabbitmq']);
    const outageCreate = await expectApiStatus(api, 'POST', '/api/v1/workspaces', ownerToken, {
      name: outageWorkspaceName,
    }, 201);
    const outageWorkspace = await jsonResponse(outageCreate);
    const outageEvent = await waitForOutbox(
      (event) => event.eventType === 'workspace.created' && event.payload?.data?.workspaceName === outageWorkspaceName,
      'Workspace transactional outbox row during broker outage',
      20_000,
    );
    expect(outageEvent.publishedAt).toBeFalsy();
    const retryEvidence = await waitUntil('Workspace outbox records a broker retry before service resumes', () => {
      const current = readProducerOutbox().find((event) => event.eventId === outageEvent.eventId);
      return current && current.attempts > 0 ? current : null;
    }, 20_000);
    expect(retryEvidence.eventId).toBe(outageEvent.eventId);

    dockerCompose(['start', 'rabbitmq']);
    await waitUntil('test-owned RabbitMQ management endpoint recovers', async () => {
      const response = await api.get(`${process.env.WEAV_TASK10_RABBITMQ_URL}/api/overview`, {
        headers: { authorization: `Basic ${Buffer.from(`task10_runtime:${process.env.WEAV_TASK10_RABBITMQ_PASSWORD}`).toString('base64')}` },
        timeout: API_TIMEOUT_MS,
      }).catch(() => null);
      if (!response || response.status() !== 200) return null;
      recordHttp('GET', '/api/overview', response.status());
      return true;
    }, 30_000);

    const publishedAfterRecovery = await waitForOutbox(
      (event) => event.eventId === outageEvent.eventId && Boolean(event.publishedAt),
      'same Workspace event ID is published after RabbitMQ recovery',
      60_000,
    );
    expect(publishedAfterRecovery.eventId).toBe(outageEvent.eventId);
    expect(publishedAfterRecovery.payload.eventId).toBe(outageEvent.payload.eventId);
    expect(readProducerOutbox().filter((event) => event.eventType === 'workspace.created')).toHaveLength(
      rowsBeforeOutage.length + 1,
    );

    const memberToken = memberLoginToken;
    const allEvents = readProducerOutbox().filter((event) =>
      event.eventType === 'identity.password_changed'
      || ['workspace.created', 'workspace.member_added', 'workspace.member_removed'].includes(event.eventType)
      || ['workflow.created', 'workflow.published', 'workflow.completed'].includes(event.eventType),
    );
    const workspaceEvents = allEvents.filter((event) => event.eventType.startsWith('workspace.'));
    const identityEvents = allEvents.filter((event) => event.eventType.startsWith('identity.'));
    const workflowEvents = allEvents.filter((event) => event.eventType.startsWith('workflow.'));
    assertOutboxRecipients(identityEvents, [owner.userId]);
    assertOutboxRecipients(workflowEvents, [owner.userId]);
    for (const event of workspaceEvents) {
      const recipient = ['workspace.member_added', 'workspace.member_removed'].includes(event.eventType)
        ? member.userId
        : owner.userId;
      assertOutboxRecipients([event], [recipient]);
    }
    expect(allEvents.every((event) => event.publishedAt)).toBe(true);

    const eventIds = allEvents.map((event) => event.eventId);
    const inboxAudit = await waitForInboxRows(eventIds);
    for (const event of allEvents) {
      const expectedRecipient = event.payload.recipientUserIds[0];
      const rows = inboxAudit.filter((row) => row.sourceEventId === event.eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(expectedRecipient);
      expect(rows[0].eventType).toBe(event.eventType);
      expect(rows[0].deliveryCount).toBe(0);
    }
    expect(inboxAudit.filter((row) => eventIds.includes(row.sourceEventId))).toHaveLength(allEvents.length);

    const ownerVi = await readInbox(api, ownerToken, 'vi');
    const ownerEn = await readInbox(api, ownerToken, 'en');
    const memberVi = await readInbox(api, memberToken, 'vi');
    const findItem = (items, eventType, text) => items.find((item) =>
      item.eventType === eventType && (!text || item.message.includes(text)),
    );
    const workspaceCreatedVi = findItem(ownerVi, 'workspace.created', workspaceName);
    const workspaceCreatedEn = findItem(ownerEn, 'workspace.created', workspaceName);
    const memberAdded = findItem(memberVi, 'workspace.member_added', workspaceName);
    const memberRemoved = findItem(memberVi, 'workspace.member_removed', workspaceName);
    const passwordChanged = findItem(ownerVi, 'identity.password_changed');
    const workflowCompletedVi = findItem(ownerVi, 'workflow.completed', workflowName);
    const workflowCompletedEn = findItem(ownerEn, 'workflow.completed', workflowName);
    expect(workspaceCreatedVi.title).toBe('Đã tạo không gian làm việc');
    expect(workspaceCreatedEn.title).toBe('Workspace created');
    expect(workspaceCreatedEn.message).toContain(workspaceName);
    expect(workspaceCreatedEn.target).toEqual({ kind: 'WORKSPACE', workspaceId: workspace.id });
    expect(workflowCompletedVi.title).toBe('Quy trình đã hoàn tất');
    expect(workflowCompletedEn.title).toBe('Workflow run completed');
    expect(workflowCompletedEn.target).toEqual({
      kind: 'EXECUTION', workspaceId: workspace.id, executionId: acceptedExecution.executionId,
    });
    expect(passwordChanged.target).toEqual({ kind: 'SECURITY_SETTINGS' });
    expect(memberAdded.target).toEqual({ kind: 'WORKSPACE', workspaceId: workspace.id });
    expect(memberRemoved.target).toEqual({ kind: 'NONE' });
    expect(ownerVi.some((item) => item.eventType.startsWith('workspace.member_'))).toBe(false);
    expect(memberVi.some((item) => item.eventType === 'workspace.created')).toBe(false);
    expect(memberVi.some((item) => item.eventType.startsWith('workflow.'))).toBe(false);

    const aCountBeforeClientReads = await readUnreadCount(api, ownerToken);
    const bCountBeforeIsolation = await readUnreadCount(api, memberToken);
    expect(aCountBeforeClientReads).toBe(6);
    expect(bCountBeforeIsolation).toBe(2);
    expect(ownerVi.some((item) => item.id === memberAdded.id || item.id === memberRemoved.id)).toBe(false);
    expect(memberVi.some((item) => item.id === workspaceCreatedVi.id)).toBe(false);
    const foreignMark = await callApi(api, 'PATCH', `/api/v2/notifications/${memberRemoved.id}/read?locale=en`, ownerToken);
    expect(foreignMark.status()).toBe(404);
    expect(await readUnreadCount(api, memberToken)).toBe(bCountBeforeIsolation);

    const replayCandidate = workspaceCreated;
    expect(replayCandidate.publishedAt).toBeTruthy();
    const beforeReplay = readInboxAudit().filter((row) => row.sourceEventId === replayCandidate.eventId);
    expect(beforeReplay).toHaveLength(1);
    dockerCompose(['restart', 'notification-service']);
    await waitUntil('restarted test-owned Notification consumer is Gateway-ready', async () => {
      const response = await callApi(api, 'GET', '/api/v2/notifications?limit=1&locale=en', ownerToken).catch(() => null);
      if (!response || response.status() !== 200) return null;
      return true;
    }, 45_000);

    const rabbitPublishUrl = `${process.env.WEAV_TASK10_RABBITMQ_URL}/api/exchanges/%2F/weav.events/publish`;
    const replayResponse = await api.post(rabbitPublishUrl, {
      headers: {
        authorization: `Basic ${Buffer.from(`task10_runtime:${process.env.WEAV_TASK10_RABBITMQ_PASSWORD}`).toString('base64')}`,
      },
      data: {
        properties: { delivery_mode: 2, message_id: replayCandidate.eventId, content_type: 'application/json' },
        routing_key: replayCandidate.payload.eventType,
        payload: JSON.stringify(replayCandidate.payload),
        payload_encoding: 'string',
      },
      timeout: API_TIMEOUT_MS,
    });
    recordHttp('POST', '/api/exchanges/:vhost/weav.events/publish', replayResponse.status());
    expect(replayResponse.status()).toBe(200);
    expect((await jsonResponse(replayResponse)).routed).toBe(true);
    await waitUntil('replayed event is consumed and deduplicated', async () => {
      const response = await api.get(
        `${process.env.WEAV_TASK10_RABBITMQ_URL}/api/queues/%2F/${encodeURIComponent(process.env.WEAV_TASK10_NOTIFICATION_QUEUE)}`,
        { headers: { authorization: `Basic ${Buffer.from(`task10_runtime:${process.env.WEAV_TASK10_RABBITMQ_PASSWORD}`).toString('base64')}` }, timeout: API_TIMEOUT_MS },
      ).catch(() => null);
      if (!response || response.status() !== 200) return null;
      const queue = await jsonResponse(response);
      return queue.messages_ready === 0 && queue.messages_unacknowledged === 0 ? true : null;
    }, 30_000);
    const afterReplay = readInboxAudit().filter((row) => row.sourceEventId === replayCandidate.eventId);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0].deliveryCount).toBe(0);
    expect(readInboxAudit().filter((row) => eventIds.includes(row.sourceEventId))).toHaveLength(allEvents.length);

    const webContext = await browser.newContext();
    browserContexts.push(webContext);
    const webPage = await webContext.newPage();
    await uiLogin(webPage, owner.email, owner.password);
    runtimeEvidenceByPage.get(webPage).phase = 'owner-web-notifications-initial-load';
    await webPage.goto('/notifications');
    const workspaceCreatedRowWeb = webPage.locator('article').filter({ hasText: workspaceName });
    await expect(workspaceCreatedRowWeb).toHaveCount(1);
    await expect(workspaceCreatedRowWeb.getByText('Đã tạo không gian làm việc', { exact: true })).toBeVisible();
    runtimeEvidenceByPage.get(webPage).phase = 'owner-web-locale-change';
    await setUiLocale(webPage, 'en');
    await expect(workspaceCreatedRowWeb.getByText('Workspace created', { exact: true })).toBeVisible();
    await expect(workspaceCreatedRowWeb.getByText(workspaceName, { exact: false })).toBeVisible();
    const identityRowWeb = webPage.locator('article').filter({ hasText: 'Password changed' });
    await expect(identityRowWeb).toHaveCount(1);
    runtimeEvidenceByPage.get(webPage).phase = 'owner-web-mark-one-read';
    await identityRowWeb.getByRole('button', { name: /mark as read/i }).click();
    await expect(identityRowWeb.getByText('Read', { exact: true })).toBeVisible();
    await expect(webPage.getByText(`${aCountBeforeClientReads - 1} unread`, { exact: true })).toBeVisible();

    const mobileContext = await browser.newContext({ viewport: { width: 430, height: 900 } });
    browserContexts.push(mobileContext);
    const mobilePage = await mobileContext.newPage();
    await uiLogin(mobilePage, owner.email, owner.password, true);
    const notificationsTab = mobilePage.getByText('Thông báo', { exact: true });
    await expect(notificationsTab).toBeVisible();
    runtimeEvidenceByPage.get(mobilePage).phase = 'owner-expoweb-open-notifications';
    await notificationsTab.click();
    await expect(mobilePage).toHaveURL(/\/notifications(?:[?#]|$)/);
    await expect(mobilePage.getByText('Thông báo & Cảnh báo', { exact: true })).toBeVisible();
    const identityRowMobile = mobilePage.getByTestId(`notification-item-${passwordChanged.id}`);
    await expect(identityRowMobile.getByText('Đã đọc', { exact: true })).toBeVisible();
    await expect(mobilePage.getByLabel(`${aCountBeforeClientReads - 1} chưa đọc`)).toBeVisible();
    runtimeEvidenceByPage.get(mobilePage).phase = 'owner-expoweb-filter-workflow';
    await mobilePage.getByTestId('notification-category-workflow').click();
    await expect(mobilePage.getByLabel(`${aCountBeforeClientReads - 1} chưa đọc`)).toBeVisible();
    runtimeEvidenceByPage.get(mobilePage).phase = 'owner-expoweb-filter-all';
    await mobilePage.getByTestId('notification-category-all').click();
    runtimeEvidenceByPage.get(mobilePage).phase = 'owner-expoweb-locale-change';
    await setUiLocale(mobilePage, 'en', true, passwordChanged.id);
    await expect(mobilePage.getByText('Workflow run completed', { exact: true })).toBeVisible();
    await expect(mobilePage.getByLabel(`${aCountBeforeClientReads - 1} unread`)).toBeVisible();
    runtimeEvidenceByPage.get(mobilePage).phase = 'owner-expoweb-mark-all-read';
    await mobilePage.getByTestId('notification-category-all').click();
    await mobilePage.getByTestId('notification-mark-all-read').click();
    await expect(mobilePage.getByLabel('0 unread')).toBeVisible();
    await expect.poll(() => readUnreadCount(api, ownerToken), { timeout: 10_000 }).toBe(0);

    runtimeEvidenceByPage.get(webPage).phase = 'owner-web-observe-global-mark-all';
    await webPage.reload();
    await expect(webPage.getByText('0 unread', { exact: true })).toBeVisible();

    const memberContext = await browser.newContext();
    browserContexts.push(memberContext);
    const memberPage = await memberContext.newPage();
    await uiLogin(memberPage, member.email, member.password);
    runtimeEvidenceByPage.get(memberPage).phase = 'member-web-notifications-initial-load';
    await memberPage.goto('/notifications');
    runtimeEvidenceByPage.get(memberPage).phase = 'member-web-locale-change';
    await setUiLocale(memberPage, 'en');
    const removedRowWeb = memberPage.locator('article').filter({ hasText: 'Workspace access removed' });
    await expect(removedRowWeb).toHaveCount(1);
    await expect(removedRowWeb.getByRole('button', { name: /open related item/i })).toHaveCount(0);
    const addedRowWeb = memberPage.locator('article').filter({ hasText: 'You were added to a workspace' });
    await expect(addedRowWeb).toHaveCount(1);
    await expect(addedRowWeb.getByRole('button', { name: /open related item/i })).toHaveCount(1);

    console.info(`Task10 HTTP evidence: ${[...observedHttp].sort().join('; ')}`);
    console.info(`Task10 sanitized runtime failures: ${[...observedFailures].sort().join('; ') || 'none'}`);
    expect(observedFailures).toEqual([]);
    expect([...observedHttp]).toContain('POST /api/auth/register 201');
    expect([...observedHttp]).toContain('POST /api/auth/login 200');
    expect([...observedHttp]).toContain('GET /api/v2/notifications/unread-count 200');
  } finally {
    for (const context of browserContexts) await context.close().catch(() => undefined);
    await api.dispose();
    console.info(`Task10 sanitized HTTP evidence: ${[...observedHttp].sort().join('; ') || 'no HTTP response observed'}`);
    console.info(`Task10 sanitized network/console failures: ${[...observedFailures].sort().join('; ') || 'none'}`);
  }
});
