/**
 * Live check for the assistant spike: ONE conversation through the real DeepSeek adapter and tool loop,
 * with the two tools answered by canned data (no workflow-service). Prints the event sequence, timings
 * and whether streamed tool-call fragments were assembled into valid calls. Never prints the key.
 *
 *   DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... [DEEPSEEK_BASE_URL=...] \
 *     pnpm --dir services/ai-service exec ts-node scripts/assistant-live-check.ts
 */
import { runAssistant } from '../src/application/assistant/chat';
import { DeepSeekChatProvider } from '../src/infrastructure/llm/deepseek/deepseek-chat-provider';

const WS = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const WF = '4fa85f64-5717-4562-b3fc-2c963f66afa6';
const EX = '5fa85f64-5717-4562-b3fc-2c963f66afa6';

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL;
if (!apiKey || !model) {
  console.error(
    'Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL (values are never printed).',
  );
  process.exit(2);
}

// Canned workflow-service answers, shaped like the real API.
const canned = (url: string) => {
  const body = url.includes('/executions/')
    ? {
        status: 'FAILED',
        createdAt: '2026-10-05T01:00:00Z',
        startedAt: '2026-10-05T01:00:01Z',
        finishedAt: '2026-10-05T01:00:05Z',
        nodes: [
          {
            nodeId: 'send_mail',
            nodeType: 'action.gmail.send',
            status: 'FAILED',
            attemptCount: 3,
            error: {
              code: 'CONNECTION_EXPIRED',
              message: 'The Gmail connection needs to be re-authorized.',
            },
          },
        ],
      }
    : {
        items: [
          {
            workflowId: WF,
            name: 'Daily sales report',
            status: 'PUBLISHED',
            updatedAt: '2026-10-04T12:00:00Z',
          },
        ],
      };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
};

// Count the raw streamed tool_call fragments so "assembled correctly" is measurable.
let fragments = 0;
const countingFetch = (async (url: string, init: RequestInit) => {
  const response = await fetch(url, init);
  void response
    .clone()
    .text()
    .then(
      (raw) => {
        fragments += raw
          .split('\n')
          .filter(
            (l) => l.startsWith('data:') && l.includes('"tool_calls"'),
          ).length;
      },
      () => undefined,
    );
  return response;
}) as typeof fetch;

async function main() {
  const provider = new DeepSeekChatProvider(
    {
      apiKey: apiKey as string,
      model: model as string,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      maxResponseBytes: 1024 * 1024,
    },
    countingFetch,
  );
  const signal = AbortSignal.timeout(60_000);
  const t0 = Date.now();
  const at = () => `${Date.now() - t0} ms`;
  let firstEvent = '',
    firstToolCall = '',
    done = '';
  const sequence: string[] = [];
  const toolCalls: { name: string; arguments: unknown }[] = [];
  let toolResultsOk = 0;
  let text = '';
  for await (const item of runAssistant(
    provider,
    {
      messages: [
        {
          role: 'user',
          content: `Which workflows do I have? And why did run ${EX} of workflow ${WF} fail?`,
        },
      ],
      maxTokens: 400,
      maxToolRounds: 2,
      tools: {
        workspaceId: WS,
        authorization: 'Bearer live-check-not-a-real-token',
        workflowApiUrl: 'http://canned.invalid',
        signal,
        fetchImpl: canned,
      },
    },
    signal,
  )) {
    firstEvent ||= at();
    if (item.event === 'tool_call') {
      firstToolCall ||= at();
      toolCalls.push(item.data);
    }
    if (item.event === 'tool_result' && item.data.ok) toolResultsOk++;
    if (item.event === 'done') done = at();
    if (item.event === 'delta') {
      text += item.data.text;
      if (sequence.at(-1) !== 'delta') sequence.push('delta');
    } else sequence.push(item.event);
  }
  const argsValid = toolCalls.every(
    (c) => c.arguments !== null && typeof c.arguments === 'object',
  );
  console.log('sequence      :', sequence.join(' > '));
  console.log('tool calls    :', JSON.stringify(toolCalls));
  console.log('answer        :', text.slice(0, 600));
  console.log(
    `timing        : first event ${firstEvent}, first tool_call ${firstToolCall || 'none'}, done ${done}`,
  );
  console.log(`tool_call fragments streamed by the model: ${fragments}`);
  console.log(
    `assembled OK  : ${toolCalls.length > 0 && argsValid && toolResultsOk === toolCalls.length ? 'yes' : 'NO'} (calls ${toolCalls.length}, valid-args ${argsValid}, tools ok ${toolResultsOk})`,
  );
}

main().catch((error: unknown) => {
  console.error(
    'live check failed:',
    (error as { code?: string })?.code ?? (error as Error)?.constructor?.name,
  );
  process.exit(1);
});
