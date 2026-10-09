import type { ReactNode } from 'react';
import { nodeLabel } from '../../lib/nodeLabels';
import { useI18nStore } from '../../store/useI18nStore';
import type { TemplateSummary } from '../../api/templates.api';
import { nodeDot } from './templateStyles';

interface TemplateCardProps {
  template: TemplateSummary;
  /** Opens the preview; the whole title is the trigger so the card stays one tab stop. */
  onOpen: () => void;
  actions?: ReactNode;
}

export function TemplateCard({ template, onOpen, actions }: TemplateCardProps) {
  const { t } = useI18nStore();
  return (
    <div
      data-testid={`shared-template-${template.id}`}
      className="flex flex-col justify-between rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/25"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-0.5 font-medium">{t(`tpl.visibility.${template.visibility}`)}</span>
          <span className="font-mono">{t('tpl.used_count').replace('{n}', String(template.usageCount))}</span>
        </div>
        <h4 className="pt-1 text-sm font-semibold text-foreground">
          <button type="button" onClick={onOpen} className="text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {template.name}
          </button>
        </h4>
        {template.authorName ? (
          <p className="text-[11px] text-muted-foreground">{t('tpl.by_author').replace('{name}', template.authorName)}</p>
        ) : null}
        {template.description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{template.description}</p>
        ) : null}
        <div className="my-3 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-2 font-mono text-[10px] text-foreground/80">
          {template.nodeTypes.map((type) => (
            <span key={type} className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${nodeDot(type)}`} />
              <span className="max-w-[80px] truncate">{nodeLabel(type, t)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {actions}
      </div>
    </div>
  );
}
