import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, GitFork, Loader2, Plus, Send, Square, X } from 'lucide-react';
import { isAssistantMockMode } from '../../api/assistant.api';
import { countDraftNodes, useAssistantChat } from '../../hooks/useAssistantChat';
import { useWorkspaceListContext } from '../../hooks/useWorkspace';
import { formatAssistantText } from '../../lib/formatAssistantText';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SM, FOCUS_RING, ICON_BTN } from '../../lib/uiClasses';
import { useAuthStore } from '../../store/useAuthStore';
import { useI18nStore } from '../../store/useI18nStore';
import { WeavBotMark } from '../common/WeavMark';

const SUGGESTIONS = ['bot.suggest.failed', 'bot.suggest.draft', 'bot.suggest.top'] as const;
/** Tools that look at runs: the answer gets a shortcut to the run history. */
const RUN_TOOLS = new Set(['explain_run_failure', 'list_failed_runs_today']);

function BotChat({ activeWorkspaceId, visible, onClose }: { activeWorkspaceId: string | null; visible: boolean; onClose: () => void }) {
  const { t } = useI18nStore();
  const user = useAuthStore((state) => state.user);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { disabled, messages, input, setInput, streaming, openingDraft, resetChat, send, stop, openDraft, toolLabel } =
    useAssistantChat(activeWorkspaceId, { withHistory: false, inputRef });
  const name = user?.displayName?.trim() || user?.name?.trim() || '';

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  return (
    <section
      data-testid="assistant-bot-panel"
      aria-label={t('bot.name')}
      className={`${visible ? 'flex' : 'hidden'} fixed bottom-[92px] right-4 z-40 h-[540px] max-h-[calc(100vh-120px)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[14px] border border-border-strong bg-card shadow-pop sm:right-6`}
    >
      <div className="flex items-center gap-2.5 border-b border-border py-3 pl-3.5 pr-2.5">
        <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-primary text-primary-foreground">
          <WeavBotMark className="h-7 w-7" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold text-foreground">{t('bot.name')}</span>
          <span className="inline-flex items-center gap-1.5 truncate text-xs text-text-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
            <span className="truncate">{t('bot.subtitle')}</span>
          </span>
        </span>
        <button type="button" data-testid="assistant-bot-new" className={ICON_BTN} onClick={resetChat} aria-label={t('assistant.new')} title={t('assistant.new')}>
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className={ICON_BTN} onClick={onClose} aria-label={t('bot.close_panel')}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {disabled ? (
          <p data-testid="assistant-bot-disabled" className="rounded-xl bg-subtle px-3 py-2.5 text-sm text-text-2">
            {t('assistant.disabled.body')}
          </p>
        ) : (
          <>
            <div className="max-w-[88%] self-start rounded-xl rounded-tl-sm bg-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground">
              {t(name ? 'bot.greeting' : 'bot.greeting_anon').replace('{name}', () => name)}
            </div>
            {messages.length === 0 && (
              <div className="flex flex-col items-start gap-1.5">
                {SUGGESTIONS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!activeWorkspaceId}
                    onClick={() => void send(t(key))}
                    className={`min-h-[34px] rounded-full border border-border-strong bg-card px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-subtle disabled:opacity-50 ${FOCUS_RING}`}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
            {messages.map((message, index) => {
              const last = index === messages.length - 1;
              const live = last && streaming && message.role === 'assistant';
              if (message.role === 'user') {
                return (
                  <div key={index} data-testid="assistant-bot-message-user" className="max-w-[88%] self-end whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-primary px-3 py-2.5 text-sm text-primary-foreground">
                    {message.content}
                  </div>
                );
              }
              return (
                <div key={index} className="flex min-w-0 flex-col gap-2.5">
                  {message.tools.map((tool, toolIndex) => (
                    <div key={toolIndex} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {live && toolIndex === message.tools.length - 1 && !message.content ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Check size={14} strokeWidth={1.75} className="text-ok" aria-hidden="true" />
                      )}
                      {toolLabel(tool)}
                    </div>
                  ))}
                  {(message.content || live || message.error) && (
                    <div
                      data-testid="assistant-bot-message-assistant"
                      aria-live={live ? 'polite' : undefined}
                      aria-busy={live || undefined}
                      className="max-w-[88%] self-start rounded-xl rounded-tl-sm bg-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground"
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {formatAssistantText(message.content)}
                        {live && !message.content && <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label={t('assistant.thinking')} />}
                      </div>
                      {message.error && <p role="alert" className="mt-1 text-[13px] text-err">{message.error}</p>}
                      {(message.draft || message.tools.some((tool) => RUN_TOOLS.has(tool))) && !live && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {message.draft && (
                            <button
                              type="button"
                              disabled={openingDraft}
                              onClick={() => void openDraft(message.draft!)}
                              className={`${BTN_PRIMARY} ${BTN_SM}`}
                            >
                              <GitFork size={14} strokeWidth={1.75} aria-hidden="true" />
                              {t('assistant.draft.open')}
                              <span className="text-xs opacity-80">({t('assistant.draft.nodes').replace('{count}', String(countDraftNodes(message.draft.definition)))})</span>
                            </button>
                          )}
                          {message.tools.some((tool) => RUN_TOOLS.has(tool)) && (
                            <Link to="/executions" className={`${BTN_SECONDARY} ${BTN_SM}`}>
                              {t('bot.view_runs')}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-2.5">
        <label htmlFor="assistant-bot-input" className="sr-only">{t('bot.input_label')}</label>
        <input
          id="assistant-bot-input"
          ref={inputRef}
          data-testid="assistant-bot-input"
          value={input}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('bot.placeholder')}
          className={`h-10 min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50 ${FOCUS_RING}`}
        />
        {streaming ? (
          <button type="button" onClick={stop} aria-label={t('assistant.stop')} className={`${BTN_SECONDARY} h-10 w-10 px-0`}>
            <Square size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            data-testid="assistant-bot-send"
            disabled={disabled || !input.trim() || !activeWorkspaceId}
            aria-label={t('assistant.send')}
            className={`${BTN_PRIMARY} h-10 w-10 px-0`}
          >
            <Send size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  );
}

/** Floating "Trợ lý Weav" bot: a robot button bottom-right that opens a 380x540 chat panel (same logic as /assistant). */
export function AssistantBot() {
  const { t } = useI18nStore();
  const { activeWorkspaceId } = useWorkspaceListContext();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // keep the conversation alive while the panel is closed
  if (isAssistantMockMode) return null;
  return (
    <>
      {/* Remount per workspace so no conversation leaks across workspaces. */}
      {opened && <BotChat key={activeWorkspaceId ?? 'none'} activeWorkspaceId={activeWorkspaceId} visible={open} onClose={() => setOpen(false)} />}
      <button
        type="button"
        data-testid="assistant-bot-fab"
        aria-label={open ? t('bot.close') : t('bot.open')}
        aria-expanded={open}
        onClick={() => {
          setOpened(true);
          setOpen((value) => !value);
        }}
        className={`fixed bottom-6 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-pop transition-transform hover:-translate-y-px sm:right-6 ${FOCUS_RING}`}
      >
        {open ? <X size={22} strokeWidth={1.75} aria-hidden="true" /> : <WeavBotMark className="h-8 w-8" />}
      </button>
    </>
  );
}
