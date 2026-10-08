import { motion } from 'framer-motion';
import { Play, Webhook, Mail, Sparkles, Send, CheckCircle2, Zap, Layers } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

export function AnimatedWorkflowShowcase() {
  const { t } = useI18nStore();
  return (
    <div className="w-full h-full flex flex-col justify-between p-6 bg-subtle rounded-lg border border-border relative overflow-hidden select-none">
      {/* Ambient background particles */}

      {/* Top Header Label */}
      <div className="relative z-10 space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-run-bg text-run border border-run/30 text-xs font-bold">
          <Sparkles size={14} className="text-run animate-spin" />
          <span>{t('auth.showcase.title')}</span>
        </div>
        <h2 className="text-xl font-extrabold text-foreground tracking-tight">
          {t('auth.showcase.subtitle')}
        </h2>
      </div>

      {/* Interactive Live Animated Node Graph */}
      <div className="relative z-10 my-6 py-6 px-4 bg-card/60 rounded-2xl border border-border shadow-pop min-h-[260px] flex items-center justify-center">
        {/* SVG Connecting Paths with Animated Flow Packets */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
          {/* Bezier Path 1 (Manual Trigger to AI Extract) */}
          <path
            d="M 70,75 C 130,75 130,135 190,135"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-run"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 2 (Webhook to AI Extract) */}
          <path
            d="M 70,195 C 130,195 130,135 190,135"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-err"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 3 (AI Extract to Telegram) */}
          <path
            d="M 290,135 C 330,135 330,75 370,75"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-run"
            strokeDasharray="4 4"
          />
          {/* Bezier Path 4 (AI Extract to Email) */}
          <path
            d="M 290,135 C 330,135 330,195 370,195"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-ok"
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
              className="p-2.5 bg-card border-l-4 border-l-err-border border border-border rounded-xl flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-err-bg text-err shrink-0">
                <Play size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-foreground truncate">{t('auth.showcase.manual_run')}</div>
                <div className="text-[9px] text-muted-foreground font-mono">trigger.manual</div>
              </div>
            </motion.div>

            {/* Node 2: Webhook Trigger */}
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              className="p-2.5 bg-card border-l-4 border-l-err-border border border-border rounded-xl flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-err-bg text-err shrink-0">
                <Webhook size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-foreground truncate">{t('auth.showcase.webhook_in')}</div>
                <div className="text-[9px] text-muted-foreground font-mono">trigger.webhook</div>
              </div>
            </motion.div>
          </div>

          {/* Center AI Processing Node */}
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="p-3 bg-card border-l-4 border-l-run/30 border border-border rounded-2xl shadow-pop flex flex-col items-center gap-1.5 w-40 text-center relative"
          >
            <span className="absolute -top-2.5 px-2 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold shadow">
              {t('auth.showcase.ai_compiler')}
            </span>
            <div className="p-2 rounded-xl bg-run-bg text-run mt-1">
              <Sparkles size={20} className="animate-spin" />
            </div>
            <div className="text-xs font-bold text-foreground">{t('auth.showcase.invoice_node')}</div>
            <div className="text-[9px] text-muted-foreground font-mono">ai.extract</div>
          </motion.div>

          {/* Right Output Actions Column */}
          <div className="flex flex-col gap-8">
            {/* Node 3: Telegram Bot */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
              className="p-2.5 bg-card border-l-4 border-l-run/30 border border-border rounded-xl flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-run-bg text-run shrink-0">
                <Send size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-foreground truncate">{t('auth.showcase.telegram_alert')}</div>
                <div className="text-[9px] text-muted-foreground font-mono">telegram.send</div>
              </div>
            </motion.div>

            {/* Node 4: Email Send */}
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
              className="p-2.5 bg-card border-l-4 border-l-ok/30 border border-border rounded-xl flex items-center gap-2.5 w-36"
            >
              <div className="p-1.5 rounded-lg bg-ok-bg text-ok shrink-0">
                <Mail size={14} />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-bold text-foreground truncate">{t('auth.showcase.send_email')}</div>
                <div className="text-[9px] text-muted-foreground font-mono">email.send</div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="relative z-10 grid grid-cols-3 gap-2 pt-2">
        <div className="p-2.5 bg-card/70 border border-border rounded-xl text-center">
          <Layers size={16} className="mx-auto mb-1 text-run" />
          <span className="block text-[11px] font-bold text-foreground">{t('auth.showcase.drag_canvas')}</span>
          <span className="text-[9px] text-muted-foreground">{t('auth.showcase.nodes_hint')}</span>
        </div>

        <div className="p-2.5 bg-card/70 border border-border rounded-xl text-center">
          <CheckCircle2 size={16} className="mx-auto mb-1 text-ok" />
          <span className="block text-[11px] font-bold text-foreground">{t('auth.showcase.run_history')}</span>
          <span className="text-[9px] text-muted-foreground">{t('auth.showcase.run_history_hint')}</span>
        </div>

        <div className="p-2.5 bg-card/70 border border-border rounded-xl text-center">
          <Zap size={16} className="mx-auto mb-1 text-warn" />
          <span className="block text-[11px] font-bold text-foreground">{t('auth.showcase.ai_generate')}</span>
          <span className="text-[9px] text-muted-foreground">{t('auth.showcase.ai_generate_hint')}</span>
        </div>
      </div>
    </div>
  );
}
