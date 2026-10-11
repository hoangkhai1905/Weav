# Welcome to your Expo app 👋

## Notification API

Notifications use the authenticated v2 inbox routes under `/api/v2/notifications`:
localized list (`locale`, `category`, `unreadOnly`, cursor/limit), global unread
count, mark-one-read, and mark-all-read. The server supplies localized title and
message; read state comes from `readAt`. Delivery/provider status is not part of
the inbox. Counts poll every 10 seconds and the list every 30 seconds.

`EXPO_PUBLIC_API_MODE` defaults to `http`; set it explicitly to `mock` for the
offline demo. Configure `EXPO_PUBLIC_API_BASE_URL` (local default:
`http://localhost:3000`). A physical device needs the gateway's reachable LAN URL.
Restart Expo after changing environment variables. HTTP mode starts signed out and
requires a real Identity access token via the existing auth flow; it never falls
back to mock data on HTTP errors. A 401 expires the current existing auth session,
while a delayed response from a superseded session is ignored.

Google sign-in (native builds only) needs `EXPO_PUBLIC_IDENTITY_URL`, the public
HTTPS URL of identity-service (for example a `cloudflared` tunnel to `:8081`), and a
dev client or EAS build that includes the `weav` scheme and `expo-crypto`; Expo Go
and web cannot receive `weav://auth/callback`, so the button stays hidden there.
Identity must have `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback` and a
`GOOGLE_REDIRECT_URI` on that tunnel registered in Google Cloud Console. Flow and
errors: `docs/handoff/2026-10-week6-mobile.md` section A.

The focused Node checks use the repository's existing `.test.cjs` convention and
can be run from the repo root:

```bash
pnpm --dir apps/mobile exec node --test src/infrastructure/http/notification.http.contract.test.cjs src/infrastructure/http/notification.mapper.test.cjs src/features/notifications/notification.query.test.cjs src/features/notifications/notification.target.test.cjs src/features/auth/auth-session.scope.test.cjs src/features/feedback/milestone-toast.test.cjs src/features/feedback/milestone-toast.policy.test.cjs src/infrastructure/http/http-notification.repository.integration.test.cjs src/infrastructure/mock/mock-notification.repository.test.cjs
pnpm --dir apps/mobile exec tsc --noEmit
```

An opt-in Expo Web smoke test reuses the existing workspace Playwright install;
start Expo in explicit mock mode and with `EXPO_NO_DOTENV=1`, then run
`pnpm --dir apps/web exec playwright test --config ../mobile/e2e/playwright.config.cjs`.
The mock session is a UI fixture only, not proof of an Identity login or a live
Gateway/Notification service.

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
