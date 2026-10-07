import React from 'react';
import { Modal, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/** Bottom sheet on a plain RN Modal (no extra dependency). */
export const Sheet: React.FC<SheetProps> = ({ visible, onClose, title, children }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ui.close')}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + Spacing.three },
        ]}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[Typography.title, styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ui.close')}
            onPress={onClose}
            style={styles.close}
          >
            <X size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  title: { flex: 1 },
  close: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  body: { gap: Spacing.three, paddingVertical: Spacing.two },
});
