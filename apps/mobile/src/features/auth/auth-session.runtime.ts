import { Platform } from 'react-native';
import { authRepository } from '../../infrastructure/repository-factory';
import { authSessionStorage } from '../../infrastructure/auth/expo-auth-session.storage';
import { registerAuthSessionInvalidator } from '../../infrastructure/auth/auth-session.persistence';
import { useAuthStore } from '../../stores/auth.store';
import { createAuthSessionCoordinator } from './auth-session.coordinator';

const isMockMode = process.env.EXPO_PUBLIC_API_MODE === 'mock';
const persistenceEnabled = !isMockMode && Platform.OS !== 'web';

const coordinator = createAuthSessionCoordinator({
  persistenceEnabled,
  storage: authSessionStorage,
  repository: {
    restoreSession: (refreshToken) => authRepository.restoreSession(refreshToken),
    logout: (refreshToken) => authRepository.logout(refreshToken),
  },
  store: {
    getState: () => useAuthStore.getState(),
    setHydrating: (isHydrating) => useAuthStore.getState().setHydrating(isHydrating),
    setAuthSession: (user, tokens) => useAuthStore.getState().setAuthSession(user, tokens),
    clearAuthSession: () => useAuthStore.getState().clearAuthSession(),
    setAuthError: (message) => useAuthStore.getState().setAuthError(message),
  },
});

registerAuthSessionInvalidator(coordinator.invalidate);

export const bootstrapAuthSession = coordinator.bootstrap;
export const retryBootstrapAuthSession = coordinator.retryBootstrap;
export const beginAuthOperation = coordinator.beginAuthOperation;
export const establishAuthSession = coordinator.establishSession;
export const logoutAuthSession = coordinator.logout;
export const expireAuthSession = coordinator.expire;
export const refreshAuthSession = coordinator.refresh;
