# Work log: Google sign-in always shows the account chooser

## 1. Metadata

- Date: 2026-10-10
- Branch: `fix/google-select-account` (from `dev`)
- Area: identity-service, Google OIDC login
- Status: done, committed, not merged

## 2. Summary

Signing in with Google always landed in the previously used Google account: the authorization URL had no `prompt`, so Google silently reused the browser's Google session. `GoogleOidcAdapter.buildAuthorizationUrl` now adds `prompt=select_account`, so Google always shows its account chooser. Only Weav sign-in/sign-up (web and mobile) changes; workspace connections (Gmail/Drive) use their own OAuth flow.

## 3. Changes

- `services/identity-service/.../security/oauth/GoogleOidcAdapter.java`: `prompt=select_account` in the authorization request.
- `GoogleOidcAdapterIntegrationTest.authorizationUrlUsesExactRegisteredRedirectScopesAndServerPkce`: asserts the parameter.

## 4. Checks

- GitNexus impact `buildAuthorizationUrl`: `UNKNOWN`; text search found one caller, `OAuthFlowCoordinator` (Google start).
- `./mvnw test` (UTC) on the dev base: `GoogleOidcAdapterIntegrationTest` 14/14, `OAuthFlowCoordinatorTest` 14/14, `GoogleOAuthHttpIntegrationTest` 18/18, `GoogleOAuthMobileDisabledHttpIntegrationTest` 1/1.
- Live (identity-service rebuilt in the dev stack): `POST :8081/auth/oauth/google/start` returns an `accounts.google.com/o/oauth2/v2/auth` URL with `prompt=select_account`.

## 5. Next steps

- Merge into `dev` after review.
