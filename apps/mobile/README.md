# Welcome to your Expo app 👋

## Notification API

Notifications use the existing authenticated HTTP client and `/api/notifications`
gateway routes. `EXPO_PUBLIC_API_MODE` defaults to `http`; set it explicitly to
`mock` for the offline demo. Configure `EXPO_PUBLIC_API_BASE_URL` (local default:
`http://localhost:3000`). A physical device needs the gateway's reachable LAN URL.
Restart Expo after changing environment variables.

The inbox supports refresh, cursor pagination, unread counts, read actions and
delivery status. It polls counts every 10 seconds and the list every 30 seconds.
HTTP 401 clears the existing auth session. HTTP mode starts signed out and requires
a real Identity access token via the existing auth flow; it never uses the demo
session. The gateway proxies `/api/auth/login`, `/register`, `/refresh`, `/logout`
to Identity's corresponding `/auth/*` routes, and `/api/auth/me` to `/users/me`.
The adapter maps Identity's flat token response into the existing mobile session.
Registration creates a user first, then explicitly logs in. JSON refresh/logout
send the refresh token in the body; refresh is not automatically retried.

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
