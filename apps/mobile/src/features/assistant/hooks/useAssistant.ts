import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assistantRepository } from '../../../infrastructure/repository-factory';
import type { ApiError } from '../../../domain/common/error.types';
import type { AssistantDraft } from '../../../domain/assistant/assistant.types';
import { deviceTimeZone } from '../../common/timezone';
import { getActiveWorkspaceId, useActiveWorkspaceId } from '../../workspace/active-workspace';
import { applyAssistantEvent, EMPTY_REPLY, type StreamingReply } from '../assistant.chat';

export const CONVERSATION_PAGE_SIZE = 30;

export function useConversations() {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['assistant', 'conversations', workspaceId],
    queryFn: () => assistantRepository.listConversations(workspaceId ?? '', { limit: CONVERSATION_PAGE_SIZE }),
    enabled: !!workspaceId,
  });
}

export function useConversationMessages(conversationId: string | undefined) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: ['assistant', 'conversation', workspaceId, conversationId],
    queryFn: () => assistantRepository.getConversation(conversationId ?? ''),
    enabled: !!workspaceId && !!conversationId,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => assistantRepository.deleteConversation(conversationId),
    onSuccess: (_void, conversationId) => {
      queryClient.removeQueries({ queryKey: ['assistant', 'conversation', getActiveWorkspaceId(), conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
    },
  });
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  draft?: AssistantDraft | null;
}

function toApiError(error: unknown): Pick<ApiError, 'code' | 'status' | 'requestId'> {
  const e = (error ?? {}) as Partial<ApiError>;
  return { code: typeof e.code === 'string' ? e.code : 'UNKNOWN', status: e.status, requestId: e.requestId };
}

/**
 * One chat session. History of an opened conversation comes from the query; turns made in this
 * session are kept locally (the streamed reply is appended when it finishes). The stream is
 * aborted when the screen goes away.
 */
export function useAssistantChat(openedConversationId?: string) {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [conversationId, setConversationId] = useState<string | null>(openedConversationId ?? null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [reply, setReply] = useState<StreamingReply | null>(null);
  const [failed, setFailed] = useState<{ text: string; error: Pick<ApiError, 'code' | 'status' | 'requestId'> } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const sending = reply !== null;

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || abortRef.current || !workspaceId) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setFailed(null);
      setPendingUser(text);
      let state: StreamingReply = { ...EMPTY_REPLY, conversationId };
      setReply(state);
      let transportError: Pick<ApiError, 'code' | 'status' | 'requestId'> | null = null;
      try {
        await assistantRepository.chat(
          workspaceId,
          { ...(conversationId ? { conversationId } : {}), message: text, timezone: deviceTimeZone() },
          (event) => {
            state = applyAssistantEvent(state, event);
            setReply(state);
          },
          controller.signal,
        );
      } catch (error) {
        transportError = toApiError(error);
      }
      abortRef.current = null;
      if (controller.signal.aborted) return; // screen closed: nothing to update
      const error = state.error ?? transportError ?? (state.text === '' ? { code: 'UNKNOWN' } : null);
      if (state.conversationId) setConversationId(state.conversationId);
      if (error) {
        setFailed({ text, error: { code: error.code, status: 'status' in error ? error.status : undefined, requestId: 'requestId' in error ? error.requestId : undefined } });
        setReply(null);
        return;
      }
      counter.current += 1;
      const n = counter.current;
      setTurns((prev) => [
        ...prev,
        { id: `u${n}`, role: 'user', content: text },
        { id: `a${n}`, role: 'assistant', content: state.text, draft: state.draft },
      ]);
      setPendingUser(null);
      setReply(null);
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
    },
    [conversationId, queryClient, workspaceId],
  );

  const retry = useCallback(() => {
    if (!failed) return;
    const { text } = failed;
    setFailed(null);
    void send(text);
  }, [failed, send]);

  return { conversationId, turns, pendingUser, reply, sending, failed, send, retry };
}
