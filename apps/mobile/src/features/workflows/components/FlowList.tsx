import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Fonts, Radius, Spacing, Typography } from '../../../constants/theme';
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
export const FlowList: React.FC<{ workflow: Pick<Workflow, 'nodes' | 'edges'> }> = ({ workflow }) => {
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
        return (
          <View
            key={node.id}
            accessible
            accessibilityLabel={`${fill(t('wfd.flow.step'), { n: index + 1 })}: ${label}`}
            style={styles.row}
          >
            <View style={styles.rail}>
              <View style={[styles.badge, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}>
                <Text style={[Typography.label, { color: colors.primary, fontFamily: Fonts?.mono }]}>{index + 1}</Text>
              </View>
              {index < ordered.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[Typography.body, styles.label, { color: colors.text }]}>{label}</Text>
              {showType ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{typeLabel}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  rail: { width: 28, alignItems: 'center' },
  badge: { width: 28, height: 28, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, marginVertical: Spacing.one },
  body: { flex: 1, gap: Spacing.half, paddingBottom: Spacing.three, paddingTop: 3 },
  label: { fontWeight: '600' },
});
