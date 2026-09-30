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

## Feature: Gmail `email.send` node (branch `feature/gmail-send-node`)
Status: complete. User confirmed a real end-to-end run (reconnect with `gmail.send` → builder → publish → run → email delivered).

Decisions
- Workspace GMAIL required scopes are now `openid, email, gmail.metadata, gmail.send`. GitNexus impact on `GoogleOAuthScopePolicy.requiredScopes`: CRITICAL (resolve, refresh, callback, test, authorizationUrl flows) — intended: existing Gmail connections fail resolve/test (422) until reconnected once.
- Workflow: new `GmailClient` + `GmailNodeExecutor` (mirrors Sheets), `PinnedHttpTransport.executeGmailSendWithBearerToken` locked to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
- Sending is not idempotent → only credential-resolution failures and Gmail 429 are retryable; timeout/5xx/ambiguous responses are terminal (no duplicate emails).
- Recipient/subject/body validated (1-10 recipients, CR/LF header-injection guard, 64 KiB body); subject RFC 2047 UTF-8 encoded (Vietnamese OK).
- `email.send.connectionId` added to NodeCatalog, DefinitionValidator (required at publish only), and `packages/contracts/http/workflow/definition.schema.json`. The unconfigured-dependency example fixture now uses `telegram.send_message`.
- Web: Gmail connection picker (ACTIVE + canAttach GMAIL only; key omitted when cleared because `''` fails draft validation), readiness/publish blockers now based on connectionId/to/subject.

Verification
- workspace-service `./mvnw test -DargLine=-Duser.timezone=UTC`: 364 run, 361 pass; 3 notification-bridge tests needed `services/notification-service` built (`pnpm run build`), then `WorkspaceNotificationRuntimeIntegrationTest` 12/12 pass.
- Local env note: JVM default zone `Asia/Saigon` is rejected by PostgreSQL → DB tests need `-Duser.timezone=UTC` (pre-existing, not code).
- workflow-service: Gmail tests 13/13, DefinitionValidatorTest, DefinitionJsonCodecTest, WorkflowV1AcceptanceTest, ExecutionRuntimeIntegrationTest, UnavailableNodeExecutorTest pass; full suite result recorded below.
- web: `tsc -b` pass; eslint only the 2 pre-existing errors; new Playwright test (authenticated builder, mocked APIs) passes; `workspace-connections.spec.ts` 29/29 chromium.
- Pre-existing: `e2e/workflow-catalog-v1.spec.ts` redirects to /login (7/9 fail) even on the base commit — spec predates auth on the builder route. Not addressed here.

## Next
- Google Cloud Console → Data Access: add `https://www.googleapis.com/auth/gmail.send`; reconnect the Gmail connection.
- Real click-through: manual trigger → Send Email (pick connection) → publish → run → email arrives.
- Follow-up: Sheets node has the same `connectionId: ''` draft-validation trap and a placeholder picker; fix `workflow-catalog-v1.spec.ts` auth setup.
