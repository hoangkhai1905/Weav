import React, { memo, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  Play,
  Clock,
  Webhook,
  Mail,
  FileSpreadsheet,
  Globe,
  Send,
  Sparkles,
  Tags,
  FileText,
  Bot,
  Scan,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  XCircle,
  GitBranch,
  Filter,
  Inbox,
  HardDrive,
  CalendarDays,
  Split,
  Braces,
  WandSparkles,
  BellRing,
  MessageSquare,
} from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { NODE_CATALOG, nodeSourcePorts } from '../../lib/constants/nodeCatalog';
import { getNodeReadinessBadge } from '../../lib/nodeReadiness';
import { useAttachableConnectionIds } from '../../hooks/useConnections';

const SUPPORTED_NODE_TYPES = new Set(NODE_CATALOG.map((item) => item.type));

const ICON_MAP: Record<string, React.ElementType> = {
  'trigger.manual': Play,
  'trigger.schedule': Clock,
  'trigger.webhook': Webhook,
  'trigger.telegram': Send,
  'email.send': Mail,
  'sheets.read': FileSpreadsheet,
  'sheets.append': FileSpreadsheet,
  'sheets.update': FileSpreadsheet,
  'docs.create': FileText,
  'docs.append': FileText,
  'docs.read': FileText,
  'google.sheets': FileSpreadsheet,
  'google.docs': FileText,
  'http.request': Globe,
  'telegram.send_message': Send,
  'ai.extract': Sparkles,
  'ai.classify': Tags,
  'ai.summarize': FileText,
  'agent.task': Bot,
  'ocr.extract': Scan,
  'logic.condition': GitBranch,
  'logic.filter': Filter,
  'trigger.gmail': Inbox,
  'google.drive': HardDrive,
  'google.calendar': CalendarDays,
  'logic.switch': Split,
  'data.set': Braces,
  'ai.generate': WandSparkles,
  'trigger.workflow_event': BellRing,
  'discord.send_message': MessageSquare,
  'weav.workflow': Bot,
};

export interface CustomNodeData {
  id?: string;
  name?: string;
  nameKey?: string;
  nodeType?: string;
  config?: Record<string, unknown>;
  status?: 'idle' | 'processing' | 'success' | 'error' | 'tested';
  executionTime?: string;
  selected?: boolean;
}

export const CustomWorkflowNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const prefersReducedMotion = useReducedMotion();
  const { t } = useI18nStore();
  const nodeType = (data.nodeType as string) || 'trigger.webhook';
  const name = data.nameKey ? t(String(data.nameKey)) : (data.name as string) || t('builder.node.default');
  const status = (data.status as CustomNodeData['status']) || 'idle';
  const executionTime = (data.executionTime as string) || '';
  const config = (data.config as Record<string, unknown>) || {};
  const readiness = getNodeReadinessBadge(nodeType, config, useAttachableConnectionIds());
  const isNodeSelected = Boolean(selected || data.selected);
  const isUnsupported = !SUPPORTED_NODE_TYPES.has(nodeType);
  const sourcePorts = nodeSourcePorts(nodeType, config);
  // Two ports keep the original true/false spacing; more (switch cases) grow the card and spread evenly.
  const portCount = sourcePorts?.length ?? 0;
  const updateNodeInternals = useUpdateNodeInternals();
  const { deleteElements } = useReactFlow();
  const portKey = JSON.stringify(sourcePorts?.map((port) => port.id) ?? []);
  // Switch ports follow config.cases; React Flow must re-measure handles when they change.
  useEffect(() => { updateNodeInternals(id); }, [id, portKey, updateNodeInternals]);
  const portTop = (index: number) => (portCount <= 2 ? 36 + index * 32 : ((index + 1) / (portCount + 1)) * 100);

  const Icon = ICON_MAP[nodeType] || AlertCircle;
  const isTrigger = nodeType.startsWith('trigger');
  const isAI = nodeType.startsWith('ai') || nodeType.startsWith('agent');
  const isLogic = nodeType.startsWith('logic');

  const badge = (tone: string, children: React.ReactNode) => (
    <span className={`inline-flex h-[18px] max-w-[110px] shrink-0 items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );

  // Badge status render helper
  const renderStatusBadge = () => {
    if (status === 'processing') {
      return badge('bg-run-bg text-run', (
        <>
          <Loader2 size={10} className="motion-safe:animate-spin" aria-hidden="true" />
          {t('builder.status.running')}
        </>
      ));
    }
    if (status === 'success') {
      return badge('bg-ok-bg text-ok', (
        <>
          <CheckCircle2 size={10} aria-hidden="true" />
          {executionTime || '200 OK'}
        </>
      ));
    }
    if (status === 'tested') {
      return badge('bg-ok-bg text-ok', (
        <>
          <CheckCircle2 size={10} aria-hidden="true" />
          {`${nodeType === 'ocr.extract' ? t('builder.status.ocr_test_passed') : t('builder.status.test_passed')}${executionTime ? ` · ${executionTime}` : ''}`}
        </>
      ));
    }
    if (status === 'error') {
      return badge('bg-err-bg text-err', (
        <>
          <XCircle size={10} aria-hidden="true" />
          {t('builder.status.error')}
        </>
      ));
    }
    const readinessClass = readiness.state === 'unsupported'
      ? 'bg-err-bg text-err'
      : readiness.state === 'ready' || readiness.state === 'draft'
        ? 'bg-muted text-text-2'
        : 'bg-warn-bg text-warn';
    return (
      <span
        data-testid="workflow-node-readiness"
        data-readiness={readiness.state}
        className={`inline-flex h-[18px] max-w-[110px] shrink-0 items-center truncate rounded px-1.5 text-[11px] font-medium ${readinessClass}`}
      >
        {t(readiness.labelKey)}
      </span>
    );
  };

  // Node container styling based on selection and status
  let borderStyle = 'border-border-strong hover:border-muted-foreground';
  if (isNodeSelected) {
    borderStyle = status === 'error' ? 'border-err ring-1 ring-err' : 'border-primary ring-1 ring-primary';
  } else if (status === 'processing') {
    borderStyle = 'border-run motion-safe:animate-[weav-node-pulse_1.4s_ease-in-out_infinite]';
  } else if (status === 'error') {
    borderStyle = 'border-err';
  }

  // Type stripe: 3px on the left edge, colour = step type
  const stripeClass = isTrigger ? 'bg-t-trigger' : isAI ? 'bg-t-ai' : isLogic ? 'bg-t-logic' : 'bg-t-action';
  const handleClass = '!h-2 !w-2 !rounded-full !border-[1.5px] !border-muted-foreground !bg-card cursor-crosshair transition-colors hover:!border-primary hover:!bg-primary';

  const iconMotion = prefersReducedMotion
    ? { scale: 1 }
    : status === 'processing'
      ? { scale: [1, 1.08, 1] }
      : status === 'success'
        ? { scale: [1, 1.12, 1] }
        : { scale: 1 };
  const iconTransition = status === 'processing'
    ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const }
    : { duration: prefersReducedMotion ? 0.01 : 0.28, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.div
      data-testid="workflow-node"
      data-node-type={nodeType}
      data-status={status}
      data-readiness={readiness.state}
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.01 : 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={portCount > 2 ? { minHeight: portCount * 26 + 16 } : undefined}
      className={`relative w-[232px] select-none rounded-lg border bg-card py-2.5 pl-[15px] pr-3 transition-[border-color,box-shadow] duration-150 ${borderStyle}`}
    >
      <span aria-hidden="true" className={`pointer-events-none absolute -bottom-px -left-px -top-px w-[3px] rounded-l-lg ${stripeClass}`} />
      {isNodeSelected && (
        <button
          type="button"
          data-testid="workflow-node-delete"
          aria-label={t('builder.node.delete').replace('{id}', id)}
          title={t('builder.node.delete').replace('{id}', id)}
          onClick={(event) => {
            event.stopPropagation();
            // The button disappears with the node: hand focus to the canvas instead of <body>.
            const flow = event.currentTarget.closest<HTMLElement>('.react-flow');
            void deleteElements({ nodes: [{ id }] }).then(() => { flow?.setAttribute('tabindex', '-1'); flow?.focus(); });
          }}
          className="nodrag absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-card text-muted-foreground shadow-sm hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      )}
      {/* Target Handle (Left) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className={`${handleClass} !-left-1`}
        />
      )}

      {/* Node Header */}
      <div className="flex items-center gap-2.5">
        <motion.div
          data-testid="workflow-node-icon"
          animate={iconMotion}
          transition={iconTransition}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-text-2"
        >
          <Icon size={15} aria-hidden="true" />
        </motion.div>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {isTrigger ? `${t('builder.status.trigger')} · ` : ''}
            {id}
          </span>
        </div>
      </div>

      {isUnsupported && (
        <div
          data-testid="unsupported-node-warning"
          role="note"
          className="mt-1.5 rounded bg-err-bg px-2 py-0.5 text-[10px] font-medium text-err"
        >
          {t('builder.node.unsupported_note')}
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{nodeType}</span>
        {renderStatusBadge()}
      </div>

      {sourcePorts?.length ? (
        sourcePorts.map((port, index) => (
          <React.Fragment key={port.id}>
            <Handle
              id={port.id}
              data-testid={`condition-source-${port.id}`}
              type="source"
              position={Position.Right}
              style={{ top: `${portTop(index)}%` }}
              className={`${handleClass} !-right-1`}
            />
            <span
              data-testid={`condition-port-label-${port.id}`}
              className="pointer-events-none absolute left-[calc(100%+10px)] z-10 -translate-y-1/2 whitespace-nowrap rounded border border-border bg-card px-1.5 py-px text-[10px] font-medium leading-4 text-text-2"
              style={{ top: `${portTop(index)}%` }}
            >
              {t(`builder.cfg.port_${port.id}`) === `builder.cfg.port_${port.id}` ? port.label : t(`builder.cfg.port_${port.id}`)}
            </span>
          </React.Fragment>
        ))
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className={`${handleClass} !-right-1`}
        />
      )}
    </motion.div>
  );
});
