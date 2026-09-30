import React from 'react';
import { Stack, Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);

  if (isHydrating) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

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

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#090d16',
  },
});
