export type PickableConnection = { id: string; provider: string; status: string; canAttach: boolean };

/** Fills a step's empty `connectionId` when exactly one usable connection of the required provider exists. */
export function autoPickConnections(
  definition: unknown,
  connections: readonly PickableConnection[],
  requiredProvider: (nodeType: string) => string | undefined,
): unknown {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return definition;
  const next = nodes.map((node) => {
    const { type, config } = (node ?? {}) as { type?: unknown; config?: Record<string, unknown> };
    if (typeof type !== 'string' || config?.connectionId) return node;
    const provider = requiredProvider(type);
    if (!provider) return node;
    const usable = connections.filter((c) => c.provider === provider && c.status === 'ACTIVE' && c.canAttach);
    return usable.length === 1 ? { ...(node as object), config: { ...config, connectionId: usable[0].id } } : node;
  });
  return { ...(definition as object), nodes: next };
}
