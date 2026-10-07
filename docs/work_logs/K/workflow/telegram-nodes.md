# Telegram nodes and bot-service removal (Week 1, Lane 2)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon); live test 2026-10-05 |
| Branch | `feat/telegram-nodes`, merged into `staging` (489d906); `fix/telegram-chat-id-type` (d432f63), live-test docs (6a61aa6) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`; live test against real Telegram passed (section 9) |
| Scope | `telegram.send_message` executor, `trigger.telegram` as a webhook-trigger variant (setWebhook / deleteWebhook, ingress), gateway route, removal of `services/bot-service` and its references |

## 2. Summary

- A workspace connects its **own** bot (`TELEGRAM` connection, token from @BotFather). workspace-service already had the provider, `TOKEN` auth with field `token`, getMe test, encryption and internal resolve; no change there.
- `telegram.send_message` runs for real (`TelegramSendMessageNodeExecutor` + `TelegramBotApiClient`, fixed host `api.telegram.org` through `PinnedHttpTransport`). `UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES` is now empty.
- `trigger.telegram` registers a webhook with Telegram on publish and resume, removes it on pause and when a republish retires the bot, and receives updates at `POST /api/v1/webhooks/telegram/{endpointKey}` (gateway) to `/webhooks/telegram/{endpointKey}` (workflow).
- `services/bot-service`, its compose block, `BOT_SERVICE_URL` / `upstreams.bot`, CI entries, `build:bot`, script references and lockfile entries are gone; docs rewritten for the new model.
- Review: 1 round; fixed rollback compensation (restore instead of delete), bounded the HTTP call inside the publish transaction, sorted advisory locks, guarded after-commit deletes, resume without base URL, token masking. Live test found numeric `chatId` rejection (fixed, section 8).

## 3. Decisions

| Decision | Reason |
| --- | --- |
| **External-call ordering.** Publish runs `setWebhook` as the last step inside the publish transaction. If it fails, the transaction rolls back and publish fails with `TELEGRAM_WEBHOOK_REGISTRATION_FAILED` (502): no version, no ACTIVE trigger. Compensation runs in a transaction synchronization: after a rollback or failed commit, bots registered in this publish are cleared; after a commit, bots the previous version used and the new one does not get `deleteWebhook` (best effort, logged without secrets) | Telegram never keeps pointing at a rolled-back trigger and the DB never holds an ACTIVE trigger Telegram does not know. Telegram keeps one webhook per bot, so re-registering replaces the old one |
| `setWebhook` runs while the workflow row lock and a pooled DB connection are held; bounded by `weav.workflow.telegram.control-timeout` (env `WORKFLOW_TELEGRAM_CONTROL_TIMEOUT`, default 10 s, range 1 ms to 60 s) and at most 5 `trigger.telegram` nodes per workflow (`TELEGRAM_TRIGGER_LIMIT_EXCEEDED`). `sendMessage` keeps the normal call timeout | The ordering above needs it; a saga would add states |
| Rollback compensation restores instead of deleting: a retired trigger that is ACTIVE again in the DB gets a freshly rotated secret and `setWebhook` again via `WorkflowTriggerPort.updateTelegramRegistration` (`REQUIRES_NEW`, runs in `afterCompletion`). If the restore fails the trigger stays ACTIVE with `lastError {code: TELEGRAM_WEBHOOK_REGISTRATION_FAILED}` and a warning is logged. Bots with no such trigger are cleared | A plain `deleteWebhook` killed a healthy older trigger on the same bot; the old secret is unrecoverable (only its hash is stored) |
| Every deferred `deleteWebhook` (pause, retired bots after commit, rollback of a new bot) first checks in a new transaction that no ACTIVE Telegram trigger uses the connection (`hasActiveTelegramTrigger`) | Another workflow may have taken the bot meanwhile; best effort, not locked |
| Pause = `deleteWebhook`; resume = new secret + `setWebhook` (`WorkflowTriggerPort.replaceSecretHash`); endpoint key is kept | Only the SHA-256 of `secret_token` is stored, so resume must rotate it |
| Resume without a valid `WORKFLOW_PUBLIC_BASE_URL` does not fail: other triggers activate, the Telegram trigger is switched off with `lastError DEPENDENCY_NOT_CONFIGURED` (`disableTelegramNotConfigured`) until republished | A config gap must not block schedules and webhooks |
| One bot per active workflow: `TELEGRAM_BOT_IN_USE` (409) at publish and resume, checked under `pg_advisory_xact_lock` on the connection; two `trigger.telegram` nodes on one bot in one workflow are refused. Advisory locks are taken in sorted UUID order | A bot has one webhook; concurrent publishes cannot both pass or deadlock. A unique index would need a migration and cannot express "active, not deleted" |
| Telegram triggers reuse `WebhookSecretPort.provision()` (24-byte endpoint key, 32-byte secret = 43 chars `A-Za-z0-9_-`, within Telegram's 1-256 limit) and the existing `endpoint_key` / `secret_hash` columns; the secret is never returned. No Flyway migration | Reuse |
| Ingress is typed: `findWebhookByEndpoint` returns only WEBHOOK triggers, `findTelegramByEndpoint` only TELEGRAM; `WebhookTriggerService.admit` re-checks the type under the lock. Authentication (constant-time `MessageDigest.isEqual`, dummy hash for unknown keys) runs before the update body is read; bad, missing, long or unknown credentials all return the generic webhook 404 | Same admission, idempotency and rate limits for both routes; no type confusion |
| Update handling: `telegram:<update_id>` is the idempotency key; text messages only (`allowed_updates=["message"]`); non-text updates, duplicates and replayed keys answer 200 without an execution; body `{"ok":true[,"executionId"]}` | Telegram only needs a 2xx and retries anything else |
| `IntegrationReadiness.forType(type, publicBaseUrl)`: `trigger.telegram` is configured only when `WORKFLOW_PUBLIC_BASE_URL` is a valid https URL, else `DEPENDENCY_NOT_CONFIGURED`. `forType(type)` keeps its signature. AI generation still uses it, so `trigger.telegram` is not offered to the generator; `telegram.send_message` is | Smallest change that keeps the static API |
| `sendMessage` failures: 401 `AUTHENTICATION_REJECTED` (reported to Workspace, not retried); 400/403/404 `HTTP_BUSINESS_REJECTED` with Telegram's description (bounded, control chars stripped, token replaced by `***`); 429 `HTTP_RATE_LIMITED` retryable and `requestNotSent`; 5xx, timeouts, transport errors retryable | Same shape as the Sheets executor |
| `validateTelegramUri` allows only `sendMessage`, `setWebhook`, `deleteWebhook` | Hardening |
| Telegram's `retry_after` is not honoured | `NodeExecutor.Failure` / `RetryPolicy` have no per-failure delay (fixed 1 s / 2 s, 3 attempts) |
| `mapping` values that resolve to a number are accepted for `chatId` (scalars for `text`) | `{{ trigger.input.message.chat.id }}` resolves to a number |
| `UnavailableNodeExecutor` and `TelegramTriggerIngress` (unused) stay in place | No behavioural reason to delete them in this lane |

## 4. Changed files

| Area | Files |
| --- | --- |
| Schemas and contracts | `telegram.send_message.json`, `trigger.telegram.json` (`connectionId`: `x-weav-connection` TELEGRAM, required, minLength 1, not template); `definition.schema.json` (`trigger.telegram` split from `trigger.webhook`); workflow `openapi.yaml` (webhook route, publish 409 / 502 codes); `examples/manual-unconfigured-dependency.json` now uses `ai.summarize` |
| workflow-service new | `TelegramBotApiClient`, `TelegramSendMessageNodeExecutor`, `TelegramWebhookAdapter`, `TelegramWebhookPort`, `TelegramTriggerException`, `TelegramUpdate` |
| workflow-service edited | `PinnedHttpTransport` (`executeTelegramBotApi`), `IntegrationReadiness`, `UnavailableNodeExecutor`, `WorkflowPublicationService` (11-argument constructor, older ones kept), `WebhookTriggerService` (`acceptTelegram`), `WorkflowTriggerPort` / `WorkflowTriggerAdapter` / `WorkflowTrigger` (`findTelegramByEndpoint`, `isTelegramConnectionInUse`, `replaceSecretHash`, `hasActiveTelegramTrigger`, `updateTelegramRegistration`, `disableTelegramNotConfigured`), `WebhookController`, `WorkflowController`, `WebhookRequestPath`, `SecurityConfig` |
| Config | `application.properties`, `compose.dev.yml`, `.env.example`: `WORKFLOW_PUBLIC_BASE_URL` (empty default), `WORKFLOW_TELEGRAM_CONTROL_TIMEOUT` |
| api-gateway | `workflow.module.ts` (Telegram proxy controller), `gateway-throttler.guard.ts`, `gateway.config.ts`, `app.module.ts`, `README.md`; `BOT_SERVICE_URL` removed |
| bot-service removal | `services/bot-service/**` (35 files), `compose.dev.yml`, `task8-runtime.compose.yml`, `.github/workflows/ci.yml` (CI lint now non-blocking for every service), `package.json`, `scripts/dev/setup.ps1`, `scripts/start-workflow-v1-live-smoke.ps1`, `.env.example` (BOT_DB_*), `pnpm-lock.yaml` |
| Docs | `CLAUDE.md` / `AGENTS.md` (repo map row, one environment fact), `docs/rulebook.md`, `docs/specs/services/bot-service.md` (superseded), `api-gateway.md`, `workflow-service.md`, `notification-service.md`, `docs/specs/README.md`, `repository-structure.md`, `SETUP.md`, workflow-service `README.md` |

## 5. Tests

`TelegramSendMessageNodeExecutorTest` (11), `TelegramWebhookAdapterTest` (4), `TelegramTriggerPublicationTest` (8), `TelegramRollbackCompensationTest` (5), `TelegramIngressTest` (7), `TelegramWebhookControllerTest` (4), `TelegramTriggerHttpIntegrationTest` (real PostgreSQL, incl. `twoConcurrentPublishesOnTheSameBotLetExactlyOneWin`), gateway `workflow.module.spec.ts`, `routes.e2e-spec.ts`, `gateway.config.spec.ts`. Adjusted: `NodeConfigSchemasTest`, `DefinitionValidatorTest`, `WorkflowPublicationTest`, `WorkflowPublicationHttpTest`, `WorkflowGenerationServiceTest`, `UnavailableNodeExecutorTest`, `WorkflowPublicationTestConfiguration`, `ExecutionRuntimeIntegrationTest`, `WorkflowV1AcceptanceTest` (fixture uses `ai.summarize`), `WorkflowCleanArchitectureTest` fake.

## 6. Evidence

| Check | Command | Result |
| --- | --- | --- |
| workflow-service | `./mvnw verify` (UTC) | Last full run 539 tests, 3 errors all known environment-only; the 2 own failures were fixed and re-run green (`WorkflowCleanArchitectureTest`, `TelegramIngressTest`, `WorkflowV1AcceptanceTest`); all Telegram tests pass |
| api-gateway | `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | 111 tests, 85 e2e, build OK |
| api-gateway lint | `pnpm exec eslint "{src,test}/**/*.ts"` | 2 pre-existing errors in `notifications/notifications.module.ts`, none in changed files |
| Lockfile | `pnpm install` then `--frozen-lockfile` | updated (bot-service importer removed), then "Already up to date" |
| Diff hygiene | `git add -N .` then `git diff --check` | clean |
| GitNexus impact | upstream, index one merge behind | `WorkflowTrigger` HIGH (19 impacted, 8 direct; one extra allowed type in `provisionWebhook`, no signature change); `IntegrationReadiness`, `UnavailableNodeExecutor`, `WorkflowPublicationService`, `WebhookTriggerService` LOW; others UNKNOWN or ambiguous, confirmed with `git grep` |

Live test: section 9. Docker image builds were not run.

## 7. Risks

| Level | Item | Handling |
| --- | --- | --- |
| Medium | If the DB commit fails after a successful `setWebhook`, compensation deletes the bot's webhook; a still-ACTIVE older trigger of the same bot has no webhook until the next publish or pause/resume | Rare; a republish fixes it |
| Medium | Registration holds the workflow row lock and a DB connection for one Telegram round trip (up to the 30 s call timeout) | Acceptable at thesis scale |
| Medium | A deleted workflow would leave its webhook registered; the service has no delete path yet (`Workflow.delete` unused) | When UC017 is built, call `TelegramWebhookPort.unregister` for its active Telegram triggers |
| Low | A Telegram token revoked later makes deliveries fail silently until republish; the executor reports `AUTHENTICATION_REJECTED` to Workspace on send | Surface in connection status (FE) |
| Low | `retry_after` is not honoured; AI generation does not offer `trigger.telegram` | Follow-ups if wanted |
| Low | First connection test right after workspace-service start returned 503 (~6 s) once, passed seconds later | Possible cold-start flake; watch |
| Low | Dev containers api-gateway (384m) and notification-service (512m) OOM during `nest start --watch`; worked around with `docker update --memory 1g --memory-swap 1g` | Fixed: `mem_limit` raised to 1g in `compose.dev.yml` (`chore/dev-mem-limits`, merged 5cb42c2) |

## 8. Live-test finding: numeric chatId (fix/telegram-chat-id-type)

The echo workflow (`chatId = {{ trigger.input.message.chat.id }}`) failed every run with `CONFIGURATION_ERROR`: `ExecutionRunner.resolveConfig` re-validates the resolved config and Telegram's `chat.id` is a JSON number while `chatId` was `type: string`. Fix: `chatId` is `oneOf [string minLength 1, integer]` (template-capable) in `telegram.send_message.json` and the mirrored `definition.schema.json` block; blank string is still `REQUIRED_FIELD_MISSING` at publish, boolean/decimal `INVALID_FIELD_TYPE`. Tests: `DefinitionValidatorTest`, `NodeConfigSchemasTest`, `ExecutionRunnerTest`.

## 9. Live test (2026-10-05): done

- Run `scripts/live-test-nodes.ps1 -Flow telegram -Cleanup` (see `scripts/README.md`). Setup used: dev stack without ocr-service, Cloudflare quick tunnel to the gateway, `WORKFLOW_PUBLIC_BASE_URL` set to the tunnel URL.
- Result after the chatId fix (`df65a31`, workflow-service rebuilt): connection VERIFIED, publish registered the webhook, the bot replied `Echo: <text>`, cleanup paused the workflow. K reported all steps passed.
- Manual steps if the script is not used: create a bot with @BotFather (keep the token private); `cloudflared tunnel --url http://localhost:3000`; set `WORKFLOW_PUBLIC_BASE_URL` in `.env` and recreate workflow-service; create a TELEGRAM connection (test calls getMe); workflow `trigger.telegram` then `telegram.send_message` (`chatId = {{ trigger.input.message.chat.id }}`, `text = You said: {{ trigger.input.message.text }}`); publish (second active workflow on the same bot gives 409); `getWebhookInfo` shows the tunnel URL, `allowed_updates ["message"]`, no `last_error_message`; message the bot (echo, TELEGRAM run), photo gives 200 and no run; pause empties the webhook URL, resume rotates the secret; cleanup (stop tunnel, pause, unset the URL, rotate the token if shared).
- Left behind (local dev test data, delete when no longer useful): identity user `weav-livetest@example.com` (credentials only in the git-ignored `tmp/live-test-account.txt`), its workspace "Live test" (`adaea5f1-7b46-48f3-b8d4-e92c32e55395`) with two TELEGRAM connections (`f38c27c6-...`, `e81ec4d0-...`), Google Calendar/Drive connections and the paused live-test workflows; K's test bot (webhook removed by the pause).

## 10. FE handoff (do not edit here)

`apps/mobile` still targets the removed link flow with routes the gateway never served:

- `apps/mobile/src/infrastructure/http/http-telegram.repository.ts` (`GET /api/telegram/status`, `POST /api/telegram/link-code`, `POST /api/telegram/unlink`), `infrastructure/mock/mock-telegram.repository.ts`, `domain/telegram/telegram.types.ts`, `features/telegram/hooks/useTelegram.ts`, `infrastructure/repository-factory.ts`
- UI: `apps/mobile/src/app/(app)/telegram/index.tsx`, entry in `(app)/(tabs)/profile.tsx`, `stores/i18n.store.ts` strings
- Web (mock only): `apps/web/src/api/telegram.api.ts`, `apps/web/src/pages/TelegramPage.tsx`

Replacement: a TELEGRAM connection (`token`) on the existing connections screens plus the `trigger.telegram` / `telegram.send_message` nodes. Publish can now fail with 409 `TELEGRAM_BOT_IN_USE` and 502 `TELEGRAM_WEBHOOK_REGISTRATION_FAILED`; `trigger.telegram` shows as disabled (`DEPENDENCY_NOT_CONFIGURED`) when `WORKFLOW_PUBLIC_BASE_URL` is unset.

## 11. References

- `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md` (section 1)
- `packages/workflow-schema/README.md`, `docs/work_logs/K/workflow/node-config-schema.md`
