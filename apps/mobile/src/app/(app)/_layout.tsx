import React from 'react';
import { Stack, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';
import { OfflineBanner } from '../../components/ui/OfflineBanner';
import { useThemeColors } from '../../hooks/useThemeColors';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const colors = useThemeColors();

  if (isHydrating) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View style={styles.root}>
    <OfflineBanner />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="workflows/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="executions/[workflowId]/[executionId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="executions/lookup/[executionId]" options={{ presentation: 'card' }} />
      <Stack.Screen name="connections/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="workspace/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="ai/generator" options={{ presentation: 'modal' }} />
      <Stack.Screen name="assistant/index" options={{ presentation: 'card' }} />
      <Stack.Screen name="assistant/chat" options={{ presentation: 'card' }} />
      <Stack.Screen name="settings/index" options={{ presentation: 'card' }} />
    </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
