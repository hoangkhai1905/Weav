import type { Node, Edge } from '@xyflow/react';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../types/workflow.types';

/**
 * Converts domain WorkflowDefinition into React Flow Node[] and Edge[]
 */
export function workflowToReactFlow(workflow: WorkflowDefinition): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: 'customNode',
    position: node.position || { x: 250, y: 150 },
    data: {
      id: node.id,
      name: node.name,
      nodeType: node.type,
      config: node.config || {},
    },
  }));

  const edges: Edge[] = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourcePort,
    targetHandle: edge.targetPort,
    label: edge.label,
    animated: true,
    style: { stroke: '#2563EB', strokeWidth: 2 },
  }));

  return { nodes, edges };
}

/**
 * Converts React Flow Node[] and Edge[] back into domain WorkflowDefinition
 */
export function reactFlowToWorkflow(
  nodes: Node[],
  edges: Edge[],
  currentWorkflow: WorkflowDefinition
): WorkflowDefinition {
  const domainNodes: WorkflowNode[] = nodes.map((node) => ({
    id: node.id,
    type: (node.data?.nodeType as string) || 'trigger.manual',
    name: (node.data?.name as string) || node.id,
    config: (node.data?.config as Record<string, unknown>) || {},
    position: {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    },
  }));

  const domainEdges: WorkflowEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourcePort: edge.sourceHandle || undefined,
    targetPort: edge.targetHandle || undefined,
    label: typeof edge.label === 'string' ? edge.label : undefined,
  }));

  return {
    ...currentWorkflow,
    nodes: domainNodes,
    edges: domainEdges,
    updatedAt: new Date().toISOString(),
  };
}
