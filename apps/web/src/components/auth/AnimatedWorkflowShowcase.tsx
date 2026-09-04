import { motion } from 'framer-motion';
import { Play, Webhook, Mail, Sparkles, Send, CheckCircle2, Zap, Layers } from 'lucide-react';

export function AnimatedWorkflowShowcase() {
  return (
    <div className="w-full h-full flex flex-col justify-between p-6 bg-gradient-to-br from-violet-500/10 via-indigo-500/5 to-rose-500/10 dark:from-violet-950/40 dark:via-slate-900 dark:to-indigo-950/40 rounded-3xl border border-slate-200/80 dark:border-slate-800 relative overflow-hidden select-none">
      {/* Ambient background particles */}
      <div className="absolute top-10 right-10 w-72 h-72 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-72 h-72 bg-rose-500/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Label */}
      <div className="relative z-10 space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300 border border-violet-500/20 text-xs font-bold shadow-sm">
          <Sparkles size={14} className="text-violet-500 animate-spin" />
          <span>Real-Time AI Node Graph</span>
        </div>
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
          Automate complex workflows visually.
        </h2>
      </div>

      {/* Interactive Live Animated Node Graph */}
      <div className="relative z-10 my-6 py-6 px-4 bg-white/60 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-slate-800/80 shadow-lg min-h-[260px] flex items-center justify-center">
        {/* SVG Connecting Paths with Animated Flow Packets */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
          {/* Bezier Path 1 (Manual Trigger to AI Extract) */}
          <path
            d="M 70,75 C 130,75 130,135 190,135"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-violet-300 dark:text-violet-700/60"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 2 (Webhook to AI Extract) */}
          <path
            d="M 70,195 C 130,195 130,135 190,135"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-rose-300 dark:text-rose-700/60"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 3 (AI Extract to Telegram) */}
          <path
            d="M 290,135 C 330,135 330,75 370,75"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-sky-300 dark:text-sky-700/60"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 4 (AI Extract to Email) */}
          <path
            d="M 290,135 C 330,135 330,195 370,195"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-emerald-300 dark:text-emerald-700/60"
            strokeDasharray="4 4"
          />
        </svg>

        {/* Floating Animated Nodes */}
        <div className="relative z-10 w-full flex items-center justify-between px-2">
          {/* Left Triggers Column */}
          <div className="flex flex-col gap-8">
            {/* Node 1: Manual Trigger */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="p-2.5 bg-white dark:bg-slate-900 border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 shrink-0">
                <Play size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">Manual Run</div>
                <div className="text-[9px] text-slate-400 font-mono">trigger.manual</div>
              </div>
            </motion.div>

            {/* Node 2: Webhook Trigger */}
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="p-2.5 bg-white dark:bg-slate-900 border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 shrink-0">
                <Webhook size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">Webhook In</div>
                <div className="text-[9px] text-slate-400 font-mono">trigger.webhook</div>
              </div>
            </motion.div>
          </div>

          {/* Center AI Processing Node */}
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="p-3 bg-white dark:bg-slate-900 border-l-4 border-l-blue-500 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl flex flex-col items-center gap-1.5 w-40 text-center relative"
          >
            <span className="absolute -top-2.5 px-2 py-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold shadow">
              AI Compiler
            </span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 mt-1">
              <Sparkles size={20} className="animate-spin" />
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">AI Invoice Extract</div>
            <div className="text-[9px] text-slate-400 font-mono">ai.extract</div>
          </motion.div>

          {/* Right Output Actions Column */}
          <div className="flex flex-col gap-8">
            {/* Node 3: Telegram Bot */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
              className="p-2.5 bg-white dark:bg-slate-900 border-l-4 border-l-sky-500 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-500 shrink-0">
                <Send size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">Telegram Alert</div>
                <div className="text-[9px] text-slate-400 font-mono">telegram.send</div>
              </div>
            </motion.div>

            {/* Node 4: Email Send */}
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
              className="p-2.5 bg-white dark:bg-slate-900 border-l-4 border-l-emerald-500 border border-slate-200 dark:border-slate-800 rounded-xl shadow-md flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
                <Mail size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">Send Email</div>
                <div className="text-[9px] text-slate-400 font-mono">email.send</div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="relative z-10 grid grid-cols-3 gap-2 pt-2">
        <div className="p-2.5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl text-center shadow-sm">
          <Layers size={16} className="mx-auto mb-1 text-violet-500" />
          <span className="block text-[11px] font-bold text-slate-900 dark:text-slate-100">React Flow 12</span>
          <span className="text-[9px] text-slate-500 dark:text-slate-400">Drag & Drop Canvas</span>
        </div>

        <div className="p-2.5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl text-center shadow-sm">
          <CheckCircle2 size={16} className="mx-auto mb-1 text-emerald-500" />
          <span className="block text-[11px] font-bold text-slate-900 dark:text-slate-100">99.9% Uptime</span>
          <span className="text-[9px] text-slate-500 dark:text-slate-400">Reliable Execution</span>
        </div>

        <div className="p-2.5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl text-center shadow-sm">
          <Zap size={16} className="mx-auto mb-1 text-amber-500" />
          <span className="block text-[11px] font-bold text-slate-900 dark:text-slate-100">10x Speed</span>
          <span className="text-[9px] text-slate-500 dark:text-slate-400">AI Automation</span>
        </div>
      </div>
    </div>
  );
}
