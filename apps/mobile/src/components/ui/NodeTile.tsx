import React from 'react';
import {
  Calendar,
  Clock,
  Database,
  Globe,
  GitBranch,
  GitFork,
  Hand,
  HardDrive,
  Mail,
  MessageSquare,
  ScanText,
  Send,
  Sparkles,
  Table,
  Type,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react-native';
import { StepTile } from './StepTile';
import { stepKind } from './step-kind';

/** Longest matching prefix wins, so 'google.sheets.append_row' still finds the Sheets icon. */
const ICONS: readonly (readonly [string, LucideIcon])[] = [
  ['trigger.manual', Hand],
  ['trigger.schedule', Clock],
  ['trigger.webhook', Webhook],
  ['trigger.telegram', Send],
  ['trigger.gmail', Mail],
  ['trigger.workflow_event', Workflow],
  ['weav.workflow', Workflow],
  ['http.request', Globe],
  ['email.', Mail],
  ['google.sheets', Table],
  ['google.calendar', Calendar],
  ['google.drive', HardDrive],
  ['telegram.', Send],
  ['discord.', MessageSquare],
  ['slack.', MessageSquare],
  ['teams.', MessageSquare],
  ['format.', Type],
  ['logic.condition', GitBranch],
  ['logic.switch', GitFork],
  ['ai.', Sparkles],
  ['ocr.', ScanText],
  ['data.', Database],
];

function iconFor(type: string): LucideIcon {
  let best: { len: number; icon: LucideIcon } | null = null;
  for (const [prefix, icon] of ICONS) {
    if (type.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, icon };
  }
  return best?.icon ?? Workflow;
}

/** One workflow step as a small tinted tile with an icon (never the raw node code). */
export const NodeTile: React.FC<{ type: string; size?: number }> = ({ type, size = 28 }) => {
  const Icon = iconFor(type);
  return (
    <StepTile kind={stepKind(type)} size={size}>
      {(color) => <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} color={color} />}
    </StepTile>
  );
};
