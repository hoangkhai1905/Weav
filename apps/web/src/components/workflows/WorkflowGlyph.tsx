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

export function WorkflowGlyph({ triggerType, status, size = 14 }: WorkflowGlyphProps) {
  const tone = status === 'FAILED' ? 'text-err' : status === 'RUNNING' ? 'text-run' : 'text-muted-foreground';

  return (
    <span
      data-testid="workflow-glyph"
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted ${tone}`}
    >
      {renderIcon(triggerType, size)}
    </span>
  );
}
