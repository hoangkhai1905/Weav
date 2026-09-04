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

export function WorkflowGlyph({ triggerType, status, size = 17 }: WorkflowGlyphProps) {
  const tone =
    status === 'FAILED'
      ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-400'
      : status === 'RUNNING'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-400'
        : 'border-border bg-muted/70 text-foreground';

  return (
    <span
      data-testid="workflow-glyph"
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${tone}`}
    >
      {renderIcon(triggerType, size)}
    </span>
  );
}
