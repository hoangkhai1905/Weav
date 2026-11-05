import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { httpClient } from '../../infrastructure/http/http-client';
import { useI18nStore } from '../../stores/i18n.store';

const DEVICES_URL = '/api/v2/notifications/devices';
let registeredToken: string | null = null;

// While the app is open a push still shows as a banner; the inbox screen refreshes on its own.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this device's Expo push token for the signed-in user. With `ask`, first asks for
 * permission; without it (app back in the foreground) it only refreshes an already granted token,
 * which keeps the server's 7-day freshness window open while the session is alive.
 */
async function registerPushDevice(locale: 'vi' | 'en', ask: boolean): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  if (Platform.OS === 'android') {
    // Android 13+ only shows the permission prompt once a channel exists.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Weav',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.granted || !current.canAskAgain || !ask
      ? current
      : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await httpClient.put(DEVICES_URL, { token, locale });
  registeredToken = token;
}

/** Call before sign-out, while the access token still works. Best effort, never throws. */
export async function unregisterPushDevice(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await httpClient.delete(DEVICES_URL, { data: { token }, timeout: 3000 });
  } catch {
    // The next sign-in on this device moves the token to that user anyway.
  }
}

/** Registers for push while signed in (again when the language changes); a tapped push opens the inbox. */
export function usePushNotifications(enabled: boolean): void {
  const router = useRouter();
  const language = useI18nStore((s) => s.language);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!enabled) return;
    const locale = language === 'EN' ? 'en' : 'vi';
    const register = (ask: boolean) =>
      registerPushDevice(locale, ask).catch(() => {
        // No permission, no FCM config or offline: the in-app inbox still works.
      });
    void register(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void register(false);
    });
    return () => subscription.remove();
  }, [enabled, language]);

  useEffect(() => {
    if (!enabled || !response) return;
    Notifications.clearLastNotificationResponse();
    router.push('/(app)/notifications');
  }, [enabled, response, router]);
}
