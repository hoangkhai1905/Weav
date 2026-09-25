import { useEffect, useState } from 'react';
import { Send, Unlink, Bot, Terminal, Activity } from 'lucide-react';
import type { TelegramStatus } from '../api/telegram.api';
import { telegramApi } from '../api/telegram.api';
import { useI18nStore } from '../store/useI18nStore';

const TELEGRAM_ACTIVITY_KEYS: Record<string, string> = {
  'Command /run wf-001 executed by @truong_dev': 'telegram.log.run_executed',
  'Bot reply: Workflow execution started (ID: exec-101)': 'telegram.log.bot_reply',
  'Automated alert sent to @weav_exec_team': 'telegram.log.alert_sent',
};

export function TelegramPage() {
  const { t } = useI18nStore();
  const [status, setStatus] = useState<TelegramStatus | null>(null);

  useEffect(() => {
    telegramApi.getStatus().then((data) => {
      setStatus(data);
    });
  }, []);

  if (!status) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">{t('telegram.loading')}</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          {t('telegram.title')} <Send size={20} className="text-sky-500" />
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('telegram.subtitle')}</p>
      </div>

      {/* Connection Card (n8n Style) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm dark:shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-500 flex items-center justify-center shrink-0">
            <Bot size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-900 dark:text-slate-100 text-base">{status.botUsername}</h2>
              <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {t('telegram.connected')}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('telegram.linked_account')} <span className="text-slate-900 dark:text-slate-200 font-semibold">{status.linkedAccount}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert(t('telegram.unlink_confirmation'))}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Unlink size={15} />
            <span>{t('telegram.unlink')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Commands Catalog */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm dark:shadow-xl space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Terminal size={16} className="text-blue-500" /> {t('telegram.commands')}
          </h3>

          <div className="space-y-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">/list</div>
              <p className="text-xs text-slate-700 dark:text-slate-300">{t('telegram.command.list')}</p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">/status &lt;executionId&gt;</div>
              <p className="text-xs text-slate-700 dark:text-slate-300">{t('telegram.command.status')}</p>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
              <div className="font-mono text-xs text-blue-600 dark:text-blue-400 font-bold">/run &lt;workflowId&gt;</div>
              <p className="text-xs text-slate-700 dark:text-slate-300">{t('telegram.command.run')}</p>
            </div>
          </div>
        </div>

        {/* Live Activity Stream */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm dark:shadow-xl space-y-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Activity size={16} className="text-amber-500" /> {t('telegram.activity_feed')}
          </h3>

          <div className="space-y-2">
            {status.activityLogs.map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                  <span>{log.timestamp}</span>
                  <span className={log.direction === 'INCOMING' ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-blue-600 dark:text-blue-400 font-bold'}>
                    {log.direction === 'INCOMING' ? t('telegram.direction.incoming') : t('telegram.direction.outgoing')}
                  </span>
                </div>
                <div className="text-slate-900 dark:text-slate-200 font-semibold">
                  {TELEGRAM_ACTIVITY_KEYS[log.message] ? t(TELEGRAM_ACTIVITY_KEYS[log.message]) : log.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
