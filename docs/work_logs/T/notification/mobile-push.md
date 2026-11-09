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

## Session 2026-11-05: dead tokens and lapsed sessions

Branch `fix/push-device-lifecycle` (from `dev` `eaaf2a6f`).

- **Dead tokens:** when Expo answers `EXPO_DeviceNotRegistered` (ticket or receipt), the worker deletes that token from `push_devices`, but only when its `updated_at` is older than the delivery's `created_at`, so a token registered again after the push was queued survives. A failed delete is logged (`notification_push_device_forget_failed`) and never breaks delivery.
- **Lapsed sessions:** an expired session cannot call `DELETE /devices` (no valid access token). Pushes now go only to devices re-registered within 7 days (`PUSH_DEVICE_TTL_MS`, the identity refresh-token lifetime `JWT_REFRESH_EXPIRES_IN=7d`). The app re-registers on every return to the foreground (without re-asking for permission), so a phone with a live session stays inside the window. A phone whose session lapsed stops receiving pushes within 7 days.
- Changed: `domain/notification.ts` (`DeliveryRepository.forgetPushDevice`), `prisma.repository.ts`, `delivery.worker.ts` (+spec), `domain/inbox.ts`, `prisma.inbox.repository.ts` (+spec), `testing/fixtures.ts`, mobile `push-notifications.ts`.
- Verified: notification-service unit 202/202, e2e 24/24, build, eslint on changed files; mobile `tsc` clean. Real stack (rebuilt notification-service, Gateway, RabbitMQ, Neon), throwaway users: a token registered through the Gateway got `EXPO_DeviceNotRegistered` and its `push_devices` row was deleted (0 left, no `forget_failed` log); a device last registered 8 days ago got the inbox item but no push delivery (1 / 0); DLQ 0; cleanup removed all test rows.
- Limit: the 7-day window is a constant; make it a setting if the refresh-token lifetime changes. Stale `push_devices` rows are not purged, only ignored (the per-user cap of 10 bounds them).

## Session 2026-11-09: sound and heads-up

Branch `fix/push-sound` (from `dev`). Requested: notifications should play a sound.

- `ExpoProvider.send` now sends `sound: 'default'` (iOS), `channelId: 'default'` and `priority: 'high'`. Before, Android fell back to Expo's "Miscellaneous" channel (no pop-up); now it uses the app's own HIGH-importance `default` channel (system sound + heads-up). Every registered device has that channel: the app creates it before asking for the token, since the first push commit `0620f70b`.
- No app change and no new APK needed; the foreground handler already had `shouldPlaySound: true`.
- Verified: notification-service unit 202/202 (spec asserts the three fields), build, eslint on changed files. Not checked on a phone yet (needs the change deployed via `main`).
- Next: a custom Weav sound would need an audio file, the `expo-notifications` `sounds` plugin option, a new channel id (Android channel sounds cannot change) and a new APK.

## Session 2026-11-09 (tối): APK không hiện push ngoài màn hình

- **Triệu chứng:** hộp thư trong app có thông báo (lỗi chạy workflow, kết nối được xác nhận), nhưng ngoài màn hình Android không hiện gì.
- **Đã kiểm tra:**
  - EAS env `preview` có `GOOGLE_SERVICES_JSON`.
  - `compose.prod.yml` mặc định `NOTIFICATION_EXPO_ENABLED:-false`.
  - DB trong `.env` ở máy là Neon `production`: có bảng nhưng `push_devices` rỗng, không có delivery nào trong 2 ngày, inbox cuối lúc 11:01Z. Như vậy prod không ghi vào DB này; prod dùng branch `demo` (xem `K/platform/demo-deployment.md`), và máy này không có thông tin đăng nhập branch đó.
- **Chặn:** cần xem `~/weav-secrets/prod.env` trên VM (`NOTIFICATION_EXPO_ENABLED`) và `notification.notification_deliveries` / `push_devices` trên branch `demo`. Cũng cần kiểm tra khóa FCM V1 trên Expo (expo.dev → Credentials → Android).
- **Cập nhật (đã có thông tin đăng nhập DB `demo`, người dùng cho phép đọc):**
  - Trước đó `push_devices` rỗng.
  - Máy Redmi 2404ARN45A (Android 15, HyperOS): `POST_NOTIFICATIONS` đã được cấp, có Google Play Services. Sau khi force-stop rồi mở lại app qua adb, token được đăng ký lúc 13:54:44Z.
  - Chạy workflow lúc 13:56Z → có delivery `EXPO_PUSH`, Expo nhận ticket (đang chờ receipt). `dumpsys notification` cho thấy thông báo đã lên máy, nhưng ở kênh `expo_notifications_fallback_notification_channel`, không có âm thanh, vì prod chưa có `ef85ccc9` (kênh `default` + âm thanh) và PR #10 chưa merge.
  - Vì sao lần đăng ký đầu không thành: chưa rõ. App nuốt lỗi của `registerPushDevice`. Nghi ngờ HyperOS hạn chế chạy ngầm làm lần lấy token FCM đầu tiên thất bại. Prod đã bật Expo push và Expo có khóa FCM (thông báo đã tới máy).
