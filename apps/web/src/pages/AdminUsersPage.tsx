import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { LoaderCircle, Users } from 'lucide-react';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { adminApi, type AdminUser, type AdminUserPage, type AdminUserStatus } from '../api/admin.api';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';

/** System administration: list accounts and enable/disable them. Reachable only for systemRole=ADMIN. */
export function AdminUsersPage() {
  const { user, isAuthenticated } = useAuthStore();
  const { t } = useI18nStore();
  const [page, setPage] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminUserStatus | ''>('');
  const [data, setData] = useState<AdminUserPage | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDisable, setPendingDisable] = useState<AdminUser | null>(null);
  const isAdmin = user?.systemRole === 'ADMIN';

  const queryKey = `${page}|${search}|${status}`;
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    adminApi.listUsers({ page, search, status: status || undefined }).then(
      (result) => { if (active) { setData(result); setError(''); setLoadedKey(queryKey); } },
      () => { if (active) { setError(t('w5c.admin_load_error')); setLoadedKey(queryKey); } },
    );
    return () => { active = false; };
  }, [isAdmin, page, search, status, queryKey, t]);

  if (isAuthenticated && !user) return null; // profile still loading
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setSearch(searchDraft.trim());
  };

  const toggle = async (target: AdminUser) => {
    setBusyId(target.id);
    setError('');
    try {
      const updated = await adminApi.changeStatus(target.id, target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
      setData((current) => current && { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) });
    } catch {
      setError(t('w5c.admin_status_error'));
    } finally {
      setBusyId(null);
    }
  };

  const field = 'rounded-xl border border-border bg-subtle px-3 py-2 text-xs text-foreground outline-none focus:border-run/30 focus:ring-2 focus:ring-run/30';

  return (
    <div data-testid="admin-users-page" className="mx-auto max-w-5xl space-y-4 pb-10">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg border border-run/30 bg-run-bg text-run"><Users size={17} aria-hidden="true" /></span>
        <h1 className="text-xl font-bold text-foreground">{t('w5c.admin_users')}</h1>
      </div>
      <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="admin-search">{t('w5c.admin_search')}</label>
        <input id="admin-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('w5c.admin_search')} maxLength={64} className={`${field} min-w-0 flex-1`} />
        <label className="sr-only" htmlFor="admin-status">{t('w5c.admin_status')}</label>
        <select id="admin-status" value={status} onChange={(event) => { setPage(0); setStatus(event.target.value as AdminUserStatus | ''); }} className={field}>
          <option value="">{t('w5c.admin_all')}</option>
          <option value="ACTIVE">{t('settings.status_active')}</option>
          <option value="DISABLED">{t('settings.status_disabled')}</option>
        </select>
        <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white">{t('w5c.admin_search_button')}</button>
      </form>
      {error && <p role="alert" className="text-xs font-medium text-err">{error}</p>}
      {loading && !data && <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />{t('settings.loading')}</p>}
      {data && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr><th className="px-4 py-3">{t('auth.full_name')}</th><th className="px-4 py-3">{t('settings.email')}</th><th className="px-4 py-3">{t('settings.role')}</th><th className="px-4 py-3">{t('w5c.admin_status')}</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} data-testid="admin-user-row" className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-semibold text-foreground">{item.displayName || '—'}</td>
                  <td className="px-4 py-3 text-text-2">{item.email}</td>
                  <td className="px-4 py-3">{item.systemRole === 'ADMIN' ? t('settings.role_admin') : t('settings.role_user')}</td>
                  <td className={`px-4 py-3 font-semibold ${item.status === 'ACTIVE' ? 'text-ok' : 'text-warn'}`}>{item.status === 'ACTIVE' ? t('settings.status_active') : t('settings.status_disabled')}</td>
                  <td className="px-4 py-3 text-right">
                    {item.id !== user?.id && item.systemRole !== 'ADMIN' && (
                      <button type="button" data-testid={`admin-toggle-${item.id}`} disabled={busyId === item.id} onClick={() => (item.status === 'ACTIVE' ? setPendingDisable(item) : void toggle(item))} className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-run hover:bg-run-bg disabled:opacity-60">
                        {item.status === 'ACTIVE' ? t('w5c.admin_disable') : t('w5c.admin_enable')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('w5c.admin_empty')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button type="button" disabled={page <= 0 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border border-border px-2.5 py-1.5 font-semibold disabled:opacity-50">{t('settings.previous_page')}</button>
          <span>{page + 1} / {data.totalPages}</span>
          <button type="button" disabled={page >= data.totalPages - 1 || loading} onClick={() => setPage(page + 1)} className="rounded-lg border border-border px-2.5 py-1.5 font-semibold disabled:opacity-50">{t('settings.next_page')}</button>
        </div>
      )}
      <ConfirmModal
        isOpen={pendingDisable !== null}
        onClose={() => setPendingDisable(null)}
        onConfirm={async () => {
          const target = pendingDisable;
          setPendingDisable(null);
          if (target) await toggle(target);
        }}
        title={t('w5c.admin_disable')}
        description={t('w5c.admin_disable_confirm')}
        confirmText={t('w5c.admin_disable')}
        cancelText={t('settings.cancel')}
        variant="danger"
      />
    </div>
  );
}
