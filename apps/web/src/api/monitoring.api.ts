import { executionApi } from './execution.api';
import { tr } from '../lib/i18n/tr';
import { getActiveWorkflowWorkspaceId, WorkflowApiError, workflowRequest } from './workflow-v1.api';

/** Workspace monitoring: run history, metrics summary and alert rules (Workflow Service through the Gateway). */
const isMockMode = import.meta.env.VITE_API_MODE === 'mock';

export type RunStatus = 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type AlertRuleType = 'CONSECUTIVE_FAILURES' | 'LONG_RUNNING';

export interface MonitoringRun {
  executionId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  triggerType: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface MonitoringRunPage {
  items: MonitoringRun[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface RunFilters {
  status?: RunStatus;
  workflowId?: string;
  /** ISO instants; the server allows a range of at most 90 days. */
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export interface MonitoringSummary {
  days: number;
  from: string;
  to: string;
  workflows: { published: number; paused: number; draft: number };
  runs: { total: number; today: number; success: number; failed: number; active: number };
  successRate: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
  trend: Array<{ date: string; total: number; success: number; failed: number }>;
  topFailingWorkflows: Array<{ workflowId: string; workflowName: string; failures: number; lastFailureAt: string }>;
  recentFailures: MonitoringRun[];
}

export interface AlertRule {
  id: string;
  workspaceId: string;
  workflowId: string | null;
  name: string;
  type: AlertRuleType;
  threshold: number;
  windowMinutes: number | null;
  cooldownMinutes: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleList {
  items: AlertRule[];
  maxRules: number;
}

export interface AlertRuleInput {
  name: string;
  type: AlertRuleType;
  workflowId: string | null;
  threshold: number;
  windowMinutes: number | null;
  cooldownMinutes: number;
  enabled: boolean;
}

const base = (workspaceId: string) => `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;

function invalidResponse(): WorkflowApiError {
  return new WorkflowApiError(502, tr('msg.workflow_service_returned_an_invalid_response'));
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---- Mock mode (VITE_API_MODE=mock): derived from the demo executions; rules live in localStorage ----

const MOCK_RULES_KEY = 'weav_mock_alert_rules';

function readMockRules(): AlertRule[] {
  try {
    return JSON.parse(localStorage.getItem(MOCK_RULES_KEY) ?? '[]') as AlertRule[];
  } catch {
    return [];
  }
}

function writeMockRules(rules: AlertRule[]): void {
  try {
    localStorage.setItem(MOCK_RULES_KEY, JSON.stringify(rules));
  } catch {
    // Storage can be unavailable (private window); the demo just forgets the rules.
  }
}

async function mockRuns(): Promise<MonitoringRun[]> {
  const executions = await executionApi.getExecutions();
  return executions.map((execution) => ({
    executionId: execution.id,
    workflowId: execution.workflowId,
    workflowName: execution.workflowName,
    status: execution.status,
    triggerType: execution.triggerType,
    createdAt: execution.startedAt,
    startedAt: execution.startedAt,
    finishedAt: execution.completedAt ?? null,
    durationMs: execution.durationMs ?? null,
    errorCode: null,
    errorMessage: null,
  }));
}

async function mockSummary(days: number): Promise<MonitoringSummary> {
  const runs = await mockRuns();
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  const inRange = runs.filter((run) => Date.parse(run.createdAt) >= start);
  const finished = inRange.filter((run) => run.status === 'SUCCESS' || run.status === 'FAILED');
  const durations = finished.map((run) => run.durationMs).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const success = finished.filter((run) => run.status === 'SUCCESS').length;
  const trend = Array.from({ length: days }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const day = inRange.filter((run) => run.createdAt.slice(0, 10) === date);
    return {
      date,
      total: day.length,
      success: day.filter((run) => run.status === 'SUCCESS').length,
      failed: day.filter((run) => run.status === 'FAILED').length,
    };
  });
  return {
    days,
    from: new Date(start).toISOString(),
    to: now.toISOString(),
    workflows: { published: 0, paused: 0, draft: 0 },
    runs: {
      total: inRange.length,
      today: trend[trend.length - 1].total,
      success,
      failed: finished.length - success,
      active: inRange.filter((run) => run.status === 'QUEUED' || run.status === 'RUNNING').length,
    },
    successRate: finished.length ? success / finished.length : null,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    p95DurationMs: durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null,
    trend,
    topFailingWorkflows: [],
    recentFailures: inRange.filter((run) => run.status === 'FAILED').slice(0, 5),
  };
}

export const monitoringApi = {
  async listRuns(filters: RunFilters = {}): Promise<MonitoringRunPage> {
    if (isMockMode) {
      const page = filters.page ?? 0;
      const size = filters.size ?? 20;
      const all = (await mockRuns()).filter((run) =>
        (!filters.status || run.status === filters.status) && (!filters.workflowId || run.workflowId === filters.workflowId));
      return { items: all.slice(page * size, (page + 1) * size), page, size, totalElements: all.length, hasNext: (page + 1) * size < all.length };
    }
    const workspaceId = await getActiveWorkflowWorkspaceId();
    const result = await workflowRequest<MonitoringRunPage>(`${base(workspaceId)}/executions${query({ ...filters })}`);
    if (!result || !Array.isArray(result.items)) throw invalidResponse();
    // Drop anything that is not a run, so one malformed row cannot crash the table.
    return { ...result, items: result.items.filter((item) => typeof item?.executionId === 'string' && typeof item.status === 'string') };
  },

  async getSummary(days = 7): Promise<MonitoringSummary> {
    if (isMockMode) return mockSummary(days);
    const workspaceId = await getActiveWorkflowWorkspaceId();
    const result = await workflowRequest<MonitoringSummary>(`${base(workspaceId)}/monitoring/summary${query({ days })}`);
    if (!result?.runs || !Array.isArray(result.trend)) throw invalidResponse();
    return result;
  },

  async listAlertRules(): Promise<AlertRuleList> {
    if (isMockMode) return { items: readMockRules(), maxRules: 20 };
    const workspaceId = await getActiveWorkflowWorkspaceId();
    const result = await workflowRequest<AlertRuleList>(`${base(workspaceId)}/alert-rules`);
    if (!result || !Array.isArray(result.items)) throw invalidResponse();
    return result;
  },

  async saveAlertRule(input: AlertRuleInput, ruleId?: string): Promise<AlertRule> {
    if (isMockMode) {
      const rules = readMockRules();
      const now = new Date().toISOString();
      const existing = rules.find((rule) => rule.id === ruleId);
      const rule: AlertRule = {
        ...input,
        id: existing?.id ?? `rule-${Date.now().toString(36)}`,
        workspaceId: 'mock',
        createdBy: 'mock',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      writeMockRules(existing ? rules.map((item) => (item.id === rule.id ? rule : item)) : [...rules, rule]);
      return rule;
    }
    const workspaceId = await getActiveWorkflowWorkspaceId();
    const path = `${base(workspaceId)}/alert-rules${ruleId ? `/${encodeURIComponent(ruleId)}` : ''}`;
    return workflowRequest<AlertRule>(path, { method: ruleId ? 'PUT' : 'POST', body: JSON.stringify(input) });
  },

  async deleteAlertRule(ruleId: string): Promise<void> {
    if (isMockMode) {
      writeMockRules(readMockRules().filter((rule) => rule.id !== ruleId));
      return;
    }
    const workspaceId = await getActiveWorkflowWorkspaceId();
    await workflowRequest<void>(`${base(workspaceId)}/alert-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
  },
};
