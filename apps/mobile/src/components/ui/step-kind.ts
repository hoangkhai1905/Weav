// Pure helpers (no react-native import) so Node tests can load them.
import type { StepKind } from '../../constants/palette';

/** Colour family of a workflow step, from its node type ("trigger.gmail" -> trigger, "ai.extract" -> ai). */
export function stepKind(nodeType: string): StepKind {
  if (nodeType.startsWith('trigger.')) return 'trigger';
  if (nodeType.startsWith('ai.')) return 'ai';
  if (nodeType.startsWith('logic.')) return 'logic';
  return 'action';
}
