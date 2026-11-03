import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bot, History, House, User, Workflow } from 'lucide-react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { FontFamily, MinTouch, Radius, Spacing } from '../../constants/theme';
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
  const [barHeight, setBarHeight] = useState(0);
  if (keyboard || tabBarHidden(pathname)) return null;
  const current = activeTab(pathname);
  const showAssistant = !pathname.startsWith('/assistant');

  return (
    <>
    {showAssistant && (
      <Pressable
        testID="assistant-fab"
        accessibilityRole="button"
        accessibilityLabel={t('prof.assistant')}
        onPress={() => router.push('/(app)/assistant/chat')}
        style={[styles.fab, { bottom: barHeight + Spacing.three, backgroundColor: colors.primary }]}
      >
        <Bot size={26} strokeWidth={1.75} color={colors.onPrimary} />
      </Pressable>
    )}
    <View
      onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
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
    </>
  );
};

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: Spacing.one, paddingHorizontal: Spacing.one },
  item: { flex: 1, minHeight: MinTouch + 4, alignItems: 'center', justifyContent: 'center', gap: Spacing.half },
  label: { fontSize: 11, lineHeight: 14 },
  fab: {
    position: 'absolute',
    right: Spacing.three,
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
