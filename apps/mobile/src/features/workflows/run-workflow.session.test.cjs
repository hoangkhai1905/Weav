const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../../../test-support/register-typescript.cjs');

const { MutationObserver, QueryClient } = require('@tanstack/react-query');
const { useAuthStore } = require('../../stores/auth.store.ts');
const { useI18nStore } = require('../../stores/i18n.store.ts');
const { useUIStore } = require('../../stores/ui.store.ts');
const { workflowRepository } = require('../../infrastructure/repository-factory.ts');
const { createRunWorkflowMutationOptions } = require('./hooks/useRunWorkflow.ts');
const { completeWorkflowRunInCurrentSession } = require('./run-workflow.session.ts');

const originalRunWorkflow = workflowRepository.runWorkflow;
const originalShowToast = useUIStore.getState().showToast;
const originalLanguage = useI18nStore.getState().language;

const callers = [
  {
    name: 'WorkflowDetailScreen',
    file: path.resolve(__dirname, '../../app/(app)/workflows/[id].tsx'),
    reset: (effects) => { effects.modalOpen = false; effects.payload = ''; },
  },
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setSession(userId) {
  useAuthStore.getState().setAuthSession(
    { id: userId, name: 'Synthetic Test', email: `${userId}@example.invalid` },
    { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' },
  );
}

function createHarness(pending, toasts, invalidations) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.invalidateQueries = async ({ queryKey }) => { invalidations.push(queryKey); };
  const showToast = (toast) => toasts.push(toast);
  useUIStore.setState({ showToast });
  const observer = new MutationObserver(
    queryClient,
    createRunWorkflowMutationOptions(queryClient, showToast),
  );
  workflowRepository.runWorkflow = () => pending.promise;
  return { observer, queryClient };
}

function assertScreenWiring(caller) {
  const source = fs.readFileSync(caller.file, 'utf8');
  assert.match(source, /await completeWorkflowRunInCurrentSession\(/);
  const awaitAt = source.indexOf('await completeWorkflowRunInCurrentSession(');
  const mutationAt = source.indexOf('runMutation.mutateAsync(', awaitAt);
  const guardAt = source.indexOf("if (completion.status !== 'success') return;", mutationAt);
  const resetAt = source.indexOf('setPayloadInput(\'\');', guardAt);
  const navigationAt = source.indexOf('router.push(`/(app)/executions/${res.workflowId}/${res.executionId}`)', guardAt);
  assert.ok(mutationAt > awaitAt, `${caller.name} must pass its run mutation into the fence`);
  assert.ok(guardAt > mutationAt, `${caller.name} must stop stale/failed completion before UI effects`);
  assert.ok(resetAt > guardAt, `${caller.name} must reset UI only after the session fence`);
  assert.ok(navigationAt > guardAt, `${caller.name} must navigate only after the session fence`);
  return source;
}

async function runScreenCompletion(caller, observer, effects) {
  assertScreenWiring(caller);
  const completion = await completeWorkflowRunInCurrentSession(
    () => observer.mutate({ id: 'workflow-synthetic' }),
  );
  if (completion.status !== 'success') return completion;

  caller.reset(effects);
  if (completion.result?.executionId) {
    effects.routes.push(`/(app)/executions/${completion.result.workflowId}/${completion.result.executionId}`);
  }
  return completion;
}

afterEach(() => {
  workflowRepository.runWorkflow = originalRunWorkflow;
  useAuthStore.getState().clearAuthSession();
  useUIStore.setState({ showToast: originalShowToast, toasts: [] });
  useI18nStore.setState({ language: originalLanguage });
});

for (const caller of callers) {
  test(`${caller.name} fences a delayed A-to-B run before UI reset/navigation`, async () => {
    setSession('account-a');
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    setSession('account-b');
    pending.resolve({ executionId: 'execution-from-account-a', workflowId: 'workflow-a' });
    await running;

    assert.deepEqual(effects, { modalOpen: true, payload: '{"a":1}', routes: [] });
    assert.deepEqual(toasts, []);
    assert.deepEqual(invalidations, []);
    queryClient.clear();
  });

  test(`${caller.name} suppresses a delayed run after logout`, async () => {
    setSession('account-a');
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    useAuthStore.getState().clearAuthSession();
    pending.resolve({ executionId: 'execution-after-logout', workflowId: 'workflow-a' });
    await running;

    assert.deepEqual(effects, { modalOpen: true, payload: '{"a":1}', routes: [] });
    assert.deepEqual(toasts, []);
    assert.deepEqual(invalidations, []);
    queryClient.clear();
  });

  test(`${caller.name} fences replacement generation for the same user`, async () => {
    setSession('account-a');
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const firstGeneration = useAuthStore.getState().sessionGeneration;
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    setSession('account-a');
    assert.notEqual(useAuthStore.getState().sessionGeneration, firstGeneration);
    pending.resolve({ executionId: 'execution-from-old-generation', workflowId: 'workflow-a' });
    await running;

    assert.deepEqual(effects, { modalOpen: true, payload: '{"a":1}', routes: [] });
    assert.deepEqual(toasts, []);
    assert.deepEqual(invalidations, []);
    queryClient.clear();
  });

  test(`${caller.name} commits current success once with the existing queued toast`, async () => {
    setSession('account-a');
    useI18nStore.setState({ language: 'VI' });
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    pending.resolve({ executionId: 'execution-current', workflowId: 'workflow-current' });
    const completion = await running;
    assert.equal(completion.status, 'success', JSON.stringify(toasts.map(({ type, title, message }) => ({ type, title, message }))));

    assert.deepEqual(effects, { modalOpen: false, payload: '', routes: ['/(app)/executions/workflow-current/execution-current'] });
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, 'success');
    assert.equal(toasts[0].title, 'Đã gửi lượt chạy');
    assert.match(toasts[0].message, /được xếp hàng/);
    assert.deepEqual(invalidations, [['notifications', 'account-a', useAuthStore.getState().sessionGeneration], ['executions'], ['workflows']]);
    queryClient.clear();
  });

  test(`${caller.name} consumes current failure and preserves the hook error report`, async () => {
    setSession('account-a');
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    pending.reject(new Error('synthetic run failure'));
    await running;

    assert.deepEqual(effects, { modalOpen: true, payload: '{"a":1}', routes: [] });
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, 'error');
    assert.equal(toasts[0].title, 'Chưa chạy được quy trình');
    assert.equal(toasts[0].message, 'Có lỗi xảy ra. Vui lòng thử lại.');
    assert.deepEqual(invalidations, []);
    queryClient.clear();
  });

  test(`${caller.name} consumes a stale failure without feedback or UI effects`, async () => {
    setSession('account-a');
    const pending = deferred();
    const toasts = [];
    const invalidations = [];
    const { observer, queryClient } = createHarness(pending, toasts, invalidations);
    const effects = { modalOpen: true, payload: '{"a":1}', routes: [] };

    const running = runScreenCompletion(caller, observer, effects);
    setSession('account-b');
    pending.reject(new Error('synthetic stale failure'));
    await running;

    assert.deepEqual(effects, { modalOpen: true, payload: '{"a":1}', routes: [] });
    assert.deepEqual(toasts, []);
    assert.deepEqual(invalidations, []);
    queryClient.clear();
  });
}
