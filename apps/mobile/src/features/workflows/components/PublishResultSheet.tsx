import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { Sheet } from '../../../components/ui/Sheet';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Fonts, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { WorkflowPublication } from '../../../domain/workflow/workflow.types';
import { fill } from '../../common/fill';

interface PublishResultSheetProps {
  /** Held in component state by the caller and dropped on close: secrets are never cached or stored. */
  publication: WorkflowPublication | null;
  onClose: () => void;
}

/**
 * Shown after publishing. Webhook secrets are returned only once, so they are shown as
 * selectable text (expo-clipboard is not installed) with a clear one-time warning.
 */
export const PublishResultSheet: React.FC<PublishResultSheetProps> = ({ publication, onClose }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const warn = colors.tones.warning;
  const hasSecrets = (publication?.webhooks.length ?? 0) > 0;

  return (
    <Sheet visible={publication !== null} onClose={onClose} title={t('pub.done.title')}>
      {publication ? (
        <>
          <Text style={[Typography.body, { color: colors.textMuted }]}>
            {fill(t('pub.done.version'), { n: publication.version })}
          </Text>
          {hasSecrets ? (
            <View accessibilityRole="alert" style={[styles.warn, { backgroundColor: warn.bg, borderColor: warn.border }]}>
              <TriangleAlert size={18} color={warn.fg} />
              <Text style={[Typography.label, styles.warnText, { color: warn.fg }]}>{t('pub.secret.warning')}</Text>
            </View>
          ) : null}
          {publication.webhooks.map((w) => (
            <View
              key={w.triggerId}
              style={[styles.box, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}
            >
              <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('pub.secret.endpoint')}</Text>
              <Text selectable style={[Typography.mono, { color: colors.text, fontFamily: Fonts?.mono }]}>
                {w.endpointKey}
              </Text>
              <Text style={[Typography.caption, styles.gap, { color: colors.textMuted }]}>{t('pub.secret.secret')}</Text>
              <Text selectable style={[Typography.mono, { color: colors.text, fontFamily: Fonts?.mono }]}>
                {w.secret}
              </Text>
            </View>
          ))}
          {hasSecrets ? (
            <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('ui.copyHint')}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pub.done.close')}
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.primary }]}
          >
            <Text style={[Typography.label, { color: colors.onPrimary }]}>{t('pub.done.close')}</Text>
          </Pressable>
        </>
      ) : null}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.two, borderWidth: 1, borderRadius: Radius.sm },
  warnText: { flex: 1 },
  box: { gap: Spacing.half, padding: Spacing.two, borderWidth: 1, borderRadius: Radius.sm },
  gap: { marginTop: Spacing.two },
  close: { minHeight: MinTouch, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
});
