import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { LayoutDashboard, GitFork, Activity, Bell, User } from 'lucide-react-native';
import { useNotificationUnreadCount } from '../../../features/notifications/hooks/useNotifications';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

export default function TabsLayout() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { data: unreadCount = 0 } = useNotificationUnreadCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.tabBg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="workflows"
        options={{
          title: t('tab.workflows'),
          tabBarIcon: ({ color, size }) => <GitFork color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="executions"
        options={{
          title: t('tab.executions'),
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('tab.notifications'),
          tabBarIcon: ({ color, size }) => (
            <View style={styles.iconWrapper}>
              <Bell color={color} size={size - 2} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab.profile'),
          tabBarIcon: ({ color, size }) => <User color={color} size={size - 2} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
});
