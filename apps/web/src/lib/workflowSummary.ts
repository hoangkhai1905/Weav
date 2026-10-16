/**
 * Plain-language summary of a workflow for the list ("Chạy khi có email mới / Rồi gửi email"): built from the node
 * types only, using i18n phrases `wfsum.trigger.<type>` / `wfsum.step.<type>`; unknown types fall back to the
 * node's friendly label so no raw code such as `trigger.webhook` is ever shown.
 */
export interface SummaryNode { id: string; type: string }
export interface SummaryEdge { source: string; target: string }

const MAX_STEPS = 4;

/** Step node types in run order: breadth-first from the trigger(s) along the edges, then any unconnected node. */
export function orderedStepTypes(nodes: SummaryNode[], edges: SummaryEdge[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const queue = nodes.filter((node) => node.type.startsWith('trigger.')).map((node) => node.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(next.get(id) ?? []));
  }
  for (const node of nodes) if (!seen.has(node.id)) order.push(node.id);
  return order.map((id) => byId.get(id)?.type).filter((type): type is string => Boolean(type) && !(type as string).startsWith('trigger.'));
}

function phrase(key: string, fallbackType: string, t: (key: string) => string, labelOf: (type: string) => string): string {
  const text = t(key);
  return text === key ? labelOf(fallbackType) : text;
}

export function describeWorkflow(
  triggerType: string | undefined,
  stepTypes: string[] | undefined,
  t: (key: string) => string,
  labelOf: (type: string) => string,
): { when: string; then: string | null } {
  const when = triggerType ? phrase(`wfsum.trigger.${triggerType}`, triggerType, t, labelOf) : t('wfsum.trigger.unknown');
  if (!stepTypes || stepTypes.length === 0) return { when, then: null };
  const phrases = stepTypes.slice(0, MAX_STEPS).map((type) => phrase(`wfsum.step.${type}`, type, t, labelOf));
  const unique = phrases.filter((value, index) => index === 0 || value !== phrases[index - 1]);
  return { when, then: unique.join(t('wfsum.joiner')) + (stepTypes.length > MAX_STEPS ? '…' : '') };
}
