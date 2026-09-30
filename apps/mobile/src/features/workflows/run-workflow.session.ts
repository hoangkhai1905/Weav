import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../auth/auth-session.scope';

export type WorkflowRunCompletion<TResult> =
  | { status: 'success'; result: TResult }
  | { status: 'stale' | 'failed' };

export async function completeWorkflowRunInCurrentSession<TResult>(
  run: () => Promise<TResult>,
): Promise<WorkflowRunCompletion<TResult>> {
  const scope = captureAuthSessionScope();
  let result: TResult;

  try {
    result = await run();
  } catch {
    return { status: isAuthSessionScopeCurrent(scope) ? 'failed' : 'stale' };
  }

  if (!isAuthSessionScopeCurrent(scope)) return { status: 'stale' };
  return { status: 'success', result };
}
