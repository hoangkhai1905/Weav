import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { monitoringApi, type AlertRule, type AlertRuleInput, type AlertRuleType } from '../../api/monitoring.api';
import { useI18nStore } from '../../store/useI18nStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { ConfirmButton } from '../common/ConfirmButton';
import { statusBadgeClass } from '../common/statusBadgeClass';

interface WorkflowOption {
  id: string;
  name: string;
}

interface FormState {
  id: string | null;
  name: string;
  type: AlertRuleType;
  workflowId: string;
  threshold: string;
  windowMinutes: string;
  cooldownMinutes: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  type: 'CONSECUTIVE_FAILURES',
  workflowId: '',
  threshold: '3',
  windowMinutes: '60',
  cooldownMinutes: '60',
  enabled: true,
};

const fieldCls = 'h-8 w-full rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const btnCls = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** List, create, edit, enable/disable and delete the workspace's alert rules. */
export function AlertRulesPanel({ workflows }: { workflows: WorkflowOption[] }) {
  const { t } = useI18nStore();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId) ?? 'active';
  const key = ['monitoring', 'alert-rules', workspaceId] as const;
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rulesQuery = useQuery({ queryKey: key, queryFn: () => monitoringApi.listAlertRules(), retry: false });
  const save = useMutation({
    mutationFn: ({ input, id }: { input: AlertRuleInput; id?: string }) => monitoringApi.saveAlertRule(input, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => monitoringApi.deleteAlertRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const rules = rulesQuery.data?.items ?? [];
  const maxRules = rulesQuery.data?.maxRules ?? 20;
  const workflowName = (id: string | null) => (id ? workflows.find((workflow) => workflow.id === id)?.name ?? id : t('monitoring.all_workflows'));

  const describe = (rule: AlertRule) => rule.type === 'CONSECUTIVE_FAILURES'
    ? t('monitoring.rule_desc_failures').replace('{n}', String(rule.threshold)).replace('{m}', String(rule.windowMinutes ?? ''))
    : t('monitoring.rule_desc_long').replace('{s}', String(rule.threshold));

  const edit = (rule: AlertRule) => {
    setNotice(null);
    setFormError(null);
    setForm({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      workflowId: rule.workflowId ?? '',
      threshold: String(rule.threshold),
      windowMinutes: rule.windowMinutes === null ? '60' : String(rule.windowMinutes),
      cooldownMinutes: String(rule.cooldownMinutes),
      enabled: rule.enabled,
    });
  };

  const toInput = (state: FormState): AlertRuleInput | string => {
    const threshold = Number(state.threshold);
    const cooldown = Number(state.cooldownMinutes);
    const window = Number(state.windowMinutes);
    if (!state.name.trim() || state.name.trim().length > 120) return t('monitoring.err_name');
    const failures = state.type === 'CONSECUTIVE_FAILURES';
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > (failures ? 20 : 86_400)) {
      return failures ? t('monitoring.err_threshold_failures') : t('monitoring.err_threshold_seconds');
    }
    if (failures && (!Number.isInteger(window) || window < 1 || window > 10_080)) return t('monitoring.err_window');
    if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 10_080) return t('monitoring.err_cooldown');
    return {
      name: state.name.trim(),
      type: state.type,
      workflowId: state.workflowId || null,
      threshold,
      windowMinutes: failures ? window : null,
      cooldownMinutes: cooldown,
      enabled: state.enabled,
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const input = toInput(form);
    if (typeof input === 'string') {
      setFormError(input);
      return;
    }
    setFormError(null);
    try {
      await save.mutateAsync({ input, id: form.id ?? undefined });
      setNotice(t(form.id ? 'monitoring.rule_saved' : 'monitoring.rule_created'));
      setForm(null);
    } catch (error) {
      setFormError(errorText(error, t('monitoring.rule_save_error')));
    }
  };

  const toggle = async (rule: AlertRule) => {
    setNotice(null);
    try {
      await save.mutateAsync({
        id: rule.id,
        input: { name: rule.name, type: rule.type, workflowId: rule.workflowId, threshold: rule.threshold, windowMinutes: rule.windowMinutes, cooldownMinutes: rule.cooldownMinutes, enabled: !rule.enabled },
      });
    } catch (error) {
      setNotice(errorText(error, t('monitoring.rule_save_error')));
    }
  };

  const update = (patch: Partial<FormState>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const failures = form?.type === 'CONSECUTIVE_FAILURES';

  return (
    <section aria-label={t('monitoring.rules_title')} data-testid="alert-rules" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-foreground">{t('monitoring.rules_title')}</h2>
          <p className="text-xs text-muted-foreground">{t('monitoring.rules_hint')}</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{rules.length}/{maxRules}</span>
        <button type="button" className={btnCls} disabled={rules.length >= maxRules || form !== null} data-testid="alert-rule-add"
          onClick={() => { setNotice(null); setFormError(null); setForm({ ...EMPTY_FORM }); }}>
          <Plus size={14} aria-hidden="true" />{t('monitoring.rule_add')}
        </button>
      </div>

      {notice && <p role="status" className="rounded-md border border-border bg-accent px-3 py-2 text-[13px] text-accent-foreground">{notice}</p>}

      {form && (
        <form noValidate onSubmit={(event) => void submit(event)} data-testid="alert-rule-form" className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-text-2 sm:col-span-2">
            {t('monitoring.field_name')}
            <input className={`${fieldCls} mt-1`} value={form.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} />
          </label>
          <label className="text-xs font-medium text-text-2">
            {t('monitoring.field_type')}
            <select className={`${fieldCls} mt-1`} value={form.type} onChange={(event) => update({ type: event.target.value as AlertRuleType })}>
              <option value="CONSECUTIVE_FAILURES">{t('monitoring.type_failures')}</option>
              <option value="LONG_RUNNING">{t('monitoring.type_long')}</option>
            </select>
          </label>
          <label className="text-xs font-medium text-text-2">
            {t('monitoring.field_scope')}
            <select className={`${fieldCls} mt-1`} value={form.workflowId} onChange={(event) => update({ workflowId: event.target.value })}>
              <option value="">{t('monitoring.all_workflows')}</option>
              {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-text-2">
            {failures ? t('monitoring.field_threshold_failures') : t('monitoring.field_threshold_seconds')}
            <input className={`${fieldCls} mt-1`} type="number" inputMode="numeric" min={1} max={failures ? 20 : 86_400} value={form.threshold} onChange={(event) => update({ threshold: event.target.value })} />
          </label>
          {failures && (
            <label className="text-xs font-medium text-text-2">
              {t('monitoring.field_window')}
              <input className={`${fieldCls} mt-1`} type="number" inputMode="numeric" min={1} max={10_080} value={form.windowMinutes} onChange={(event) => update({ windowMinutes: event.target.value })} />
            </label>
          )}
          <label className="text-xs font-medium text-text-2">
            {t('monitoring.field_cooldown')}
            <input className={`${fieldCls} mt-1`} type="number" inputMode="numeric" min={0} max={10_080} value={form.cooldownMinutes} onChange={(event) => update({ cooldownMinutes: event.target.value })} />
          </label>
          <label className="flex items-center gap-2 self-end text-[13px] text-foreground">
            <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            {t('monitoring.field_enabled')}
          </label>
          {formError && (
            <p role="alert" data-testid="alert-rule-error" className="flex items-start gap-2 text-[13px] text-err sm:col-span-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{formError}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={`${btnCls} bg-primary text-primary-foreground hover:bg-primary`} disabled={save.isPending} data-testid="alert-rule-save">{t('monitoring.rule_save')}</button>
            <button type="button" className={btnCls} onClick={() => setForm(null)}>{t('monitoring.rule_cancel')}</button>
          </div>
        </form>
      )}

      {rulesQuery.isLoading ? (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t('monitoring.loading')}</p>
      ) : rulesQuery.isError ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-err-border bg-err-bg px-3 py-2 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{errorText(rulesQuery.error, t('monitoring.rules_error'))}</span>
          <button type="button" className="font-medium underline" onClick={() => void rulesQuery.refetch()}>{t('monitoring.retry')}</button>
        </div>
      ) : rules.length === 0 ? (
        <p data-testid="alert-rules-empty" className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">{t('monitoring.rules_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <caption className="sr-only">{t('monitoring.rules_title')}</caption>
            <thead>
              <tr className="border-b border-border bg-subtle text-left text-xs font-medium text-muted-foreground">
                <th scope="col" className="px-3 py-2">{t('monitoring.field_name')}</th>
                <th scope="col" className="px-3 py-2">{t('monitoring.col_condition')}</th>
                <th scope="col" className="px-3 py-2">{t('monitoring.field_scope')}</th>
                <th scope="col" className="px-3 py-2">{t('monitoring.col_state')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('executions.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} data-testid="alert-rule-row" className="border-b border-border last:border-0">
                  <td className="max-w-[220px] truncate px-3 py-2 font-medium text-foreground" title={rule.name}>{rule.name}</td>
                  <td className="px-3 py-2 text-text-2">{describe(rule)}<span className="block text-[11px] text-muted-foreground">{t('monitoring.cooldown_short').replace('{m}', String(rule.cooldownMinutes))}</span></td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-text-2">{workflowName(rule.workflowId)}</td>
                  <td className="px-3 py-2"><span className={statusBadgeClass(rule.enabled ? 'ok' : 'pause')}>{t(rule.enabled ? 'monitoring.rule_on' : 'monitoring.rule_off')}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className={btnCls} onClick={() => void toggle(rule)} disabled={save.isPending} aria-label={`${t(rule.enabled ? 'monitoring.rule_disable' : 'monitoring.rule_enable')}: ${rule.name}`}>
                        {t(rule.enabled ? 'monitoring.rule_disable' : 'monitoring.rule_enable')}
                      </button>
                      <button type="button" className={btnCls} onClick={() => edit(rule)} aria-label={`${t('monitoring.rule_edit')}: ${rule.name}`}>
                        <Pencil size={13} aria-hidden="true" />{t('monitoring.rule_edit')}
                      </button>
                      <ConfirmButton
                        title={t('monitoring.rule_delete_title')}
                        description={t('monitoring.rule_delete_desc').replace('{name}', rule.name)}
                        confirmText={t('monitoring.rule_delete')}
                        className={`${btnCls} text-err`}
                        titleTooltip={`${t('monitoring.rule_delete')}: ${rule.name}`}
                        dataTestId="alert-rule-delete"
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync(rule.id);
                            setNotice(t('monitoring.rule_deleted'));
                          } catch (error) {
                            setNotice(errorText(error, t('monitoring.rule_delete_error')));
                          }
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />{t('monitoring.rule_delete')}
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
