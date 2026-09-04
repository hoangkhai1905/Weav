import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, Webhook, Cpu, Bell } from 'lucide-react';

export const LiveExecutionPanel: React.FC = () => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 sm:p-5 flex flex-col justify-between shadow-2xs h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Live execution
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-semibold text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
              Running
            </span>
          </div>
          <span className="font-mono text-xs text-slate-500 truncate mt-0.5">
            Order processing & notification #EX-8492
          </span>
        </div>

        <button
          aria-label="Workflow logs"
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Terminal Logs"
        >
          <Terminal size={16} />
        </button>
      </div>

      {/* Technical Node Graph Canvas Area */}
      <div className="relative bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800/80 rounded-lg p-4 my-2 overflow-hidden">
        <div className="flex items-center justify-between relative z-10">
          {/* Node 1: Webhook (Complete) */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xs flex items-center justify-center text-emerald-600 dark:text-emerald-400 relative">
              <Webhook size={18} />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold">
                ✓
              </span>
            </div>
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Webhook
            </span>
            <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              200 OK
            </span>
          </div>

          {/* Connector 1 (With animated SVG Packet) */}
          <div className="flex-1 px-1 relative h-6 flex items-center">
            <svg className="w-full h-3 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 12">
              <line x1="0" y1="6" x2="100" y2="6" stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth="2" />
              <motion.circle
                cy="6"
                r="3"
                fill="#2563eb"
                animate={{ cx: [5, 95] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </svg>
          </div>

          {/* Node 2: AI Processing (Active executing node) */}
          <div className="flex flex-col items-center gap-1 relative">
            <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border-2 border-blue-600 shadow-2xs flex items-center justify-center text-blue-600 dark:text-blue-400 relative">
              <Cpu size={18} className="animate-spin" style={{ animationDuration: '3s' }} />
              <span className="absolute -inset-1 rounded-lg bg-blue-600/10 animate-pulse -z-10" />
            </div>
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
              AI Extract
            </span>
            <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              parsing...
            </span>
          </div>

          {/* Connector 2 (Queued line) */}
          <div className="flex-1 px-1 relative h-6 flex items-center">
            <svg className="w-full h-3 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 12">
              <line x1="0" y1="6" x2="100" y2="6" stroke="#cbd5e1" strokeDasharray="2 2" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Node 3: Send Notification (Pending) */}
          <div className="flex flex-col items-center gap-1 opacity-70">
            <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xs flex items-center justify-center text-slate-400">
              <Bell size={18} />
            </div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Notify
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              queued
            </span>
          </div>
        </div>
      </div>

      {/* Micro Live Console Terminal */}
      <div className="bg-slate-900 text-slate-100 rounded-md p-2.5 flex flex-col gap-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="text-emerald-400 font-bold">●</span>
          <span className="text-slate-400">[10:42:15]</span>
          <span className="truncate">Webhook payload received (2.4KB JSON)</span>
        </div>
        <div className="flex items-center gap-2 text-blue-300">
          <span className="text-blue-400 font-bold">▶</span>
          <span className="text-slate-400">[10:42:16]</span>
          <span className="truncate">Invoking model: extract customer & invoice schema</span>
        </div>
      </div>
    </div>
  );
};
