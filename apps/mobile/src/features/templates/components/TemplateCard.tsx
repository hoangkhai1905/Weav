import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NodeTile } from '../../../components/ui/NodeTile';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, MinTouch, Radius, Typography } from '../../../constants/theme';
import type { TemplateSummary } from '../../../domain/template/template.types';
import { templateGroup } from '../template.helpers';

const TILES_SHOWN = 5;

/** A ready-made template: what starts it, its name and description, the step icons and a "use" button. */
export const TemplateCard: React.FC<{ template: TemplateSummary; onOpen: () => void }> = ({ template, onOpen }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const description = template.description?.trim();
  const extra = template.nodeTypes.length - TILES_SHOWN;

  return (
    <Pressable
      testID={`template-card-${template.id}`}
      accessibilityRole="button"
      accessibilityLabel={template.name}
      accessibilityHint={t('tpl.item.hint')}
      onPress={onOpen}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[styles.group, { color: colors.textSubtle }]}>{t(`tpl.group.${templateGroup(template.nodeTypes)}`)}</Text>
      <Text style={[styles.name, { color: colors.text }]}>{template.name}</Text>
      {description ? (
        <Text numberOfLines={2} style={[Typography.body, { color: colors.textMuted }]}>
          {description}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <View accessibilityElementsHidden style={styles.tiles}>
          {template.nodeTypes.slice(0, TILES_SHOWN).map((type, i) => (
            <NodeTile key={`${type}-${i}`} type={type} size={26} />
          ))}
          {extra > 0 ? <Text style={[Typography.mono, { color: colors.textSubtle }]}>{`+${extra}`}</Text> : null}
        </View>
        <View style={[styles.use, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}>
          <Text style={[styles.useLabel, { color: colors.text }]}>{t('tpl.use')}</Text>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderWidth: 1, borderRadius: Radius.lg },
  group: { fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16 },
  name: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tiles: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  use: { minHeight: MinTouch - 4, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1 },
  useLabel: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
});
