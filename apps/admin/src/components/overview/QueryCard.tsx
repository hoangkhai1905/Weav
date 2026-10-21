import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { CARD } from '../../lib/ui';

interface BodyProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}

/** Loading spinner, own error with Retry, or the content: one failing call never blanks the page. */
export function QueryBody<T>({ query, children }: BodyProps<T>) {
  const t = useT();
  if (query.isError) {
    return (
      <div role="alert" className="flex items-start gap-2 text-xs text-err">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{t('overview.load_error')}</span>
        <button type="button" className="font-medium underline" onClick={() => void query.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  if (query.data === undefined) return <LoaderCircle size={18} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />;
  return <>{children(query.data)}</>;
}

export function QueryCard<T>({ title, testId, query, children }: BodyProps<T> & { title: string; testId: string }) {
  return (
    <section data-testid={testId} className={`${CARD} p-4`}>
      <h2 className="text-[13px] text-muted-foreground">{title}</h2>
      <div className="mt-1">
        <QueryBody query={query}>{children}</QueryBody>
      </div>
    </section>
  );
}
