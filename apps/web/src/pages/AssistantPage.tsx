import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, GitFork, List, Loader2, Plus, Send, Square, Trash2, Wrench } from 'lucide-react';
import {
  AssistantApiError,
  assistantApi,
  isAssistantMockMode,
  type AssistantConversation,
  type AssistantEvent,
} from '../api/assistant.api';
import { workflowV1Api } from '../api/workflow-v1.api';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { useWorkspaceListContext } from '../hooks/useWorkspace';
import { showErrorToast } from '../lib/feedback/toast';
import { formatAssistantText } from '../lib/formatAssistantText';
import { useI18nStore } from '../store/useI18nStore';

interface Draft {
  name: string;
  definition: unknown;
  layout: Record<string, unknown>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools: string[];
  draft?: Draft;
  error?: string;
}

const ERROR_KEYS: Record<string, string> = {
  AI_BUSY: 'assistant.error.busy',
  AI_QUOTA_EXCEEDED: 'assistant.error.quota',
  TOO_MANY_REQUESTS: 'assistant.error.rate_limit',
  AI_TIMEOUT: 'assistant.error.timeout',
  AI_PROVIDER_UNAVAILABLE: 'assistant.error.provider',
  AI_PROVIDER_AUTH: 'assistant.error.provider',
};

function errorKey(code: string, status = 0): string {
  return ERROR_KEYS[code] ?? (status === 429 ? 'assistant.error.rate_limit' : 'assistant.error.generic');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isAbort =(error: unknown) => error instanceof DOMException && error.name === 'AbortError';

function countNodes(definition: unknown): number {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

function AssistantChat({ activeWorkspaceId }: { activeWorkspaceId: string | null }) {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [disabled, setDisabled] = useState(isAssistantMockMode);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showList, setShowList] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AssistantConversation | null>(null);
  const [openingDraft, setOpeningDraft] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const markDisabledIfUnavailable = useCallback((error: unknown, notFoundMeansDisabled = true) => {
    if (error instanceof AssistantApiError && (error.status === 503 || (notFoundMeansDisabled && error.status === 404))) {
      setDisabled(true);
      return true;
    }
    return false;
  }, []);

  const loadConversations = useCallback(async (before?: string) => {
    if (!activeWorkspaceId || isAssistantMockMode) return;
    try {
      const items = await assistantApi.listConversations(activeWorkspaceId, before);
      setConversations((current) => (before ? [...current, ...items] : items));
      setHasMore(items.length >= 20);
    } catch (error) {
      if (!markDisabledIfUnavailable(error)) showErrorToast('assistant.error.list');
    } finally {
      setListLoading(false);
    }
  }, [activeWorkspaceId, markDisabledIfUnavailable]);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setStreaming(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadConversations()); // async load; keeps setState out of the effect body
  }, [loadConversations]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const openConversation = async (id: string) => {
    resetChat();
    setShowList(false);
    try {
      const history = await assistantApi.getMessages(id);
      conversationRef.current = id;
      setConversationId(id);
      setMessages(history.messages.map((m) => ({ role: m.role, content: m.content, tools: [] })));
    } catch (error) {
      if (!markDisabledIfUnavailable(error, false)) showErrorToast('assistant.error.history');
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    try {
      await assistantApi.deleteConversation(target.conversationId);
      setConversations((current) => current.filter((c) => c.conversationId !== target.conversationId));
      if (conversationRef.current === target.conversationId) resetChat();
    } catch {
      showErrorToast('assistant.error.delete');
    } finally {
      setPendingDelete(null);
    }
  };

  const patchLast = (patch: (message: ChatMessage) => ChatMessage) =>
    setMessages((current) => current.map((message, index) => (index === current.length - 1 ? patch(message) : message)));

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming || !activeWorkspaceId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput('');
    setStreaming(true);
    setMessages((current) => [...current, { role: 'user', content: text, tools: [] }, { role: 'assistant', content: '', tools: [] }]);
    inputRef.current?.focus();
    let terminal = false;
    const onEvent = (event: AssistantEvent) => {
      switch (event.type) {
        case 'conversation':
          conversationRef.current = event.conversationId;
          setConversationId(event.conversationId);
          break;
        case 'delta':
          patchLast((m) => ({ ...m, content: m.content + event.text }));
          break;
        case 'tool_call':
          patchLast((m) => ({ ...m, tools: [...m.tools, event.name] }));
          break;
        case 'draft':
          patchLast((m) => ({ ...m, draft: { name: event.name, definition: event.definition, layout: event.layout } }));
          break;
        case 'done':
          terminal = true;
          break;
        case 'error':
          terminal = true;
          patchLast((m) => ({ ...m, error: t(errorKey(event.code)) }));
          break;
        default:
          break;
      }
    };
    try {
      await assistantApi.chat(
        {
          workspaceId: activeWorkspaceId,
          ...(conversationRef.current ? { conversationId: conversationRef.current } : {}),
          message: text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        controller.signal,
        onEvent,
      );
      if (!terminal && !controller.signal.aborted) patchLast((m) => ({ ...m, error: t('assistant.error.generic') }));
    } catch (error) {
      if (!isAbort(error)) {
        const unavailable = !conversationRef.current && markDisabledIfUnavailable(error);
        if (!unavailable) {
          const status = error instanceof AssistantApiError ? error.status : 0;
          const code = error instanceof AssistantApiError ? error.code : '';
          patchLast((m) => ({ ...m, error: t(errorKey(code, status)) }));
        }
        setInput(text);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStreaming(false);
        void loadConversations();
      }
      inputRef.current?.focus();
    }
  };

  // "Ask AI why it failed" hands over {workflowId, executionId} through router state. Send one message, then clear the
  // state so a reload or Back does not resend. The timer survives StrictMode's mount/unmount/mount (cleanup cancels it).
  const explainRun = (location.state as { explainRun?: { workflowId?: string; executionId?: string } } | null)?.explainRun;
  useEffect(() => {
    if (!explainRun || !activeWorkspaceId || disabled) return;
    const { workflowId = '', executionId = '' } = explainRun;
    const valid = UUID.test(workflowId) && UUID.test(executionId);
    const timer = window.setTimeout(() => {
      navigate(location.pathname, { replace: true, state: null });
      if (!valid) return;
      // Function replacers: ids are inserted literally, never parsed for `$&` patterns.
      void send(
        t('executions.askAi.message')
          .replace('{executionId}', () => executionId)
          .replace('{workflowId}', () => workflowId),
      );
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per navigation state; send/t are re-created every render
  }, [explainRun, activeWorkspaceId, disabled]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const openDraft = async (draft: Draft) => {
    if (!activeWorkspaceId || openingDraft) return;
    setOpeningDraft(true);
    try {
      const id = await workflowV1Api.createWorkflowFromDefinition(draft, activeWorkspaceId);
      navigate(`/workflows/${id}/builder`);
    } catch {
      showErrorToast('assistant.error.open_draft');
      setOpeningDraft(false);
    }
  };

  const toolLabel = (name: string) => {
    const key = `assistant.tool.${name}`;
    const label = t(key);
    return label === key ? name : label;
  };

  if (disabled) {
    return (
      <div data-testid="assistant-page" className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
        <Bot size={32} className="text-muted-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold text-foreground">{t('assistant.disabled.title')}</h1>
        <p data-testid="assistant-disabled" className="text-sm text-text-2">{t('assistant.disabled.body')}</p>
      </div>
    );
  }

  return (
    <div data-testid="assistant-page" className="flex min-h-[32rem] flex-col gap-3 md:h-full md:flex-row md:gap-4">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <h1 className="text-base font-semibold text-foreground">{t('assistant.title')}</h1>
        <button
          type="button"
          onClick={() => setShowList((open) => !open)}
          aria-expanded={showList}
          aria-controls="assistant-conversations"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs text-text-2 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <List size={14} aria-hidden="true" />
          {t('assistant.conversations')}
        </button>
      </div>

      <aside
        id="assistant-conversations"
        aria-label={t('assistant.conversations')}
        className={`${showList ? 'flex' : 'hidden'} max-h-72 w-full shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-2 md:flex md:max-h-none md:w-64`}
      >
        <button
          type="button"
          data-testid="assistant-new"
          onClick={() => { resetChat(); setShowList(false); inputRef.current?.focus(); }}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={14} aria-hidden="true" />
          {t('assistant.new')}
        </button>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((item) => (
            <li key={item.conversationId} data-testid="assistant-conversation" className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => void openConversation(item.conversationId)}
                aria-current={item.conversationId === conversationId ? 'true' : undefined}
                className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  item.conversationId === conversationId ? 'bg-sidebar-active text-foreground' : 'text-text-2 hover:bg-subtle'
                }`}
              >
                {item.title || t('assistant.untitled')}
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                aria-label={`${t('assistant.delete')}: ${item.title || t('assistant.untitled')}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-err-bg hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
          {!listLoading && conversations.length === 0 && (
            <li className="px-2 py-3 text-xs text-muted-foreground">{t('assistant.empty_list')}</li>
          )}
        </ul>
        {hasMore && (
          <button
            type="button"
            data-testid="assistant-load-more"
            disabled={listLoading}
            onClick={() => { setListLoading(true); void loadConversations(conversations[conversations.length - 1]?.updatedAt); }}
            className="h-8 rounded-md text-xs text-text-2 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {t('assistant.load_more')}
          </button>
        )}
      </aside>

      <section aria-label={t('assistant.title')} className="flex min-h-[24rem] min-w-0 flex-1 flex-col rounded-md border border-border bg-card">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Bot size={28} className="text-muted-foreground" aria-hidden="true" />
              <h1 className="hidden text-base font-semibold text-foreground md:block">{t('assistant.title')}</h1>
              <p className="max-w-sm text-sm text-text-2">{t('assistant.intro')}</p>
            </div>
          )}
          {messages.map((message, index) => {
            const last = index === messages.length - 1;
            const live = last && streaming && message.role === 'assistant';
            return (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  data-testid={`assistant-message-${message.role}`}
                  className={`min-w-0 max-w-[85%] space-y-2 rounded-md px-3 py-2 text-sm ${
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground'
                  }`}
                >
                  {message.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {message.tools.map((name, toolIndex) => (
                        <span key={toolIndex} data-testid="assistant-tool" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-text-2">
                          <Wrench size={10} aria-hidden="true" />
                          {toolLabel(name)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div aria-live={live ? 'polite' : undefined} aria-busy={live || undefined} className="whitespace-pre-wrap break-words">
                    {message.role === 'assistant' ? formatAssistantText(message.content) : message.content}
                    {live && !message.content && <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label={t('assistant.thinking')} />}
                  </div>
                  {message.draft && (
                    <div data-testid="assistant-draft" className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">{message.draft.name}</p>
                        <p className="text-xs text-text-2">{t('assistant.draft.nodes').replace('{count}', String(countNodes(message.draft.definition)))}</p>
                      </div>
                      <button
                        type="button"
                        data-testid="assistant-open-draft"
                        disabled={openingDraft}
                        onClick={() => void openDraft(message.draft!)}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <GitFork size={13} aria-hidden="true" />
                        {t('assistant.draft.open')}
                      </button>
                    </div>
                  )}
                  {message.error && (
                    <p role="alert" data-testid="assistant-error" className="text-[13px] text-err">{message.error}</p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border p-2 sm:p-3">
          <label htmlFor="assistant-input" className="sr-only">{t('assistant.input_label')}</label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            data-testid="assistant-input"
            value={input}
            maxLength={4000}
            rows={2}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('assistant.placeholder')}
            className="min-h-[2.5rem] min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {streaming ? (
            <button
              type="button"
              data-testid="assistant-stop"
              onClick={() => abortRef.current?.abort()}
              aria-label={t('assistant.stop')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-foreground hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              data-testid="assistant-send"
              disabled={!input.trim() || !activeWorkspaceId}
              aria-label={t('assistant.send')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Send size={15} aria-hidden="true" />
            </button>
          )}
        </form>
      </section>

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t('assistant.delete_confirm.title')}
        description={t('assistant.delete_confirm.body')}
        confirmText={t('assistant.delete')}
        cancelText={t('assistant.cancel')}
      />
    </div>
  );
}

/** Remounts the chat when the active workspace changes so no conversation state leaks across workspaces. */
export function AssistantPage() {
  const { activeWorkspaceId } = useWorkspaceListContext();
  return <AssistantChat key={activeWorkspaceId ?? 'none'} activeWorkspaceId={activeWorkspaceId} />;
}
