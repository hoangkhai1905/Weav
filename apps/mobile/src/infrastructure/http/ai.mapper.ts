import type {
  AiGenerationResult,
  AiQuestionCode,
  AiUnsupportedReasonCode,
} from '../../domain/ai/ai.types';
import { arr, invalid, oneOf, rec, recOrEmpty, str } from './mapper-utils';
import { mapWorkflowDefinition, mapWorkflowNodes } from './workflow.mapper';

const QUESTION_CODES = ['URL', 'SCHEDULE', 'TIMEZONE', 'VALUE', 'CONNECTION'] as const satisfies readonly AiQuestionCode[];
const REASON_CODES = [
  'CAPABILITY_UNAVAILABLE',
  'OUT_OF_SCOPE',
  'AMBIGUOUS_REQUEST',
  'INVALID_INTENT',
] as const satisfies readonly AiUnsupportedReasonCode[];

export function mapLayout(value: unknown): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  for (const [id, point] of Object.entries(recOrEmpty(value))) {
    const p = recOrEmpty(point);
    if (typeof p.x === 'number' && typeof p.y === 'number') layout[id] = { x: p.x, y: p.y };
  }
  return layout;
}

/** The response is a union on `status`: ready | needs_input | unsupported. */
export function mapGenerationResult(value: unknown): AiGenerationResult {
  const r = rec(value, 'generation');
  switch (r.status) {
    case 'ready': {
      const definition = mapWorkflowDefinition(r.definition);
      const layout = mapLayout(r.layout);
      return {
        status: 'ready',
        name: str(r, 'name', 'generation'),
        definition,
        nodes: mapWorkflowNodes(definition, null, layout),
        edges: definition.edges,
        layout,
      };
    }
    case 'needs_input':
      return {
        status: 'needs_input',
        questions: arr(r, 'questions', 'generation').map((q) => {
          const question = rec(q, 'question');
          return {
            code: oneOf(question, 'code', QUESTION_CODES, 'question'),
            field: str(question, 'field', 'question'),
          };
        }),
      };
    case 'unsupported':
      return {
        status: 'unsupported',
        reasons: arr(r, 'reasons', 'generation').map((reason) => ({
          code: oneOf(rec(reason, 'reason'), 'code', REASON_CODES, 'reason'),
        })),
      };
    default:
      return invalid('generation.status');
  }
}
