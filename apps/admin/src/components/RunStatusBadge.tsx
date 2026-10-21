import { useT } from '../lib/i18n';
import { statusTone } from '../lib/executions';
import { statusBadgeClass } from '../lib/ui';

/** Pill for a run or step status; the label is plain words, the colour carries the meaning. */
export function RunStatusBadge({ status }: { status: string }) {
  const t = useT();
  const key = `run.status.${status}`;
  const label = t(key);
  return <span className={statusBadgeClass(statusTone(status))}>{label === key ? status : label}</span>;
}
