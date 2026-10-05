import type {
  ChatEvent,
  ChatProvider,
  ChatRequest,
  ToolCall,
} from '../../src/application/assistant/chat-provider';

export type Round = ChatEvent[] | Error;

/** Fake model: each stream() call plays the next scripted round (or throws it). */
export class ScriptedChatProvider implements ChatProvider {
  requests: ChatRequest[] = [];
  /** Set to hold the stream open until the signal aborts (client-disconnect tests). */
  hang = false;
  aborted = false;
  private next = 0;

  constructor(private readonly rounds: Round[]) {}

  async *stream(request: ChatRequest, signal: AbortSignal) {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ChatRequest);
    const round = this.rounds[this.next++] ?? [{ type: 'end', toolCalls: [] }];
    if (round instanceof Error) throw round;
    for (const event of round) {
      yield event;
      if (this.hang) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        this.aborted = signal.aborted;
        return;
      }
    }
  }
}

export const text = (value: string): ChatEvent => ({
  type: 'delta',
  text: value,
});
export const end = (...toolCalls: ToolCall[]): ChatEvent => ({
  type: 'end',
  toolCalls,
});
export const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
});
