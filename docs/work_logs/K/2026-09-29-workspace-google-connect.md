# 2026-09-29 — Workspace Google Connect fails with DependencyUnavailableException

## Status
Root cause found and config fixed; waiting for the real click-through to be confirmed in the browser.

## Root cause
`GoogleOAuthProvider.requireConfiguredClient()` throws `DependencyUnavailableException` when the
workspace-service Google client is blank. Root `.env` had `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`
empty (identity login uses the separate `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, which were set).
`GOOGLE_OAUTH_FRONTEND_RETURN_URL` also pointed to `:3000` instead of the Vite port `:5173`.

## Changes
- Local `.env` (gitignored): filled workspace OAuth client from the existing web client, return URL → `http://localhost:5173/connections`.
- `services/workspace-service/.../provider/google/GoogleOAuthProvider.java`: warn log when the client is not configured (no secrets logged).

## Verification
- GitNexus impact `requireConfiguredClient` upstream: LOW (authorizationUrl, exchangeAuthorizationCode, refreshAccessToken).
- `./mvnw test -Dtest=GoogleOAuthProviderTest`: 9/9 pass.
- Recreated `workspace-service` container; env var lengths non-zero; service started.

## Follow-up: builder inspector "Save changes" did nothing
- Cause: the inspector footer button in `apps/web/src/pages/WorkflowBuilderPage.tsx` had no `onClick`, so no request was sent (hence no web/docker log).
- Fix: wired it to the existing `handleSaveDraft` (same as header Save), with the same disabled/busy state.
- Verification: `tsc -b` pass; eslint on the file shows 2 pre-existing errors (lines ~343, ~691), none from this change. Browser click-through not done: no seeded test account; user to confirm.
- Note: `email.send` stays "Unavailable" by design — `UnavailableNodeExecutor` in workflow-service and the FE readiness message block publish; Gmail send is not implemented yet (and workspace Gmail scope is `gmail.metadata`, which cannot send).

## Next
- Add `http://localhost:8082/oauth/google/callback` to the Google Cloud OAuth client's authorized redirect URIs.
- Click Connect Google on `/connections` and confirm the consent → callback → ACTIVE flow.
