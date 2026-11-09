import type { AiQuestion } from '../../domain/ai/ai.types';
import type { ConnectionProvider } from '../../domain/connection/connection.types';
import type { WorkflowDefinition } from '../../domain/workflow/workflow.types';
import { fill } from '../common/fill';

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
    case 'google.docs':
      return 'GOOGLE_DRIVE';
    case 'telegram.send_message':
    case 'trigger.telegram':
      return 'TELEGRAM';
    case 'http.request':
      return 'HTTP';
    case 'discord.send_message':
      return 'DISCORD';
    case 'slack.send_message':
      return 'SLACK';
    case 'teams.send_message':
      return 'TEAMS';
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

/** "email.send.subject" -> "Tiêu đề email"; unknown fields are humanized, never shown as raw codes. */
export function questionLabel(q: AiQuestion, t: (key: string) => string): string {
  if (q.code === 'URL') return t('aig.q.URL');
  if (q.code === 'SCHEDULE') return t('aig.q.SCHEDULE');
  if (q.code === 'TIMEZONE') return t('aig.q.TIMEZONE');
  if (q.code === 'CONNECTION') {
    const provider = providerForNodeType(q.field);
    return provider ? fill(t('aig.q.CONNECTION'), { provider: t(`provider.${provider}`) }) : t('aig.q.CONNECTION.generic');
  }
  const name = fieldName(q.field);
  const known = t(`aig.field.${name}`);
  return known !== `aig.field.${name}` ? known : fill(t('aig.q.VALUE.generic'), { field: humanizeField(name) });
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
