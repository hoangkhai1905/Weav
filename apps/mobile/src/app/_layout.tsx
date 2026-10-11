import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ToastContainer } from '../components/ui/ToastContainer';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  useWorkspace,
  useWorkspaceSessionCleanup,
} from '../features/workspace/hooks/useWorkspace';
import {
  useAuthSessionBootstrap,
  useAuthSessionCacheCleanup,
} from '../features/auth/useAuthSession';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});

function WorkspaceRuntimeBoundary() {
  useAuthSessionBootstrap();
  useAuthSessionCacheCleanup();
  useWorkspaceSessionCleanup();
  useWorkspace();
  return null;
}

export default function RootLayout() {
  const colors = useThemeColors();
  // React Query cannot see app focus on native: without this, refetchInterval polls (runs every 2 s,
  // notifications) keep going while the app is in the background. The web build uses tab visibility.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => subscription.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <WorkspaceRuntimeBoundary />
        <StatusBar style={colors.isDark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
        <ToastContainer />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
