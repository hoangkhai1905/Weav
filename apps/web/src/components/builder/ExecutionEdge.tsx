import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

export interface ExecutionEdgeData extends Record<string, unknown> {
  active?: boolean;
  reducedMotion?: boolean;
}

export type ExecutionEdgeType = Edge<ExecutionEdgeData, 'execution'>;

export function ExecutionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<ExecutionEdgeType>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const isActive = Boolean(data?.active);
  const showPacket = Boolean(isActive && !data?.reducedMotion);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: data?.active ? '#3b82f6' : '#94a3b8',
          strokeWidth: data?.active ? 2.25 : 1.75,
          strokeDasharray: data?.active ? '6 7' : undefined,
          transition: 'stroke 180ms ease, stroke-width 180ms ease',
        }}
      />
      {showPacket && (
        <g data-testid="execution-edge-active" aria-hidden="true">
          <path
            data-testid="execution-edge-flow"
            d={edgePath}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="1 15"
            opacity="0.75"
            pointerEvents="none"
          >
            <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="0.42s" repeatCount="indefinite" />
          </path>
          <circle r="4.5" fill="#2563eb" stroke="#dbeafe" strokeWidth="1.5">
            <animateMotion
              path={edgePath}
              dur="0.72s"
              repeatCount="indefinite"
              fill="freeze"
            />
          </circle>
        </g>
      )}
    </>
  );
}
