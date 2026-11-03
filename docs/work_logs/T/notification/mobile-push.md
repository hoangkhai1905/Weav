# Mobile push notifications

## Session 2026-11-03

| Field | Value |
| --- | --- |
| Branch | `feature/mobile-push-notifications` (from `dev` `51f1ce1f`) |
| Status | Code done and tested; device check blocked on Firebase setup |
| Scope | Show every inbox notification as an OS push on the phone (app closed or in background) |

### Decisions

- Push every inbox (v2) notification, not only workflow results (user's choice).
- Reuse the existing `ExpoProvider` and delivery worker (retry, receipts). A new inbox row queues one `EXPO_PUSH` delivery per registered device, rendered in that device's locale. `readAt` is set so the legacy v1 list does not count it as unread (same as the invitation e-mail).
- Device tokens live in the new `notification.push_devices` table (token PK, so a phone that signs in as another user moves to them; max 10 per user).
- Push rows carry `payload.source = 'inbox'`. v2 ingest skips them when checking for legacy deliveries; without this, a broker redelivery of a non-execution event threw `InboxPersistenceConflictError`.
- Mobile: register after sign-in and on language change, unregister before logout (the DELETE needs the access token), tap opens `/(app)/notifications`. `app.config.js` adds `googleServicesFile` only when the file or `GOOGLE_SERVICES_JSON` exists, so builds without Firebase still work.

### Changed files

- notification-service: `prisma/schema.prisma`, `prisma/migrations/202611030001_push_devices/`, `src/domain/inbox.ts`, `src/application/inbox-notifications.ts`, `src/infrastructure/prisma.inbox.repository.ts` (+spec), `src/presentation/http.ts`, `test/notification.e2e-spec.ts`, `README.md`.
- api-gateway: `src/notifications/notifications.module.ts` (+spec): `PUT`/`DELETE /api/v2/notifications/devices`, JSON body forwarding.
- contracts: `packages/contracts/http/notifications-v2.md` (Push devices section).
- mobile: `src/features/notifications/push-notifications.ts` (new), `src/app/(app)/_layout.tsx`, `src/features/auth/auth-session.runtime.ts`, `app.json`, `app.config.js` (new), `.gitignore`, `docs/push-notifications.md` (setup guide).

### Verification

- notification-service `pnpm test`: 200 passed; `pnpm test:e2e`: 24 passed; `pnpm build` ok.
- api-gateway `pnpm test`: 194 passed; `pnpm test:e2e`: 164 passed; `pnpm build` ok; eslint on changed files clean.
- mobile `npx tsc --noEmit -p .` clean; eslint on changed files clean; `expo config` shows `googleServicesFile` only when set.
- Pre-existing tsc errors in notification-service specs (`settings.spec.ts`, `prisma.repository.spec.ts`) are unrelated; Jest passes.
- Neon: `prisma migrate deploy` applied `202611030001_push_devices` to `notification_db` (the DB in local `.env`); `migrate status` up to date; table has 5 columns, 0 rows. No backup branch (no Neon CLI/API key here; additive change, rollback `DROP TABLE notification.push_devices`).
- Note: `npx expo lint` auto-added `eslint` deps to mobile `package.json`/lockfile; reverted and reinstalled with `--frozen-lockfile`.

### Real-stack check (local Compose, Neon `notification_db`, `NOTIFICATION_EXPO_ENABLED=true`)

- Rebuilt `notification-service` and `api-gateway` (`docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build --no-deps notification-service api-gateway`); both healthy, `devices` routes mapped.
- Throwaway user + HS256 test token, through the Gateway on `localhost:3000`: `PUT devices` invalid token 400, valid 204 (row with locale `en`); published `identity.password_changed` to `weav.events`; one `EXPO_PUSH` delivery (`source=inbox`, title "Password changed") reached Expo, which answered `EXPO_DeviceNotRegistered` for the fake token (proves the Expo call path; terminal FAILED, no retry). Republishing the same event: still 1 delivery, 1 inbox row, DLQ 0. `GET` inbox 200; `DELETE devices` 204, 0 rows left. Cleanup deleted the test user's 1 delivery and 1 inbox row.
- Firebase: `google-services.json` in `apps/mobile` (git-ignored) and as EAS secret file `GOOGLE_SERVICES_JSON` (preview); FCM V1 service account key assigned to `com.truong0910.mobile` on EAS project `mobile`.
- Not pushed: `dev` CI/CD deploys on push. Still to verify on a phone with a new preview APK.

### Risks and limits

- Not tested on a real device: needs Firebase `google-services.json`, an FCM V1 key in EAS, and `NOTIFICATION_EXPO_ENABLED=true`. Steps are in `apps/mobile/docs/push-notifications.md`.
- If the deployed server uses another Neon DB/branch (`prod.env`), run `db:migrate` there before deploying; otherwise inbox ingest fails on the missing table.
- Stale tokens (app uninstalled) stay until another sign-in reuses them: each push to them fails as `EXPO_DeviceNotRegistered`. Session expiry (not logout) does not unregister.
- Tapping a push opens the inbox, not the notification's own target.

### Next steps

- Firebase/EAS setup, rebuild the preview APK, check a push arrives with the app closed.
- Optional: delete `push_devices` rows on `DeviceNotRegistered`; deep-link the tap to the notification target.
