# Demo deployment: mobile handoff

For the partner. The demo stack runs at `https://api.weav.id.vn` (see `docs/deployment/demo-runbook.md`). **Mobile is out of the demo unless the steps below are done.**

## What to change

1. Point the app at the public API. Both values are inlined at bundle time, so rebuild or publish an EAS update after changing them:
   ```
   EXPO_PUBLIC_API_BASE_URL=https://api.weav.id.vn
   EXPO_PUBLIC_IDENTITY_URL=https://api.weav.id.vn
   ```
2. Google sign-in: the backend needs `OAUTH_MOBILE_RETURN_TARGET_URI` (the deep link the app registers, for example `weav://auth/callback`) set in K's `prod.env`. It is empty by default, so tell K the exact value.

## How to check

1. Install the rebuilt app and sign in with e-mail: the dashboard loads.
2. Google sign-in returns to the app (needs step 2).
3. Open a workflow and run it: the run reaches SUCCESS.
