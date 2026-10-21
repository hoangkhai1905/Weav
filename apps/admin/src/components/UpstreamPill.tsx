import type { UpstreamState } from '../api/health';
import { useT } from '../lib/i18n';
import { statusBadgeClass } from '../lib/ui';

export function UpstreamPill({ state }: { state: UpstreamState }) {
  const t = useT();
  return <span className={statusBadgeClass(state === 'up' ? 'ok' : 'err')}>{state === 'up' ? t('sys.up') : t('sys.down')}</span>;
}
