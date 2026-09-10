import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, RefreshCw, LoaderCircle } from 'lucide-react';
import {
  useNotifications,
  useNotificationUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../hooks/useNotifications';
import { useI18nStore } from '../store/useI18nStore';

export function NotificationsPage() {
  const { t, language } = useI18nStore();
  const inbox = useNotifications();
  const unread = useNotificationUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const notifications = inbox.data ?? [];
  const updating = markRead.isPending || markAllRead.isPending;
  const busy = inbox.isFetching || unread.isFetching;
  const buttonClass =
    'flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const refresh = () => {
    void inbox.refetch();
    void unread.refetch();
  };
  const handleMarkRead = (id: string) => {
    markAllRead.reset();
    markRead.mutate(id);
  };
  const handleMarkAllRead = () => {
    markRead.reset();
    markAllRead.mutate();
  };
  const retryUpdate = () => {
    if (markRead.isError && markRead.variables)
      handleMarkRead(markRead.variables);
    else handleMarkAllRead();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            {t('nav.notifications')}{' '}
            <Bell size={20} className="text-rose-500" />
            {unread.data !== undefined && (
              <span className="rounded-full bg-rose-500/10 px-2 py-1 text-xs text-rose-600 dark:text-rose-400">
                {unread.data} {t('notif.unread')}
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('notif.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={inbox.authRequired || busy || updating}
            onClick={refresh}
            className={buttonClass}
          >
            <RefreshCw
              size={15}
              className={busy ? 'animate-spin' : ''}
              aria-hidden="true"
            />
            {t('notif.refresh')}
          </button>
          <button
            type="button"
            disabled={
              inbox.authRequired ||
              updating ||
              unread.data === 0 ||
              inbox.isLoading
            }
            onClick={handleMarkAllRead}
            className={buttonClass}
          >
            {markAllRead.isPending ? (
              <LoaderCircle
                size={15}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <CheckCheck size={15} aria-hidden="true" />
            )}
            <span>{t('notif.mark_all_read')}</span>
          </button>
        </div>
      </div>

      {inbox.authRequired ? (
        <div
          role="status"
          className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          <p>{t('notif.sign_in_required')}</p>
          <Link
            to="/login"
            className="mt-3 inline-block font-semibold text-primary underline"
          >
            {t('notif.sign_in')}
          </Link>
        </div>
      ) : (
        <>
          {(markRead.isError || markAllRead.isError) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400"
            >
              <span>{t('notif.update_error')}</span>
              <button
                type="button"
                disabled={updating}
                onClick={retryUpdate}
                className={buttonClass}
              >
                {t('notif.retry')}
              </button>
            </div>
          )}
          {((inbox.isError && !inbox.isFetchNextPageError) ||
            unread.isError) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400"
            >
              <span>
                {t(inbox.isError ? 'notif.error' : 'notif.count_error')}
              </span>
              <button
                type="button"
                disabled={busy || updating}
                onClick={refresh}
                className={buttonClass}
              >
                {t('notif.retry')}
              </button>
            </div>
          )}
          {inbox.isLoading && (
            <div
              role="status"
              className="flex justify-center items-center gap-2 py-16 text-sm text-muted-foreground"
            >
              <LoaderCircle
                className="animate-spin"
                size={20}
                aria-hidden="true"
              />
              {t('notif.loading')}
            </div>
          )}
          {!inbox.isLoading && !inbox.isError && notifications.length === 0 && (
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-16 text-muted-foreground"
            >
              <Bell size={32} aria-hidden="true" />
              <p className="text-sm">{t('notif.empty')}</p>
            </div>
          )}
          <div className="space-y-3" aria-busy={inbox.isFetching}>
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 ${
                  notif.read
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 border-l-4 border-l-rose-500 text-slate-900 dark:text-slate-100 shadow-sm'
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {notif.title}
                    </span>
                    <time
                      dateTime={notif.createdAt ?? notif.timestamp}
                      className="text-[10px] text-slate-500 dark:text-slate-400 font-mono"
                    >
                      {Number.isNaN(Date.parse(notif.timestamp))
                        ? notif.timestamp
                        : new Date(notif.timestamp).toLocaleString(
                            language === 'VI' ? 'vi-VN' : 'en-US',
                          )}
                    </time>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                    {notif.message}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                    <span
                      title={
                        notif.readAt
                          ? new Date(notif.readAt).toLocaleString(
                              language === 'VI' ? 'vi-VN' : 'en-US',
                            )
                          : undefined
                      }
                    >
                      {t(notif.read ? 'notif.read' : 'notif.unread')}
                    </span>
                    {notif.status && (
                      <span
                        className={
                          notif.status === 'FAILED'
                            ? 'text-rose-600 dark:text-rose-400'
                            : ''
                        }
                      >
                        {t(`notif.${notif.status.toLowerCase()}`)}
                      </span>
                    )}
                    {notif.link?.startsWith('/executions/') && (
                      <Link to={notif.link} className="text-primary underline">
                        {t('notif.execution')}
                      </Link>
                    )}
                  </div>
                </div>

                {!notif.read && (
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => handleMarkRead(notif.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={t('notif.mark_read')}
                    aria-label={`${t('notif.mark_read')}: ${notif.title}`}
                  >
                    {markRead.isPending && markRead.variables === notif.id ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
          {inbox.hasNextPage && (
            <div className="flex flex-col items-center gap-3">
              {inbox.isFetchNextPageError && (
                <p
                  role="alert"
                  className="text-sm text-rose-600 dark:text-rose-400"
                >
                  {t('notif.error')}
                </p>
              )}
              <button
                type="button"
                disabled={inbox.isFetching || updating}
                onClick={() => void inbox.fetchNextPage()}
                className={buttonClass}
              >
                {inbox.isFetchingNextPage && (
                  <LoaderCircle
                    size={15}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                )}
                {t(inbox.isFetchNextPageError ? 'notif.retry' : 'notif.more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
