import type { WorkflowEdge, WorkflowNode } from '../../domain/workflow/workflow.types';

/**
 * Orders nodes for the vertical flow list: triggers first, then a walk along the edges
 * (breadth first, branches keep edge order). Nodes the walk cannot reach (cycles, orphans)
 * are appended in their stored order so nothing is hidden.
 */
export function orderFlowNodes(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Set(edges.map((e) => e.target));
  const roots = nodes.filter((n) => !incoming.has(n.id) || n.type.startsWith('trigger.'));
  const seen = new Set<string>();
  const out: WorkflowNode[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.shift() as WorkflowNode;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    for (const edge of edges) {
      const next = edge.source === node.id ? byId.get(edge.target) : undefined;
      if (next && !seen.has(next.id)) queue.push(next);
    }
  }
  for (const node of nodes) if (!seen.has(node.id)) out.push(node);
  return out;
}

/** "http.request" -> "http request"; used only when a node has no editor name. */
export function nodeTypeFallback(type: string): string {
  return type.replace(/[._]/g, ' ');
}
