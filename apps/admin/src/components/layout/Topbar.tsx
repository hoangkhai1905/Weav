import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { logout } from '../../api/auth';
import { useT } from '../../lib/i18n';
import { getProfile } from '../../lib/session';
import { iconBtnCls } from '../../lib/ui';
import { LanguageSwitch, ThemeToggle } from './ShellControls';

const SLUGS = ['users', 'workspaces', 'executions', 'templates', 'system'];

export function Topbar() {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const segment = pathname.split('/')[1] ?? '';
  const slug = segment === '' ? 'overview' : SLUGS.includes(segment) ? segment : 'notfound';
  const name = getProfile()?.displayName?.trim() || getProfile()?.email || '';

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-1.5 text-sm text-text-2">
        <span className="hidden sm:inline">{t('topbar.home')}</span>
        <span aria-hidden="true" className="hidden text-muted-foreground/60 sm:inline">/</span>
        <span data-testid="breadcrumb-current" className="truncate font-medium text-foreground">
          {t(`nav.${slug}`)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <LanguageSwitch />
        <ThemeToggle />
        <span className="hidden max-w-[180px] truncate px-1 text-[13px] text-text-2 sm:inline" title={name}>{name}</span>
        <button type="button" onClick={signOut} className={iconBtnCls} title={t('topbar.sign_out')} aria-label={t('topbar.sign_out')}>
          <LogOut size={18} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
