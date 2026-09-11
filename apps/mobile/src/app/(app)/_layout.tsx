import React from 'react';
import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../../stores/auth.store';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090d16' } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="workflows/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="executions/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="connections/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="workspace/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="telegram/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="ai/generator" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings/index" options={{ presentation: 'card' }} />
    </Stack>
  );
}
