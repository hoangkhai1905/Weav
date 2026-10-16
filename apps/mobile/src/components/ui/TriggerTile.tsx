import React from 'react';
import { Clock, Hand, Mail, MessageCircle, Webhook, Workflow, type LucideIcon } from 'lucide-react-native';
import type { ExecutionTriggerType } from '../../domain/execution/execution.types';
import { StepTile } from './StepTile';

const ICON: Record<ExecutionTriggerType, LucideIcon> = {
  MANUAL: Hand,
  SCHEDULE: Clock,
  WEBHOOK: Webhook,
  TELEGRAM: MessageCircle,
  GMAIL: Mail,
  WORKFLOW_EVENT: Workflow,
};

/** What started a run, as an icon tile (never the raw trigger code). */
export const TriggerTile: React.FC<{ type: ExecutionTriggerType; size?: number }> = ({ type, size }) => {
  const Icon = ICON[type] ?? Hand;
  return <StepTile kind="trigger" size={size}>{(color) => <Icon size={18} strokeWidth={1.75} color={color} />}</StepTile>;
};
