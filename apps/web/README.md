# WEAV Web Application (`apps/web`)

> 📖 **Hướng dẫn Lập trình Frontend & Agent Skills**: Xem chi tiết tại [FRONTEND_GUIDE.md](../../docs/development/FRONTEND_GUIDE.md).

React + TypeScript + Vite web application for WEAV platform.

## Notification API

Notifications default to HTTP through `/api/notifications` on the API Gateway.
Configure `VITE_API_BASE_URL` (default `http://localhost:3000`); the existing
`VITE_API_GATEWAY_URL` override takes precedence. Set `VITE_API_MODE=mock` to use
the localStorage notification demo. Other mock repositories are unchanged.
Restart Vite after changing environment variables.

The inbox includes refresh, cursor pagination, read actions and delivery status.
The topbar and inbox share an unread count query (10-second polling); the list
refreshes every 30 seconds. Requests use the existing `weav_token`; HTTP 401 uses
the existing logout/login redirect. The existing login/register forms now use
Identity's core email/password contract through `/api/auth/*`, verified against
`origin/codex/identity-m3`. Registration explicitly logs in after creating the user.
HTTP mode does not expose demo login. The current user is reloaded via
`/api/auth/me` when a stored access token exists.

Access-token storage retains the existing `weav_token` convention. Refresh material
is kept only in memory for logout; this integration does not implement automatic
browser refresh or Google OAuth/cookie transport. After access expiry, sign in again.
The gateway's `IDENTITY_SERVICE_URL` must target a running Identity instance sharing
the Notification service's JWT issuer, audience and backend signing configuration.

For cross-origin browser requests, configure `CORS_ALLOWED_ORIGINS` on the gateway
with the frontend origins. Development defaults include localhost/127.0.0.1 ports
5173 and 8081; other ports or LAN browser origins must be listed explicitly.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
