import {
  BaseEdge,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { MOTION_DURATION } from '../../lib/motion';

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
  const isActive = Boolean(data?.active && !data.reducedMotion);

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
          transition: 'stroke 180ms ease, stroke-width 180ms ease',
        }}
      />
      {isActive && (
        <g data-testid="execution-edge-active" aria-hidden="true">
          <circle r="4" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5">
            <animateMotion
              path={edgePath}
              dur={`${MOTION_DURATION.packet}s`}
              repeatCount="1"
              fill="freeze"
            />
          </circle>
        </g>
      )}
    </>
  );
}
