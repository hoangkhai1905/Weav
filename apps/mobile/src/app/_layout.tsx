import React from 'react';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
