import type { ConnectionProvider } from '../../domain/connection/connection.types';
import type { WorkflowDefinition } from '../../domain/workflow/workflow.types';
import { providerForNodeType } from './ai.answers';

export type PickableConnection = { id: string; provider: string; status: string; canAttach: boolean };

/** Providers a step cannot run without; http.request's connection is optional and ai.* has none. */
export function requiredConnectionProvider(nodeType: string): ConnectionProvider | null {
  return nodeType === 'http.request' ? null : providerForNodeType(nodeType);
}

/** Fills a step's empty `connectionId` when exactly one usable connection of the required provider exists. */
export function autoPickConnections(
  definition: WorkflowDefinition,
  connections: readonly PickableConnection[],
  requiredProvider: (type: string) => string | null,
): WorkflowDefinition {
  const nodes = definition.nodes.map((node) => {
    if (node.config?.connectionId) return node;
    const provider = requiredProvider(node.type);
    if (!provider) return node;
    const usable = connections.filter((c) => c.provider === provider && c.status === 'ACTIVE' && c.canAttach);
    return usable.length === 1 ? { ...node, config: { ...node.config, connectionId: usable[0].id } } : node;
  });
  return { ...definition, nodes };
}
