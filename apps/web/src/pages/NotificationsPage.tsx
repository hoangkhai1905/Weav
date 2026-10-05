import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, ExternalLink, RefreshCw, LoaderCircle } from 'lucide-react';
import {
  useNotifications,
  useNotificationUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../hooks/useNotifications';
import { useNotificationTargetNavigator } from '../hooks/useNotificationTargetNavigator';
import { useI18nStore } from '../store/useI18nStore';
import type { NotificationCategory } from '../types/notification.types';

const CATEGORIES: Exclude<NotificationCategory, 'UNKNOWN'>[] = [
  'WORKFLOW', 'WORKSPACE', 'CONNECTION', 'SECURITY',
];

export function NotificationsPage() {
  const { t, language } = useI18nStore();
  const locale = language === 'VI' ? 'vi' : 'en';
  const [category, setCategory] = useState<Exclude<NotificationCategory, 'UNKNOWN'> | ''>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = useNotifications({
    ...(category ? { category } : {}),
    ...(unreadOnly ? { unreadOnly: true } : {}),
    locale,
  });
  const unread = useNotificationUnreadCount();
  const markRead = useMarkNotificationRead(locale);
  const markAllRead = useMarkAllNotificationsRead();
  const openTarget = useNotificationTargetNavigator();
  const mutationInFlight = useRef(false);
  const notifications = inbox.data ?? [];
  const updating = markRead.isPending || markAllRead.isPending;
  const busy = inbox.isFetching || unread.isFetching;
  const buttonClass =
    'flex items-center justify-center gap-1.5 px-3 py-1.5 bg-subtle hover:bg-muted text-foreground border border-border rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const refresh = () => {
    void inbox.refetch();
    void unread.refetch();
  };
  const handleMarkRead = (id: string) => {
    if (mutationInFlight.current || updating) return;
    mutationInFlight.current = true;
    markAllRead.reset();
    markRead.mutate(id, { onSettled: () => { mutationInFlight.current = false; } });
  };
  const handleMarkAllRead = () => {
    if (mutationInFlight.current || updating) return;
    mutationInFlight.current = true;
    markRead.reset();
    markAllRead.mutate(undefined, { onSettled: () => { mutationInFlight.current = false; } });
  };
  const retryUpdate = () => {
    if (markRead.isError && markRead.variables) handleMarkRead(markRead.variables);
    else handleMarkAllRead();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            {t('nav.notifications')} <Bell size={20} className="text-err" />
            {unread.data !== undefined && (
              <span className="rounded-full bg-err-bg px-2 py-1 text-xs text-err">
                {unread.data} {t('notif.unread')}
              </span>
            )}
          </h1>
          <p className="text-xs text-text-2">{t('notif.subtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={inbox.authRequired || busy || updating} onClick={refresh} className={buttonClass}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
            {t('notif.refresh')}
          </button>
          <button
            type="button"
            disabled={inbox.authRequired || updating || unread.data === 0 || inbox.isLoading}
            onClick={handleMarkAllRead}
            className={buttonClass}
          >
            {markAllRead.isPending ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <CheckCheck size={15} aria-hidden="true" />}
            <span>{t('notif.mark_all_read')}</span>
          </button>
        </div>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">{t('notif.mark_all_read_scope')}</p>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <span>{t('notif.category_filter')}</span>
          <select
            aria-label={t('notif.category_filter')}
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t('notif.category.all')}</option>
            {CATEGORIES.map((value) => <option key={value} value={value}>{t(`notif.category.${value}`)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          <input
            type="checkbox"
            aria-label={t('notif.unread_only')}
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {t('notif.unread_only')}
        </label>
      </div>

      {inbox.authRequired ? (
        <div role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <p>{t('notif.sign_in_required')}</p>
          <Link to="/login" className="mt-3 inline-block font-semibold text-primary underline">{t('notif.sign_in')}</Link>
        </div>
      ) : (
        <>
          {(markRead.isError || markAllRead.isError) && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-err-bg p-3 text-sm text-err">
              <span>{t('notif.update_error')}</span>
              <button type="button" disabled={updating} onClick={retryUpdate} className={buttonClass}>{t('notif.retry')}</button>
            </div>
          )}
          {((inbox.isError && !inbox.isFetchNextPageError) || unread.isError) && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-err-bg p-3 text-sm text-err">
              <span>{t(inbox.isError ? 'notif.error' : 'notif.count_error')}</span>
              <button type="button" disabled={busy || updating} onClick={refresh} className={buttonClass}>{t('notif.retry')}</button>
            </div>
          )}
          {inbox.isLoading && (
            <div role="status" className="flex justify-center items-center gap-2 py-16 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />{t('notif.loading')}
            </div>
          )}
          {!inbox.isLoading && !inbox.isError && notifications.length === 0 && (
            <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-16 text-muted-foreground">
              <Bell size={32} aria-hidden="true" /><p className="text-sm">{t('notif.empty')}</p>
            </div>
          )}
          <div className="space-y-3" aria-busy={inbox.isFetching}>
            {notifications.map((notif) => {
              const isRead = notif.readAt !== null;
              const canNavigate = notif.target.kind !== 'NONE' && notif.target.kind !== 'UNKNOWN' && notif.eventType !== 'workspace.member_removed';
              return (
                <article
                  key={notif.id}
                  className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 ${
                    isRead
                      ? 'bg-card border-border text-text-2'
                      : 'bg-card border-border border-l-4 border-l-err-border text-foreground'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-foreground">{notif.title}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t(`notif.category.${notif.category}`)}</span>
                      {notif.severity === 'UNKNOWN' && <span className="text-[10px] text-muted-foreground">{t('notif.severity_unknown')}</span>}
                      <time dateTime={notif.createdAt} className="text-[10px] text-muted-foreground font-mono">
                        {new Date(notif.occurredAt).toLocaleString(language === 'VI' ? 'vi-VN' : 'en-US')}
                      </time>
                    </div>
                    <p className="text-xs text-text-2 whitespace-pre-wrap break-words">{notif.message}</p>
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                      <span title={notif.readAt ? new Date(notif.readAt).toLocaleString(language === 'VI' ? 'vi-VN' : 'en-US') : undefined}>
                        {t(isRead ? 'notif.read' : 'notif.unread')}
                      </span>
                      {canNavigate && (
                        <button
                          type="button"
                          onClick={() => void openTarget(notif)}
                          className="inline-flex items-center gap-1 text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${t('notif.open_target')}: ${notif.title}`}
                        >
                          <ExternalLink size={12} aria-hidden="true" />{t('notif.open_target')}
                        </button>
                      )}
                    </div>
                  </div>

                  {!isRead && (
                    <button
                      type="button"
                      disabled={updating}
                      onClick={() => handleMarkRead(notif.id)}
                      className="p-1.5 rounded-lg bg-err-bg hover:bg-err-bg text-err transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={t('notif.mark_read')}
                      aria-label={`${t('notif.mark_read')}: ${notif.title}`}
                    >
                      {markRead.isPending && markRead.variables === notif.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {inbox.hasNextPage && (
            <div className="flex flex-col items-center gap-3">
              {inbox.isFetchNextPageError && <p role="alert" className="text-sm text-err">{t('notif.error')}</p>}
              <button type="button" disabled={inbox.isFetching || updating} onClick={() => void inbox.fetchNextPage()} className={buttonClass}>
                {inbox.isFetchingNextPage && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                {t(inbox.isFetchNextPageError ? 'notif.retry' : 'notif.more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
