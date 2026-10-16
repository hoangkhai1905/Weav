import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Bell, Moon, Sun } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useNotificationUnreadCount } from '../../features/notifications/hooks/useNotifications';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { useUIStore } from '../../stores/ui.store';
import { fill } from '../../features/common/fill';
import { MinTouch, Radius } from '../../constants/theme';

/** Light/dark switch alone, for screens that are themselves the notification list. */
export const ThemeToggleButton: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const ThemeIcon = colors.isDark ? Sun : Moon;
  return (
    <Pressable
      testID="header-theme-toggle"
      accessibilityRole="button"
      accessibilityLabel={t(colors.isDark ? 'nav.theme.toLight' : 'nav.theme.toDark')}
      onPress={() => setThemeMode(colors.isDark ? 'light' : 'dark')}
      style={styles.button}
    >
      <ThemeIcon size={20} strokeWidth={1.75} color={colors.textMuted} />
    </Pressable>
  );
};

/** Light/dark switch and the notification bell (red dot while something is unread), shared by the main screens' headers. */
export const HeaderActions: React.FC = () => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { data: unread = 0 } = useNotificationUnreadCount();

  return (
    <View style={styles.row}>
      <ThemeToggleButton />
      <Pressable
        testID="header-notifications"
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? fill(t('nav.notifications.unread'), { n: unread }) : t('nav.notifications')}
        onPress={() => router.navigate('/notifications')}
        style={styles.button}
      >
        <Bell size={20} strokeWidth={1.75} color={colors.textMuted} />
        {unread > 0 ? (
          <View style={[styles.dot, { backgroundColor: colors.danger, borderColor: colors.bg }]} />
        ) : null}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  dot: { position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: Radius.pill, borderWidth: 2 },
});
