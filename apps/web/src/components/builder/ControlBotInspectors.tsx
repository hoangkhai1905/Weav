import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workflowApi } from '../../api/workflow.api';
import { workflowListKey } from '../../lib/queries/workflows';
import { useI18nStore } from '../../store/useI18nStore';
import { SchemaField } from './SchemaField';
import { CommaListInput } from './CommaListInput';

const inputCls = 'w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const labelCls = 'mb-1 block text-[11px] font-medium text-text-2';
const hintCls = 'mt-1 text-[10px] leading-relaxed text-muted-foreground';
const OPERATIONS = ['run', 'pause', 'resume', 'status', 'list_failures', 'command'] as const;
const EXPRESSION = '__expression__';
const DEFAULT_SENDER = '{{ trigger.input.message.from.id }}';

type Config = Record<string, unknown>;

/** Workflows of the active workspace (shared cached list), without the one being edited. */
function useOtherWorkflows(currentId?: string) {
  const { data = [], isLoading } = useQuery({ queryKey: workflowListKey(), queryFn: () => workflowApi.getWorkflows(), staleTime: 30_000 });
  return { workflows: data.filter((item) => item.id !== currentId), isLoading };
}

/** `weav.workflow`: operation, target (picker or typed name/expression), limit, chat text, run input. */
export const WeavWorkflowInspector: React.FC<{ nodeId: string; config: Config; currentWorkflowId?: string; onChange: (updates: Config) => void }> = ({ nodeId, config, currentWorkflowId, onChange }) => {
  const { t } = useI18nStore();
  const { workflows, isLoading } = useOtherWorkflows(currentWorkflowId);
  const operation = String(config.operation ?? '');
  const target = String(config.workflow ?? '');
  const known = workflows.some((item) => item.id === target);
  const [typing, setTyping] = useState(() => target !== '' && !known);
  const showExpression = typing || (target !== '' && !known);
  const [inputText, setInputText] = useState(() => (config.input === undefined ? '' : typeof config.input === 'string' ? config.input : JSON.stringify(config.input, null, 2)));
  const [inputError, setInputError] = useState(false);
  const field = (name: string) => (
    <SchemaField key={`${nodeId}:${name}`} nodeType="weav.workflow" name={name} value={config[name]} onChange={(value) => onChange({ [name]: value })} multiline={name === 'text'} />
  );
  // `limit` and `text` only mean something for one operation; clear them when the operation changes.
  const changeOperation = (next: string) => {
    if (next !== 'run') { setInputText(''); setInputError(false); }
    onChange({
    operation: next || undefined,
    text: next === 'command' ? config.text : undefined,
    sender: next === 'command' ? (config.sender ?? DEFAULT_SENDER) : undefined,
    allowedSenders: next === 'command' ? config.allowedSenders : undefined,
    input: next === 'run' ? config.input : undefined,
    limit: next === 'list_failures' ? config.limit : undefined,
    workflow: next === 'command' ? undefined : config.workflow,
    });
  };

  return (
    <div data-testid="weav-workflow-config" className="space-y-3">
      <div>
        <label htmlFor="weav-workflow-operation" className={labelCls}>{t('builder.field.weav.workflow.operation')}</label>
        <select id="weav-workflow-operation" data-testid="field-operation" value={operation} onChange={(event) => changeOperation(event.target.value)} className={inputCls}>
          {operation === '' && <option value="">{t('builder.field.default')}</option>}
          {OPERATIONS.map((item) => <option key={item} value={item}>{t(`builder.field.weav.workflow.operation.${item}`)}</option>)}
        </select>
      </div>
      {operation !== '' && operation !== 'command' && (
        <div>
          <label htmlFor="weav-workflow-target" className={labelCls}>{t('builder.field.weav.workflow.workflow')}</label>
          <select
            id="weav-workflow-target"
            data-testid="weav-workflow-target"
            value={showExpression ? EXPRESSION : target}
            onChange={(event) => {
              if (event.target.value === EXPRESSION) { setTyping(true); return; }
              setTyping(false);
              onChange({ workflow: event.target.value || undefined });
            }}
            disabled={isLoading}
            className={inputCls}
          >
            <option value="">{operation === 'list_failures' ? t('builder.cfg.wf_all') : t('builder.cfg.wf_select')}</option>
            {workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value={EXPRESSION}>{t('builder.cfg.wf_expression')}</option>
          </select>
          {showExpression && (
            <input
              data-testid="weav-workflow-target-text"
              aria-label={t('builder.field.weav.workflow.workflow')}
              value={target}
              onChange={(event) => onChange({ workflow: event.target.value || undefined })}
              placeholder={t('builder.cfg.wf_expression_placeholder')}
              className={`${inputCls} mt-1.5 font-mono`}
            />
          )}
          <p className={hintCls}>{t('builder.field.weav.workflow.workflow_hint')}</p>
        </div>
      )}
      {operation === 'list_failures' && field('limit')}
      {operation === 'command' && (
        <>
          {field('text')}
          <p className={hintCls}>{t('builder.field.weav.workflow.text_hint')}</p>
          {field('sender')}
          <div data-testid="allowed-senders">
            <CommaListInput
              key={`allowed:${nodeId}`}
              id="weav-workflow-allowed-senders"
              label={t('builder.field.weav.workflow.allowedSenders')}
              value={config.allowedSenders}
              onChange={(items) => onChange({ allowedSenders: items.length ? items : undefined })}
            />
            <p className={hintCls}>{t('builder.field.weav.workflow.allowedSenders_hint')}</p>
          </div>
        </>
      )}
      {operation === 'run' && (
        <div>
          <label htmlFor="weav-workflow-input" className={labelCls}>{t('builder.field.weav.workflow.input')}</label>
          <textarea
            id="weav-workflow-input"
            data-testid="weav-workflow-input"
            rows={4}
            value={inputText}
            aria-invalid={inputError || undefined}
            onChange={(event) => {
              const next = event.target.value;
              setInputText(next);
              if (next.trim() === '') { setInputError(false); onChange({ input: undefined }); return; }
              try {
                const parsed: unknown = JSON.parse(next);
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
                setInputError(false);
                onChange({ input: parsed });
              } catch {
                // A mapping such as {{ trigger.input }} is kept as text; anything else is flagged and not saved.
                const isMapping = next.trim().startsWith('{{');
                setInputError(!isMapping);
                // While the JSON is invalid no stale valid input may stay in the config.
                onChange({ input: isMapping ? next.trim() : undefined });
              }
            }}
            className={`${inputCls} resize-y font-mono`}
          />
          {inputError && <p role="alert" className="mt-1 text-[10px] text-err">{t('builder.cfg.wf_input_invalid')}</p>}
          <p className={hintCls}>{t('builder.field.weav.workflow.input_hint')}</p>
        </div>
      )}
    </div>
  );
};

/** `trigger.workflow_event`: workflows to watch (empty = all but this one) and the outcomes that fire it. */
export const WorkflowEventInspector: React.FC<{ config: Config; currentWorkflowId?: string; onChange: (updates: Config) => void }> = ({ config, currentWorkflowId, onChange }) => {
  const { t } = useI18nStore();
  const { workflows, isLoading } = useOtherWorkflows(currentWorkflowId);
  const selected = Array.isArray(config.workflowIds) ? config.workflowIds.map(String) : [];
  const events = Array.isArray(config.events) ? config.events.map(String) : [];
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  return (
    <div data-testid="workflow-event-config" className="space-y-3">
      <fieldset>
        <legend className={labelCls}>{t('builder.field.trigger.workflow_event.events')}</legend>
        <div className="flex gap-4">
          {(['FAILED', 'SUCCEEDED'] as const).map((event) => (
            <label key={event} className="flex items-center gap-1.5 text-[11px] text-text-2">
              <input type="checkbox" data-testid={`workflow-event-${event}`} checked={events.includes(event)} onChange={() => onChange({ events: toggle(events, event) })} className="h-3.5 w-3.5 accent-primary" />
              {t(`builder.field.trigger.workflow_event.events.${event}`)}
            </label>
          ))}
        </div>
        {events.length === 0 && <p role="alert" className="mt-1 text-[10px] text-err">{t('builder.cfg.wf_events_required')}</p>}
      </fieldset>
      <fieldset>
        <legend className={labelCls}>{t('builder.field.trigger.workflow_event.workflowIds')}</legend>
        {isLoading ? <p className={hintCls}>{t('builder.cfg.loading_connections')}</p> : (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-2">
            {workflows.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-1.5 text-[11px] text-text-2">
                  <input type="checkbox" data-testid={`workflow-event-wf-${item.id}`} checked={selected.includes(item.id)} onChange={() => { const next = toggle(selected, item.id); onChange({ workflowIds: next.length ? next : undefined }); }} className="h-3.5 w-3.5 accent-primary" />
                  <span className="truncate">{item.name}</span>
                </label>
              </li>
            ))}
            {workflows.length === 0 && <li className="text-[11px] text-muted-foreground">{t('builder.cfg.wf_none')}</li>}
          </ul>
        )}
        <p className={hintCls}>{t('builder.field.trigger.workflow_event.workflowIds_hint')}</p>
      </fieldset>
    </div>
  );
};

/** Character counter for a field whose limit applies after mapping (Discord content: 2000). */
export const CharCounter: React.FC<{ value: unknown; max: number }> = ({ value, max }) => {
  const { t } = useI18nStore();
  const length = String(value ?? '').length;
  return <p data-testid="content-counter" className={`mt-1 text-[10px] ${length > max ? 'text-err' : 'text-muted-foreground'}`}>{length}/{max} {t('builder.cfg.chars')}</p>;
};
