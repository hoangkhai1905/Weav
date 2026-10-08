import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';
import { Sheet } from './Sheet';

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmation dialog on the shared Sheet (RN Alert does nothing on web, so it is not used). */
export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({
  visible,
  title,
  message,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const bg = destructive ? colors.tones.danger.fg : colors.primary;
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Text style={[Typography.body, { color: colors.textMuted }]}>{message}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ui.cancel')}
          disabled={busy}
          onPress={onClose}
          style={[styles.btn, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
        >
          <Text style={[Typography.label, { color: colors.text }]}>{t('ui.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onConfirm}
          style={[styles.btn, { backgroundColor: bg, borderColor: bg, opacity: busy ? 0.7 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={[Typography.label, { color: colors.onPrimary }]}>{confirmLabel}</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  btn: {
    flex: 1,
    minHeight: MinTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
});
