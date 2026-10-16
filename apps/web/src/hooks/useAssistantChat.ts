import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AssistantApiError,
  assistantApi,
  isAssistantMockMode,
  type AssistantConversation,
  type AssistantEvent,
} from '../api/assistant.api';
import { workflowV1Api } from '../api/workflow-v1.api';
import { showErrorToast } from '../lib/feedback/toast';
import { useI18nStore } from '../store/useI18nStore';

export interface AssistantDraft {
  name: string;
  definition: unknown;
  layout: Record<string, unknown>;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tools: string[];
  draft?: AssistantDraft;
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

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function countDraftNodes(definition: unknown): number {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

/**
 * Shared chat logic of the AI assistant: the full `/assistant` page and the floating "Trợ lý Weav" bot both use it.
 * `withHistory` loads the conversation list (page only); the bot keeps one conversation at a time.
 */
export function useAssistantChat(
  activeWorkspaceId: string | null,
  options: { withHistory?: boolean; inputRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null> } = {},
) {
  const { withHistory = true, inputRef } = options;
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [disabled, setDisabled] = useState(isAssistantMockMode);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [openingDraft, setOpeningDraft] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);

  const markDisabledIfUnavailable = useCallback((error: unknown, notFoundMeansDisabled = true) => {
    if (error instanceof AssistantApiError && (error.status === 503 || (notFoundMeansDisabled && error.status === 404))) {
      setDisabled(true);
      return true;
    }
    return false;
  }, []);

  const loadConversations = useCallback(async (before?: string, beforeId?: string) => {
    if (!withHistory || !activeWorkspaceId || isAssistantMockMode) return;
    try {
      const items = await assistantApi.listConversations(activeWorkspaceId, before, beforeId);
      setConversations((current) => (before ? [...current, ...items] : items));
      setHasMore(items.length >= 20);
    } catch (error) {
      if (!markDisabledIfUnavailable(error)) showErrorToast('assistant.error.list');
    } finally {
      setListLoading(false);
    }
  }, [activeWorkspaceId, markDisabledIfUnavailable, withHistory]);

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

  const openConversation = async (id: string) => {
    resetChat();
    try {
      const history = await assistantApi.getMessages(id);
      conversationRef.current = id;
      setConversationId(id);
      setMessages(history.messages.map((m) => ({ role: m.role, content: m.content, tools: [] })));
    } catch (error) {
      if (!markDisabledIfUnavailable(error, false)) showErrorToast('assistant.error.history');
    }
  };

  const deleteConversation = async (target: AssistantConversation) => {
    try {
      await assistantApi.deleteConversation(target.conversationId);
      setConversations((current) => current.filter((c) => c.conversationId !== target.conversationId));
      if (conversationRef.current === target.conversationId) resetChat();
    } catch {
      showErrorToast('assistant.error.delete');
    }
  };

  const patchLast = (patch: (message: AssistantChatMessage) => AssistantChatMessage) =>
    setMessages((current) => current.map((message, index) => (index === current.length - 1 ? patch(message) : message)));

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming || !activeWorkspaceId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput('');
    setStreaming(true);
    setMessages((current) => [...current, { role: 'user', content: text, tools: [] }, { role: 'assistant', content: '', tools: [] }]);
    inputRef?.current?.focus();
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
      inputRef?.current?.focus();
    }
  };

  const stop = () => abortRef.current?.abort();

  const openDraft = async (draft: AssistantDraft) => {
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

  return {
    conversations,
    hasMore,
    listLoading,
    setListLoading,
    disabled,
    conversationId,
    messages,
    input,
    setInput,
    streaming,
    openingDraft,
    loadConversations,
    resetChat,
    openConversation,
    deleteConversation,
    send,
    stop,
    openDraft,
    toolLabel,
  };
}
