import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, Fonts, Spacing, Typography } from '../../../constants/theme';
import type { Workflow } from '../../../domain/workflow/workflow.types';
import { fill } from '../../common/fill';
import { nodeTypeFallback, orderFlowNodes } from '../workflow-flow';

/** Label of a node: editor name, else a friendly type name, else the raw type text. */
export function useNodeLabel(): (node: { type: string; name: string | null }) => string {
  const { t } = useTranslation();
  return (node) => {
    if (node.name) return node.name;
    const key = `node.type.${node.type}`;
    const friendly = t(key);
    return friendly === key ? nodeTypeFallback(node.type) : friendly;
  };
}

/** Vertical, readable flow (not a canvas): numbered steps in edge order. */
export const FlowList: React.FC<{
  workflow: Pick<Workflow, 'nodes' | 'edges'>;
  /** Reason lines of steps that still need setup; those steps turn red and tappable. */
  issuesByStep?: Map<string, string[]>;
  onStepPress?: (nodeId: string) => void;
}> = ({ workflow, issuesByStep, onStepPress }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const labelOf = useNodeLabel();
  const ordered = useMemo(() => orderFlowNodes(workflow.nodes, workflow.edges), [workflow.nodes, workflow.edges]);

  if (ordered.length === 0) {
    return <Text style={[Typography.body, { color: colors.textMuted }]}>{t('wfd.flow.empty')}</Text>;
  }

  return (
    <View accessibilityRole="list">
      {ordered.map((node, index) => {
        const label = labelOf(node);
        const typeLabel = t(`node.type.${node.type}`);
        // Second line only when it adds something: a custom name differing from the type name.
        const showType = node.name !== null && typeLabel !== `node.type.${node.type}` && typeLabel !== label;
        const reasons = issuesByStep?.get(node.id);
        const stepLabel = `${fill(t('wfd.flow.step'), { n: index + 1 })}: ${label}`;
        return (
          <Pressable
            key={node.id}
            accessible
            accessibilityRole={reasons ? 'button' : undefined}
            accessibilityLabel={reasons ? `${stepLabel}. ${t('wfd.setup.pill')}. ${reasons[0]}` : stepLabel}
            disabled={!reasons || !onStepPress}
            onPress={() => onStepPress?.(node.id)}
            style={[styles.row, reasons && { borderLeftWidth: 2, borderLeftColor: colors.tones.danger.border, paddingLeft: Spacing.two }]}
          >
            <Text style={[Typography.body, styles.num, { color: colors.textSubtle, fontFamily: Fonts?.mono }]}>{index + 1}</Text>
            <View style={styles.body}>
              <Text style={[Typography.body, styles.label, { color: colors.text }]}>{label}</Text>
              {showType ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{typeLabel}</Text> : null}
              {reasons ? (
                <>
                  <Text style={[Typography.caption, { color: colors.tones.danger.fg }]}>{t('wfd.setup.pill')}</Text>
                  <Text style={[Typography.caption, { color: colors.tones.danger.fg }]}>{reasons[0]}</Text>
                </>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  num: { width: 20, textAlign: 'right' },
  body: { flex: 1, gap: Spacing.half, paddingBottom: Spacing.three },
  label: { fontFamily: FontFamily.medium },
});
