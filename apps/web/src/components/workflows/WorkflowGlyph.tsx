import {
  Clock3,
  Database,
  MousePointerClick,
  Send,
  Webhook,
  Workflow,
} from 'lucide-react';

interface WorkflowGlyphProps {
  triggerType: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PAUSED' | 'DRAFT';
  size?: number;
}

function renderIcon(triggerType: string, size: number) {
  const props = { size, strokeWidth: 1.8 };

  if (triggerType.includes('webhook')) return <Webhook {...props} />;
  if (triggerType.includes('schedule')) return <Clock3 {...props} />;
  if (triggerType.includes('telegram')) return <Send {...props} />;
  if (triggerType.includes('database')) return <Database {...props} />;
  if (triggerType.includes('manual')) return <MousePointerClick {...props} />;
  return <Workflow {...props} />;
}

function triggerTone(triggerType: string) {
  if (triggerType.includes('webhook')) return 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300';
  if (triggerType.includes('schedule')) return 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300';
  if (triggerType.includes('telegram')) return 'border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300';
  if (triggerType.includes('database')) return 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300';
  return 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300';
}

export function WorkflowGlyph({ triggerType, status, size = 17 }: WorkflowGlyphProps) {
  const tone =
    status === 'FAILED'
      ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-400'
      : status === 'RUNNING'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-400'
        : triggerTone(triggerType);

  return (
    <span
      data-testid="workflow-glyph"
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tone}`}
    >
      {renderIcon(triggerType, size)}
    </span>
  );
}
