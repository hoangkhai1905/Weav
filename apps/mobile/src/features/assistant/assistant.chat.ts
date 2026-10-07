import type { AssistantDraft, AssistantStreamEvent } from '../../domain/assistant/assistant.types';

/** What the UI shows for the reply that is currently streaming in. */
export interface StreamingReply {
  conversationId: string | null;
  text: string;
  draft: AssistantDraft | null;
  /** Name of the tool the assistant is running right now (looking something up), if any. */
  tool: string | null;
  done: boolean;
  error: { code: string; message: string } | null;
}

export const EMPTY_REPLY: StreamingReply = {
  conversationId: null,
  text: '',
  draft: null,
  tool: null,
  done: false,
  error: null,
};

export function applyAssistantEvent(state: StreamingReply, event: AssistantStreamEvent): StreamingReply {
  switch (event.type) {
    case 'conversation':
      return { ...state, conversationId: event.conversationId };
    case 'delta':
      return { ...state, text: state.text + event.text, tool: null };
    case 'tool_call':
      return { ...state, tool: event.name };
    case 'tool_result':
      return { ...state, tool: null };
    case 'draft':
      return { ...state, draft: event.draft };
    case 'done':
      return { ...state, done: true, tool: null };
    case 'error':
      return { ...state, error: { code: event.code, message: event.message }, tool: null };
  }
}

/** A piece of a message: plain, **bold** or `code`. */
export interface InlineSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

/** Minimal inline formatting (no markdown library): **bold** and `inline code`. */
export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  for (const part of text.split(INLINE)) {
    if (part === '') continue;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) out.push({ text: part.slice(2, -2), bold: true });
    else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) out.push({ text: part.slice(1, -1), code: true });
    else out.push({ text: part });
  }
  return out;
}

export interface MessageLine {
  /** Leading marker for list lines ("•" or "1."), null for normal text. */
  marker: string | null;
  segments: InlineSegment[];
}

/** Splits a reply into lines; "- x", "* x" and "1. x" become list lines. Blank lines are dropped. */
export function parseMessage(content: string): MessageLine[] {
  const lines: MessageLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet) lines.push({ marker: '•', segments: parseInline(bullet[1]) });
    else if (numbered) lines.push({ marker: `${numbered[1]}.`, segments: parseInline(numbered[2]) });
    else lines.push({ marker: null, segments: parseInline(line.replace(/^#{1,6}\s+/, '')) });
  }
  return lines;
}
