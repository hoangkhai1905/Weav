import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  createAuthSessionStorage,
  type AuthSessionStorage,
} from './auth-session.storage';

const isMockMode = process.env.EXPO_PUBLIC_API_MODE === 'mock';

export const authSessionStorage: AuthSessionStorage = createAuthSessionStorage({
  platform: Platform.OS,
  mockMode: isMockMode,
  secureStore: SecureStore,
});
