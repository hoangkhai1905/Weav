import React, { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BeVietnamPro_400Regular } from '@expo-google-fonts/be-vietnam-pro/400Regular';
import { BeVietnamPro_500Medium } from '@expo-google-fonts/be-vietnam-pro/500Medium';
import { BeVietnamPro_600SemiBold } from '@expo-google-fonts/be-vietnam-pro/600SemiBold';
import { BeVietnamPro_700Bold } from '@expo-google-fonts/be-vietnam-pro/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
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
  // Bundled assets load in milliseconds; on error we still render with the system font.
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
    JetBrainsMono_400Regular,
  });
  // React Query cannot see app focus on native: without this, refetchInterval polls (runs every 2 s,
  // notifications) keep going while the app is in the background. The web build uses tab visibility.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => subscription.remove();
  }, []);
  if (!fontsLoaded && !fontError) return null;
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
