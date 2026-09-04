import { useEffect, useState, useCallback } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import type { NotificationItem } from '../types/workflow.types';
import { notificationApi } from '../api/notification.api';
import { useI18nStore } from '../store/useI18nStore';

export function NotificationsPage() {
  const { t } = useI18nStore();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const fetchNotifs = useCallback(async () => {
    try {
      const data = await notificationApi.getNotifications();
      setNotifications(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchNotifs();
    });
  }, [fetchNotifs]);

  const handleMarkRead = async (id: string) => {
    await notificationApi.markAsRead(id);
    fetchNotifs();
  };

  const handleMarkAllRead = async () => {
    await notificationApi.markAllAsRead();
    fetchNotifs();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            {t('nav.notifications')} <Bell size={20} className="text-rose-500" />
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400">Execution alerts, system notices, and integration updates.</p>
        </div>

        <button
          onClick={handleMarkAllRead}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs font-bold transition-all cursor-pointer"
        >
          <CheckCheck size={15} />
          <span>Mark All Read</span>
        </button>
      </div>

      <div className="space-y-3">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 ${
              notif.read
                ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 border-l-4 border-l-rose-500 text-slate-900 dark:text-slate-100 shadow-sm'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900 dark:text-slate-100">{notif.title}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{new Date(notif.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300">{notif.message}</p>
            </div>

            {!notif.read && (
              <button
                onClick={() => handleMarkRead(notif.id)}
                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer shrink-0"
                title="Mark as Read"
              >
                <Check size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
