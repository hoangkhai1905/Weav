import type { AiGenerateRequest, AiQuestion } from '../../domain/ai/ai.types';
import type { ConnectionProvider } from '../../domain/connection/connection.types';
import type { WorkflowDefinition } from '../../domain/workflow/workflow.types';
import { assertGenerateRequest } from '../../infrastructure/http/ai.http.contract';

/** One form control per question: the backend question code decides which control is shown. */
export type QuestionControl = 'URL' | 'SCHEDULE' | 'TIMEZONE' | 'TEXT' | 'CONNECTION';

export function controlFor(question: AiQuestion): QuestionControl {
  switch (question.code) {
    case 'URL':
      return 'URL';
    case 'SCHEDULE':
      return 'SCHEDULE';
    case 'TIMEZONE':
      return 'TIMEZONE';
    case 'CONNECTION':
      return 'CONNECTION';
    default:
      return 'TEXT';
  }
}

/** Questions are keyed by their `field` (that is what the backend expects as the answer key). */
export const questionKey = (question: AiQuestion): string => `${question.code}:${question.field}`;

/** Which connection provider can serve a node type (a CONNECTION question names the node type). */
export function providerForNodeType(nodeType: string): ConnectionProvider | null {
  switch (nodeType) {
    case 'email.send':
    case 'trigger.gmail':
      return 'GMAIL';
    case 'google.sheets':
      return 'GOOGLE_SHEETS';
    case 'google.calendar':
      return 'GOOGLE_CALENDAR';
    case 'google.drive':
      return 'GOOGLE_DRIVE';
    case 'telegram.send_message':
    case 'trigger.telegram':
      return 'TELEGRAM';
    case 'http.request':
      return 'HTTP';
    default:
      return null;
  }
}

/**
 * The last segment of a VALUE field ("email.send.subject" or "node1.config.body") -> "subject".
 * The screen turns known names into friendly labels and humanizes the rest.
 */
export function fieldName(field: string): string {
  const parts = field.split('.');
  return parts[parts.length - 1] || field;
}

/** "reply_to" / "replyTo" -> "reply to" (fallback label for unknown fields). */
export function humanizeField(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isValidHttpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export interface Answers {
  answers: Record<string, string>;
  connections: Record<string, string>;
}

export type BuildAnswersResult =
  | { ok: true; value: Answers }
  | {
      ok: false;
      reason: 'missing' | 'invalid_url' | 'too_long' | 'invalid';
      /** Questions left blank. */
      keys: string[];
      /** URL questions that are filled but not an http(s) address. */
      urlKeys: string[];
    };

/**
 * Merges the previous rounds with this round's form values into the `answers` / `connections`
 * of the next generate call. Text answers are trimmed; a CONNECTION question is answered with the
 * picked connection id, keyed by node type. The whole request is validated with the same limits as
 * the HTTP contract (10 answers, prompt + answers <= 3900 characters).
 */
export function buildAnswers(input: {
  prompt: string;
  questions: readonly AiQuestion[];
  values: Readonly<Record<string, string>>;
  previous?: Answers;
}): BuildAnswersResult {
  const answers = { ...(input.previous?.answers ?? {}) };
  const connections = { ...(input.previous?.connections ?? {}) };
  const missing: string[] = [];
  const badUrl: string[] = [];

  for (const question of input.questions) {
    const key = questionKey(question);
    const value = (input.values[key] ?? '').trim();
    if (value === '') {
      missing.push(key);
      continue;
    }
    if (question.code === 'URL' && !isValidHttpUrl(value)) {
      badUrl.push(key);
      continue;
    }
    if (question.code === 'CONNECTION') connections[question.field] = value;
    else answers[question.field] = value;
  }

  if (missing.length > 0 || badUrl.length > 0) {
    return { ok: false, reason: missing.length > 0 ? 'missing' : 'invalid_url', keys: missing, urlKeys: badUrl };
  }

  const request: AiGenerateRequest = { prompt: input.prompt, answers, connections };
  try {
    assertGenerateRequest(request);
  } catch (error) {
    const tooLong = error instanceof Error && error.message.includes('too long');
    return { ok: false, reason: tooLong ? 'too_long' : 'invalid', keys: [], urlKeys: [] };
  }
  return { ok: true, value: { answers, connections } };
}

/**
 * `editorState` for a saved draft: the web editor reads node names and positions from here (the
 * definition itself has neither). Names fall back to the friendly label chosen by the caller.
 */
export function buildEditorState(
  definition: Pick<WorkflowDefinition, 'nodes'>,
  layout: Readonly<Record<string, { x: number; y: number }>>,
  labelOf: (node: { id: string; type: string }) => string,
): { nodes: Record<string, { name: string; position: { x: number; y: number } }> } {
  const nodes: Record<string, { name: string; position: { x: number; y: number } }> = {};
  definition.nodes.forEach((node, index) => {
    nodes[node.id] = {
      name: labelOf(node),
      position: layout[node.id] ?? { x: 100 + 300 * index, y: 100 },
    };
  });
  return { nodes };
}

export const WORKFLOW_NAME_MAX = 255;
