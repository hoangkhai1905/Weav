import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { History, House, User, Workflow } from 'lucide-react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { FontFamily, MinTouch, Spacing } from '../../constants/theme';
import { activeTab, MAIN_TABS, tabBarHidden, type MainTab } from './tab-bar';

const ICONS = { home: House, workflows: Workflow, executions: History, profile: User } satisfies Record<MainTab, unknown>;

function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/** The four-item bottom bar, rendered once under the whole signed-in stack so detail screens keep it too. */
export const AppTabBar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  if (keyboard || tabBarHidden(pathname)) return null;
  const current = activeTab(pathname);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('nav.main')}
      style={[styles.bar, { backgroundColor: colors.tabBg, borderTopColor: colors.border, paddingBottom: Spacing.one + insets.bottom }]}
    >
      {MAIN_TABS.map((tab) => {
        const selected = tab.key === current;
        const Icon = ICONS[tab.key];
        const color = selected ? colors.text : colors.textSubtle;
        return (
          <Pressable
            key={tab.key}
            testID={`tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(tab.labelKey)}
            onPress={() => router.navigate(tab.href as never)}
            style={styles.item}
          >
            <Icon size={20} strokeWidth={1.75} color={color} />
            <Text style={[styles.label, { color, fontFamily: FontFamily.medium }]}>{t(tab.labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: Spacing.one, paddingHorizontal: Spacing.one },
  item: { flex: 1, minHeight: MinTouch + 4, alignItems: 'center', justifyContent: 'center', gap: Spacing.half },
  label: { fontSize: 11, lineHeight: 14 },
});
