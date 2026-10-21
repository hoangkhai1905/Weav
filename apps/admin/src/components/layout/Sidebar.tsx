import { NavLink } from 'react-router-dom';
import { Building2, History, LayoutDashboard, LayoutTemplate, Server, Users } from 'lucide-react';
import { useT } from '../../lib/i18n';

const NAV_ITEMS = [
  { slug: 'overview', path: '/', icon: LayoutDashboard },
  { slug: 'users', path: '/users', icon: Users },
  { slug: 'workspaces', path: '/workspaces', icon: Building2 },
  { slug: 'executions', path: '/executions', icon: History },
  { slug: 'templates', path: '/templates', icon: LayoutTemplate },
  { slug: 'system', path: '/system', icon: Server },
] as const;

export function Sidebar() {
  const t = useT();
  return (
    <aside className="flex w-14 shrink-0 flex-col gap-1 border-r border-border bg-sidebar px-2 py-3 text-sidebar-foreground md:w-56 md:px-3">
      <div className="mb-3 flex h-9 items-center justify-center px-1 text-sm font-semibold md:justify-start">
        <span className="md:hidden" aria-hidden="true">W</span>
        <span className="hidden md:inline">{t('brand.name')}</span>
      </div>
      <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ slug, path, icon: Icon }) => (
          <NavLink
            key={slug}
            to={path}
            end={path === '/'}
            data-testid={`nav-${slug}`}
            title={t(`nav.${slug}`)}
            aria-label={t(`nav.${slug}`)}
            className={({ isActive }) =>
              `flex h-9 items-center justify-center gap-2.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:justify-start md:px-3 ${
                isActive ? 'bg-sidebar-active text-foreground' : 'text-text-2 hover:bg-muted hover:text-foreground'
              }`
            }
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden md:inline">{t(`nav.${slug}`)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
