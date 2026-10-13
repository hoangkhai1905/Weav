// Pure helpers (no react-native import) so Node tests can load them.

export type MainTab = 'home' | 'workflows' | 'executions' | 'profile';

export const MAIN_TABS: readonly { key: MainTab; href: string; labelKey: string }[] = [
  { key: 'home', href: '/(app)/(tabs)', labelKey: 'tab.home' },
  { key: 'workflows', href: '/(app)/(tabs)/workflows', labelKey: 'tab.workflows' },
  { key: 'executions', href: '/(app)/(tabs)/executions', labelKey: 'tab.executions' },
  { key: 'profile', href: '/(app)/(tabs)/profile', labelKey: 'tab.profile' },
];

const PREFIXES: readonly (readonly [string, MainTab])[] = [
  ['/workflows', 'workflows'],
  ['/templates', 'workflows'],
  ['/executions', 'executions'],
  ['/profile', 'profile'],
  ['/settings', 'profile'],
  ['/connections', 'profile'],
  ['/workspace', 'profile'],
  ['/invitations', 'profile'],
  ['/assistant', 'profile'],
];

const clean = (pathname: string) => (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Which bottom tab a route belongs to; null for routes that highlight none (e.g. notifications). */
export function activeTab(pathname: string): MainTab | null {
  const path = clean(pathname);
  if (path === '/' || path === '/index') return 'home';
  return PREFIXES.find(([prefix]) => isUnder(path, prefix))?.[1] ?? null;
}

/** Full-screen composers keep the keyboard area to themselves. */
export function tabBarHidden(pathname: string): boolean {
  const path = clean(pathname);
  return isUnder(path, '/ai') || path === '/assistant/chat';
}
