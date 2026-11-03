# Push notifications (Android)

Every new inbox notification is also sent as an Expo push to each device the user signed in on. The app registers its token after sign-in (`src/features/notifications/push-notifications.ts`) and removes it on sign-out. Tapping a push opens the Notifications screen.

Push does not work in Expo Go. Use a development build or an EAS build.

## One-time setup

1. **Firebase project.** In the [Firebase console](https://console.firebase.google.com), create a project and add an Android app with package `com.truong0910.mobile`. Download `google-services.json`.
2. **App config.**
   - Local builds: put the file at `apps/mobile/google-services.json`. It is git-ignored, so never commit it.
   - EAS builds: `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview`. `app.config.js` picks up either source; with neither, the app still builds but cannot get a push token.
3. **FCM V1 key for Expo.** In Firebase, go to Project settings → Service accounts → Generate new private key. Then run `eas credentials` → Android → `com.truong0910.mobile` → Google Service Account → upload the key for FCM V1. Keep the JSON key out of the repo.
4. **Backend.** In the notification-service environment, set `NOTIFICATION_EXPO_ENABLED=true`. Set `EXPO_ACCESS_TOKEN` only if Expo enhanced push security is turned on. Apply the migration `202611030001_push_devices` (`pnpm --dir services/notification-service db:migrate`).
5. **Rebuild the app** (`eas build -p android --profile preview`), because `google-services.json` and the notifications plugin are native config.

## Check it works

1. Sign in on a real phone and allow notifications. A row should appear in `notification.push_devices`.
2. Trigger any inbox event, for example run a workflow, then put the app in the background.
3. The push shows on the lock screen. If it does not, look at the `EXPO_PUSH` row in `notification.notification_deliveries`: `last_error` holds the Expo error code, such as `EXPO_DeviceNotRegistered` or `PROVIDER_DISABLED`.
