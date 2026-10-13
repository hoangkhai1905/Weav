import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NodeTile } from '../../../components/ui/NodeTile';
import { stepKind } from '../../../components/ui/step-kind';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, Radius, Typography } from '../../../constants/theme';
import type { Workflow } from '../../../domain/workflow/workflow.types';
import { fill } from '../../common/fill';
import { orderFlowNodes } from '../workflow-flow';
import { useNodeLabel } from './FlowList';

/** The steps of a workflow as cards joined by a short line: "when it runs", then "Bước 2", "Bước 3"... */
export const FlowCards: React.FC<{ workflow: Pick<Workflow, 'nodes' | 'edges'> }> = ({ workflow }) => {
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
        // A second line only when it adds something: a custom name differing from the type name.
        const showType = node.name !== null && typeLabel !== `node.type.${node.type}` && typeLabel !== label;
        const kind = stepKind(node.type) === 'trigger' ? t('wfd.step.trigger') : fill(t('wfd.flow.step'), { n: index + 1 });
        return (
          <View key={node.id}>
            <View
              accessible
              accessibilityLabel={`${kind}: ${label}`}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <NodeTile type={node.type} size={36} />
              <View style={styles.text}>
                <Text style={[Typography.caption, { color: colors.textSubtle }]}>{kind}</Text>
                <Text style={[styles.title, { color: colors.text }]}>{label}</Text>
                {showType ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{typeLabel}</Text> : null}
              </View>
            </View>
            {index < ordered.length - 1 ? <View style={[styles.link, { backgroundColor: colors.borderStrong }]} /> : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 14, borderWidth: 1, borderRadius: Radius.lg },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  link: { width: 1, height: 16, marginLeft: 32 },
});
