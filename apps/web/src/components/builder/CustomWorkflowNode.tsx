import React, { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Handle, Position, type NodeProps } from '@xyflow/react';
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
  Zap,
  CheckCircle2,
  Loader2,
  XCircle,
  GitBranch,
  Filter,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ElementType> = {
  'trigger.manual': Play,
  'trigger.schedule': Clock,
  'trigger.webhook': Webhook,
  'trigger.telegram': Send,
  'email.send': Mail,
  'sheets.read': FileSpreadsheet,
  'sheets.append': FileSpreadsheet,
  'http.request': Globe,
  'telegram.send_message': Send,
  'ai.extract': Sparkles,
  'ai.classify': Tags,
  'ai.summarize': FileText,
  'agent.task': Bot,
  'ocr.extract': Scan,
  'logic.condition': GitBranch,
  'logic.filter': Filter,
};

export interface CustomNodeData {
  id?: string;
  name?: string;
  nodeType?: string;
  config?: Record<string, unknown>;
  status?: 'idle' | 'processing' | 'success' | 'error';
  executionTime?: string;
  selected?: boolean;
}

export const CustomWorkflowNode: React.FC<NodeProps> = memo(({ data, selected }) => {
  const prefersReducedMotion = useReducedMotion();
  const nodeType = (data.nodeType as string) || 'trigger.webhook';
  const name = (data.name as string) || 'Node';
  const status = (data.status as CustomNodeData['status']) || 'idle';
  const executionTime = (data.executionTime as string) || '';
  const isNodeSelected = Boolean(selected || data.selected);

  const Icon = ICON_MAP[nodeType] || AlertCircle;
  const isTrigger = nodeType.startsWith('trigger');
  const isAI = nodeType.startsWith('ai') || nodeType.startsWith('agent');
  const isLogic = nodeType.startsWith('logic');

  // Badge status render helper
  const renderStatusBadge = () => {
    if (status === 'processing') {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <Loader2 size={10} className="text-amber-500 motion-safe:animate-spin" />
          Running
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={10} className="text-emerald-500" />
          {executionTime || '200 OK'}
        </span>
      );
    }
    if (status === 'error') {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
          <XCircle size={10} className="text-rose-500" />
          500 Error
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60">
        Ready
      </span>
    );
  };

  // Node container styling based on selection and status
  let borderStyle = 'border-slate-200 dark:border-slate-800';
  if (isNodeSelected) {
    borderStyle = 'border-primary ring-1 ring-primary/35 shadow-sm';
  } else if (status === 'processing') {
    borderStyle = 'border-amber-500 ring-1 ring-amber-500/30';
  } else if (status === 'error') {
    borderStyle = 'border-rose-500 ring-1 ring-rose-500/30';
  } else if (status === 'success') {
    borderStyle = 'border-emerald-500/60 dark:border-emerald-500/40';
  }

  // Accent icon background
  const iconBgClass = isTrigger
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    : isAI
    ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/45 dark:text-blue-300 dark:border-blue-900/70'
    : isLogic
    ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';

  return (
    <motion.div
      data-testid="workflow-node"
      data-status={status}
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.985, y: 4 }}
      animate={prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1, y: isNodeSelected ? -1 : 0 }}
      transition={{ duration: prefersReducedMotion ? 0.01 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`relative w-64 select-none rounded-lg border bg-card p-3 shadow-sm transition-[border-color,box-shadow] duration-200 hover:shadow-md ${borderStyle}`}
    >
      {/* Target Handle (Left) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-2.5 h-2.5 !bg-blue-500 !border-2 !border-white dark:!border-slate-900 !rounded-full !-left-1.5 cursor-crosshair"
        />
      )}

      {/* Selected Indicator Pill */}
      {isNodeSelected && (
        <div className="absolute -top-2.5 left-3 rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white shadow-sm">
          Inspecting Step
        </div>
      )}

      {/* Node Header */}
      <div className="flex items-start gap-2.5">
        <div className={`p-2 rounded-md border flex items-center justify-center shrink-0 ${iconBgClass}`}>
          <Icon size={16} />
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{name}</span>
            {isTrigger && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                <Zap size={9} /> Trigger
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">{nodeType}</span>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px]">
        <span className="text-slate-500 dark:text-slate-400 font-mono">
          {data.id ? String(data.id) : 'step_1'}
        </span>
        {renderStatusBadge()}
      </div>

      {/* Source Handle (Right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-2.5 h-2.5 !bg-blue-500 !border-2 !border-white dark:!border-slate-900 !rounded-full !-right-1.5 cursor-crosshair"
      />
    </motion.div>
  );
});
