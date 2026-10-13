import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Layers, Link2, Mail, Play, Send, Zap } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

const DIAGRAM_W = 520;
const DIAGRAM_H = 260;

/** A node tile: coloured square + label. Position is fixed inside the 520x260 diagram. */
function Node({ left, top, className, tone, icon, label }: { left: number; top: number; className: string; tone: string; icon: ReactNode; label: string }) {
  return (
    <div className={`absolute flex w-[140px] items-center gap-2.5 rounded-xl border border-border-strong bg-card p-2.5 ${className}`} style={{ left, top }}>
      <span className={`inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] ${tone}`}>{icon}</span>
      <span className="min-w-0 text-xs font-semibold leading-snug text-foreground">{label}</span>
    </div>
  );
}

/**
 * Right-hand panel of the sign-in / register screens: two inputs -> "AI compiler" -> two outputs. Dashed wires keep
 * moving, data dots travel along them, nodes bob out of phase and the centre node pulses (all off for reduced motion).
 * Decorative, so hidden from assistive tech; the diagram scales down on narrow panels instead of being clipped.
 */
export function AnimatedWorkflowShowcase() {
  const { t } = useI18nStore();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / DIAGRAM_W));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const features = [
    { icon: Layers, tone: 'text-run', title: 'auth.showcase.drag_canvas', hint: 'auth.showcase.nodes_hint' },
    { icon: CheckCircle2, tone: 'text-ok', title: 'auth.showcase.run_history', hint: 'auth.showcase.run_history_hint' },
    { icon: Zap, tone: 'text-warn', title: 'auth.showcase.ai_generate', hint: 'auth.showcase.ai_generate_hint' },
  ];

  return (
    <div
      aria-hidden="true"
      className="flex h-full min-h-[560px] flex-col items-center justify-center gap-7 border-l border-border bg-subtle px-8 py-12 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]"
    >
      <div className="flex w-full max-w-[568px] flex-col gap-[22px]">
        <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">{t('auth.showcase.subtitle')}</h2>

        <div className="overflow-hidden rounded-[14px] border border-border bg-card p-6">
          <div ref={frameRef} className="w-full" style={{ height: DIAGRAM_H * scale }}>
            <div className="relative origin-top-left" style={{ width: DIAGRAM_W, height: DIAGRAM_H, transform: `scale(${scale})` }}>
              <svg viewBox={`0 0 ${DIAGRAM_W} ${DIAGRAM_H}`} className="absolute inset-0" style={{ width: DIAGRAM_W, height: DIAGRAM_H }}>
                <path className="wv-wire" d="M140,66 C165,66 165,130 190,130" stroke="var(--run)" />
                <path className="wv-wire" d="M140,194 C165,194 165,130 190,130" stroke="var(--err)" />
                <path className="wv-wire" d="M330,130 C355,130 355,66 380,66" stroke="var(--run)" />
                <path className="wv-wire" d="M330,130 C355,130 355,194 380,194" stroke="var(--ok)" />
              </svg>
              <span className="wv-packet" style={{ background: 'var(--run)', offsetPath: "path('M140,66 C165,66 165,130 190,130')" }} />
              <span className="wv-packet" style={{ background: 'var(--ok)', offsetPath: "path('M330,130 C355,130 355,194 380,194')", animationDelay: '1.2s' }} />

              <Node left={0} top={41} className="wv-float" tone="bg-t-trigger-bg text-t-trigger" icon={<Play size={15} strokeWidth={1.75} />} label={t('auth.showcase.manual_run')} />
              <Node left={0} top={169} className="wv-float2" tone="bg-t-trigger-bg text-t-trigger" icon={<Link2 size={15} strokeWidth={1.75} />} label={t('auth.showcase.webhook_in')} />

              <div className="wv-pulse absolute left-[190px] top-[71px] flex w-[140px] flex-col items-center gap-1.5 rounded-xl border border-border-strong bg-card px-2.5 pb-3 pt-[18px] text-center shadow-pop">
                <span className="absolute -top-2.5 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {t('auth.showcase.ai_compiler')}
                </span>
                <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[7px] bg-t-ai-bg text-t-ai">
                  <svg viewBox="0 0 24 24" className="wv-spin h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="7" strokeDasharray="3 3" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                </span>
                <span className="text-xs font-semibold leading-snug text-foreground">{t('auth.showcase.invoice_node')}</span>
              </div>

              <Node left={380} top={41} className="wv-float3" tone="bg-t-action-bg text-t-action" icon={<Send size={15} strokeWidth={1.75} />} label={t('auth.showcase.telegram_alert')} />
              <Node left={380} top={169} className="wv-float4" tone="bg-ok-bg text-ok" icon={<Mail size={15} strokeWidth={1.75} />} label={t('auth.showcase.send_email')} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {features.map(({ icon: Icon, tone, title, hint }) => (
            <div key={title} className="flex flex-col items-center gap-1 rounded-[10px] border border-border bg-card px-2 py-3 text-center">
              <Icon size={18} strokeWidth={1.75} className={tone} />
              <span className="text-xs font-semibold text-foreground">{t(title)}</span>
              <span className="text-[11px] text-muted-foreground">{t(hint)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
