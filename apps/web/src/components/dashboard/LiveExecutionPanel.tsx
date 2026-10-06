import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Webhook, Cpu, Bell } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

export const LiveExecutionPanel: React.FC = () => {
  const { t } = useI18nStore();
  return (
    <div className="bg-card border border-border rounded-lg p-4 sm:p-5 flex flex-col justify-between shadow-2xs h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground tracking-tight">
              {t('dashboard.live_execution')}
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-run-bg text-run font-semibold text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              {t('dashboard.running')}
            </span>
          </div>
          <span className="font-mono text-xs text-muted-foreground truncate mt-0.5">
            Order processing & notification #EX-8492
          </span>
        </div>

        <button
          aria-label={t('dashboard.workflow_logs')}
          className="p-1.5 rounded-md text-muted-foreground hover:text-text-2 hover:bg-subtle transition-colors"
          title={t('dashboard.workflow_logs')}
        >
          <Terminal size={16} />
        </button>
      </div>

      {/* Technical Node Graph Canvas Area */}
      <div className="relative bg-subtle border border-border rounded-lg p-4 my-2 overflow-hidden">
        {/* Node Icon Row & Centerline Connector (Exact 20px horizontal centerline anchor) */}
        <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-1 relative z-10">
          {/* Node 1 Icon: Webhook (Complete) */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-lg bg-card border border-border shadow-2xs flex items-center justify-center text-ok relative">
              <Webhook size={18} />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-ok text-background flex items-center justify-center text-[9px] font-bold">
                ✓
              </span>
            </div>
          </div>

          {/* Connector 1: Active Animated Packet Line (Exact Centerline) */}
          <div className="w-full px-1 flex items-center h-10">
            <svg className="w-full h-3 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 12">
              <line x1="0" y1="6" x2="100" y2="6" stroke="#4f8cff" strokeDasharray="3 3" strokeWidth="2" />
              <motion.circle
                cy="6"
                r="3.5"
                fill="#2563eb"
                animate={{ cx: [5, 95] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </svg>
          </div>

          {/* Node 2 Icon: AI Processing (Active) */}
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 rounded-lg bg-card border-2 border-run/30 shadow-2xs flex items-center justify-center text-run relative">
              <Cpu size={18} className="animate-spin" style={{ animationDuration: '3s' }} />
              <span className="absolute -inset-1 rounded-lg bg-run-bg animate-pulse -z-10" />
            </div>
          </div>

          {/* Connector 2: Queued Line (Exact Centerline) */}
          <div className="w-full px-1 flex items-center h-10">
            <svg className="w-full h-3 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 12">
              <line x1="0" y1="6" x2="100" y2="6" stroke="#94a3b8" strokeDasharray="2 2" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Node 3 Icon: Send Notification (Pending) */}
          <div className="flex flex-col items-center opacity-70">
            <div className="w-10 h-10 rounded-lg bg-card border border-border shadow-2xs flex items-center justify-center text-muted-foreground">
              <Bell size={18} />
            </div>
          </div>
        </div>

        {/* Node Labels Row (Independent from Centerline Connector Anchor) */}
        <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-start gap-1 mt-2 text-center">
          <div className="flex flex-col items-center min-w-[70px] -ml-3">
            <span className="text-xs font-semibold text-foreground">{t('dashboard.webhook')}</span>
            <span className="font-mono text-[10px] text-ok font-medium">200 OK</span>
          </div>
          <div />
          <div className="flex flex-col items-center min-w-[80px] -ml-4">
            <span className="text-xs font-bold text-run">AI Extract</span>
            <span className="font-mono text-[10px] text-run font-medium">{t('dashboard.parsing')}</span>
          </div>
          <div />
          <div className="flex flex-col items-center min-w-[70px] -ml-3 opacity-70">
            <span className="text-xs font-medium text-muted-foreground">{t('dashboard.notify')}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{t('dashboard.queued')}</span>
          </div>
        </div>
      </div>

      {/* Micro Live Console Terminal */}
      <div className="bg-subtle text-foreground rounded-md p-2.5 flex flex-col gap-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-ok font-bold">●</span>
          <span className="text-muted-foreground">[10:42:15]</span>
          <span className="truncate">{t('dashboard.payload_received')}</span>
        </div>
        <div className="flex items-center gap-2 text-run">
          <span className="text-run font-bold">▶</span>
          <span className="text-muted-foreground">[10:42:16]</span>
          <span className="truncate">{t('dashboard.invoking_model')}</span>
        </div>
      </div>
    </div>
  );
};
