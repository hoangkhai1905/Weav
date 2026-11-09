import type { ReadinessIssue, WorkflowReadiness } from '../../domain/workflow/workflow.types';
import { fill } from '../common/fill';
import { fieldName, humanizeField, providerForNodeType } from '../ai/ai.answers';

export type { ReadinessIssue };

/** Issues of known steps by step id; the rest (null or unknown node) are graph-level issues. */
export function groupIssues(issues: ReadinessIssue[], stepIds: readonly string[]) {
  const known = new Set(stepIds);
  const byStep = new Map<string, ReadinessIssue[]>();
  let graphIssues = 0;
  for (const issue of issues) {
    if (issue.nodeId === null || !known.has(issue.nodeId)) {
      graphIssues += 1;
      continue;
    }
    byStep.set(issue.nodeId, [...(byStep.get(issue.nodeId) ?? []), issue]);
  }
  return { byStep, graphIssues, redCount: byStep.size };
}

/**
 * Plain-language reason for a red step. i18n keys used (Task 6 adds the strings):
 * workflows.readiness.notAuthorized, .pickAccount {provider: t(provider.<CODE>)}, .missingField {field: aig.field.<name> else humanized}, .missingField {field}, .generic.
 */
export function reasonFor(
  issue: ReadinessIssue,
  nodeType: string,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  if (issue.code === 'CONNECTION_NOT_AUTHORIZED') return t('workflows.readiness.notAuthorized');
  const name = issue.field ? fieldName(issue.field) : '';
  if (name === 'connectionId') {
    const provider = providerForNodeType(nodeType);
    return provider
      ? t('workflows.readiness.pickAccount', { provider: t(`provider.${provider}`) })
      : t('workflows.readiness.generic');
  }
  if (name) {
    const known = t(`aig.field.${name}`);
    return t('workflows.readiness.missingField', { field: known !== `aig.field.${name}` ? known : humanizeField(name) });
  }
  return t('workflows.readiness.generic');
}

/** Deep link to a step in the web builder; null when no web base URL is configured. */
export function webStepUrl(base: string | undefined, workflowId: string, nodeId: string): string | null {
  const root = (base ?? '').trim().replace(/\/+$/, '');
  if (!root) return null;
  return `${root}/workflows/${encodeURIComponent(workflowId)}/builder?step=${encodeURIComponent(nodeId)}`;
}

/** The store's t(key) ignores variables; this fills {placeholders} so reasonFor's t(key, vars) works. */
export function withVars(t: (key: string) => string): (key: string, vars?: Record<string, string>) => string {
  return (key, vars) => fill(t(key), vars ?? {});
}

/** Derived screen state. Undefined readiness (loading or request error) shows nothing and blocks nothing. */
export function readinessView(readiness: WorkflowReadiness | undefined, stepIds: readonly string[]) {
  const { byStep, graphIssues, redCount } = groupIssues(readiness?.issues ?? [], stepIds);
  return { byStep, redCount, showGraphLine: graphIssues > 0, publishBlocked: redCount + graphIssues > 0 };
}
