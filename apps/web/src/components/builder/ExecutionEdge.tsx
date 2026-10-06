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
  const reducedMotion = Boolean(data?.reducedMotion);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: data?.active ? 'var(--run)' : 'var(--border-strong)',
          strokeWidth: data?.active ? 2 : 1.5,
          strokeDasharray: data?.active ? '6 7' : undefined,
          transition: 'stroke 180ms ease, stroke-width 180ms ease',
        }}
      />
      <g data-testid={isActive ? 'execution-edge-active' : 'execution-edge-idle'} aria-hidden="true">
        <path
          data-testid="execution-edge-flow"
          d={edgePath}
          fill="none"
          stroke={isActive ? 'var(--run)' : 'var(--muted-foreground)'}
          strokeWidth={isActive ? 3 : 2}
          strokeLinecap="round"
          strokeDasharray={isActive ? '1 15' : '1 24'}
          opacity={isActive ? 0.9 : 0.35}
          pointerEvents="none"
        >
          {!reducedMotion && (
            <animate
              attributeName="stroke-dashoffset"
              from="0"
              to={isActive ? '-16' : '-25'}
              dur={isActive ? '0.42s' : '1.2s'}
              repeatCount="indefinite"
            />
          )}
        </path>
        {isActive && (
          <circle r="4" fill="var(--run)" stroke="var(--card)" strokeWidth="1.5">
            <animateMotion
              path={edgePath}
              dur="0.72s"
              repeatCount="indefinite"
              fill="freeze"
            />
          </circle>
        )}
      </g>
    </>
  );
}
