import React from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { ExternalLink, Share2 } from 'lucide-react-native';
import { Sheet } from '../../../components/ui/Sheet';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';

interface SetupOnWebSheetProps {
  /** Step being finished; null keeps the sheet closed. */
  step: { name: string; reasons: string[] } | null;
  /** Deep link into the web builder, or null when no web URL is configured. */
  url: string | null;
  onClose: () => void;
}

/** Tells the user what a red step is missing and hands them to the web builder (editing is web-only). */
export const SetupOnWebSheet: React.FC<SetupOnWebSheetProps> = ({ step, url, onClose }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const danger = colors.tones.danger;

  return (
    <Sheet visible={step !== null} onClose={onClose} title={step?.name ?? ''}>
      {step ? (
        <>
          <Text style={[Typography.body, { color: colors.textMuted }]}>{t('wfd.setup.sheetSubtitle')}</Text>
          <View style={[styles.box, { backgroundColor: danger.bg, borderColor: danger.border }]}>
            <Text style={[Typography.label, { color: danger.fg }]}>{t('wfd.setup.missing')}</Text>
            {step.reasons.map((reason) => (
              <Text key={reason} style={[Typography.body, { color: danger.fg }]}>
                {`• ${reason}`}
              </Text>
            ))}
          </View>
          {url ? (
            <>
              <Pressable
                testID="setup-open-web"
                accessibilityRole="button"
                accessibilityLabel={t('wfd.setup.openWeb')}
                onPress={() => void Linking.openURL(url)}
                style={[styles.button, { backgroundColor: colors.button }]}
              >
                <ExternalLink size={16} color={colors.onButton} />
                <Text style={[Typography.label, { color: colors.onButton }]}>{t('wfd.setup.openWeb')}</Text>
              </Pressable>
              <Pressable
                testID="setup-share-link"
                accessibilityRole="button"
                accessibilityLabel={t('wfd.setup.share')}
                onPress={() => void Share.share({ message: url })}
                style={[styles.button, { backgroundColor: colors.card, borderColor: colors.borderStrong, borderWidth: 1 }]}
              >
                <Share2 size={16} color={colors.text} />
                <Text style={[Typography.label, { color: colors.text }]}>{t('wfd.setup.share')}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={[Typography.body, { color: colors.textMuted }]}>{t('wfd.setup.noUrl')}</Text>
          )}
        </>
      ) : null}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  box: { gap: Spacing.one, padding: Spacing.two, borderWidth: 1, borderRadius: Radius.sm },
  button: { minHeight: MinTouch, flexDirection: 'row', gap: Spacing.two, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
});
