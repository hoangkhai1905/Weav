import React from 'react';
import { Tabs } from 'expo-router';

/**
 * The four main screens. The visible bar lives in ../_layout.tsx (<AppTabBar />) so that detail screens
 * pushed on the stack keep it too; this navigator only keeps each tab's state.
 */
export default function TabsLayout() {
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="workflows" />
      <Tabs.Screen name="executions" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
