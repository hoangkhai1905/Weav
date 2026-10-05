# Telegram nodes and bot-service removal (Week 1, Lane 2)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon) |
| Repository / branch | Weav / `feat/telegram-nodes` (worktree `T:\Weav-wt\telegram`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented and verified locally; not committed. Live test against real Telegram not run (see runbook) |
| Scope | `telegram.send_message` executor, `trigger.telegram` as a webhook-trigger variant (setWebhook / deleteWebhook, ingress), gateway route, removal of `services/bot-service` and its references |

## 2. Summary

- A workspace connects its **own** bot (`TELEGRAM` connection, token from @BotFather). No change in workspace-service was needed: provider, `TOKEN` auth with field `token`, getMe test, encryption and the internal resolve already existed.
- `telegram.send_message` runs for real (`TelegramSendMessageNodeExecutor` + `TelegramBotApiClient`, fixed host `api.telegram.org` through `PinnedHttpTransport`). `UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES` is now empty.
- `trigger.telegram` registers a webhook with Telegram on publish and resume, removes it on pause and when a republish retires the bot, and receives updates at `POST /api/v1/webhooks/telegram/{endpointKey}` (gateway) to `/webhooks/telegram/{endpointKey}` (workflow).
- `services/bot-service`, its compose block, `BOT_SERVICE_URL` / `upstreams.bot`, CI entries, `build:bot`, script references and lockfile entries are gone; docs rewritten for the new model.

## 3. Decisions

| Decision | Reason | Alternatives |
| --- | --- | --- |
| **External-call ordering.** Publish runs the `setWebhook` call as the very last step inside the publish transaction (after version, triggers, reference projection and outbox are written). If it fails, the transaction rolls back and the publish fails with `TELEGRAM_WEBHOOK_REGISTRATION_FAILED` (502): no version, no ACTIVE trigger. A transaction synchronization then compensates: after a rollback or failed commit the bots registered in this publish get `deleteWebhook`; after a commit, bots the previous version used and the new one does not get `deleteWebhook` (best effort, logged without secrets) | Telegram can never keep pointing at a trigger that was rolled back, and the DB never holds an ACTIVE Telegram trigger Telegram does not know. Telegram keeps one webhook per bot, so re-registering the same bot simply replaces the old webhook | Call before the transaction with pre-issued keys (a later DB failure leaves Telegram pointing at nothing and needs compensation anyway); call after commit (an ACTIVE trigger without a webhook needs a compensating transaction and the user already got a 200) |
| `setWebhook` runs while the workflow row lock and a pooled DB connection are held | Ordering above needs it; bounded by a dedicated short timeout for Telegram control calls (`weav.workflow.telegram.control-timeout`, env `WORKFLOW_TELEGRAM_CONTROL_TIMEOUT`, default 10 s, accepted range 1 ms to 60 s) and by at most 5 `trigger.telegram` nodes per workflow (`TELEGRAM_TRIGGER_LIMIT_EXCEEDED`). `sendMessage` keeps the normal call timeout | Move registration out of the lock with a saga (more states) |
| Pause = `deleteWebhook`; resume = new secret + `setWebhook` | Only the SHA-256 of the `secret_token` is stored, the plaintext is unrecoverable, so resume rotates it (`WorkflowTriggerPort.replaceSecretHash`). The endpoint key is kept | Keep the webhook registered while paused and answer 404 (Telegram would keep retrying and the bot stays "in use") |
| One bot per active workflow: `TELEGRAM_BOT_IN_USE` (409) at publish and at resume. The check takes a transaction-scoped advisory lock on the connection (`pg_advisory_xact_lock`) so two concurrent publishes cannot both pass; two `trigger.telegram` nodes on one bot in one workflow are refused too | A bot has exactly one webhook | Unique index (needs a migration and cannot express "active, not deleted") |
| Telegram triggers reuse `WebhookSecretPort.provision()` (24-byte endpoint key, 32-byte secret = 43 chars of `A-Za-z0-9_-`, within Telegram's 1-256 limit) and the existing `endpoint_key` / `secret_hash` columns. The secret is never returned to the user | Reuse, no migration | New credential table |
| Ingress is typed: `findWebhookByEndpoint` returns only WEBHOOK triggers, new `findTelegramByEndpoint` only TELEGRAM; `WebhookTriggerService.admit` also re-checks the type under the lock. Authentication (constant-time `MessageDigest.isEqual`, dummy hash for unknown keys) runs before the update body is looked at; bad, missing, too long or unknown credentials all return the webhook route's generic 404 | Same admission, idempotency and rate limits for both routes; no type confusion | Separate service |
| Update handling: `telegram:<update_id>` is the idempotency key; text messages only (`allowed_updates=["message"]`); non-text updates, duplicates and replayed keys with the same id answer 200 without an execution; response body `{"ok":true[,"executionId"]}` | Telegram only needs a 2xx and retries on anything else | 202 like the webhook route |
| `IntegrationReadiness.forType(type, publicBaseUrl)`: `trigger.telegram` is configured only when `WORKFLOW_PUBLIC_BASE_URL` is a valid https URL, otherwise it keeps today's `DEPENDENCY_NOT_CONFIGURED`. `forType(type)` keeps its signature (unconfigured). AI generation (`WorkflowGenerationService.capabilities`) still uses it, so `trigger.telegram` is not offered to the generator; `telegram.send_message` now is | Smallest change that keeps the static API | Inject a bean into the generation service (more ripple) |
| Failure mapping for `sendMessage`: 401 `AUTHENTICATION_REJECTED` (reported to Workspace, not retried); 400/403/404 `HTTP_BUSINESS_REJECTED` with Telegram's description (bounded, control characters stripped, never the token); 429 `HTTP_RATE_LIMITED` retryable and `requestNotSent`; 5xx, timeouts, transport errors retryable | Same shape as the Sheets executor | n/a |
| Rollback compensation restores instead of deleting (review round 1): after a rolled-back publish (failed call or failed commit) a retired trigger that is ACTIVE again in the database gets a freshly rotated secret and `setWebhook` again, run through `WorkflowTriggerPort.updateTelegramRegistration` in its own transaction (`REQUIRES_NEW`, because it runs in `afterCompletion`). If the restore fails the trigger keeps ACTIVE but records `lastError {code: TELEGRAM_WEBHOOK_REGISTRATION_FAILED}` and a warning is logged without secrets. Bots with no such trigger are cleared | A plain `deleteWebhook` killed a healthy older trigger on the same bot | Keep the old secret (unrecoverable, only its hash is stored) |
| Every deferred `deleteWebhook` (pause, retired bots after a commit, rollback of a new bot) first checks in a new transaction that no ACTIVE Telegram trigger uses the connection (`hasActiveTelegramTrigger`) | Another workflow may have taken the bot between the decision and the call; the check is best effort, not locked | Advisory lock across the HTTP call (too long) |
| Resume without a valid `WORKFLOW_PUBLIC_BASE_URL` does not fail: other triggers are activated, the Telegram trigger is switched off again with `lastError DEPENDENCY_NOT_CONFIGURED` (`disableTelegramNotConfigured`). Like a publish without the URL, it stays off until the workflow is republished | A config gap should not block resuming schedules and webhooks | 502 on resume |
| Bot advisory locks are taken in sorted UUID order (publish and resume) | Two publishes sharing several bots cannot deadlock | n/a |
| `validateTelegramUri` allows only `sendMessage`, `setWebhook`, `deleteWebhook`; Telegram's `description` has the bot token replaced by `***` before it enters a failure message | Hardening | n/a |
| Telegram's `retry_after` is not honoured | `NodeExecutor.Failure` and `RetryPolicy` have no per-failure delay (fixed 1 s / 2 s backoff, 3 attempts) | Add a delay field to `Failure` (touches the runner) |
| `mapping` values that resolve to a number are accepted for `chatId` (and scalars for `text`) | `{{ trigger.input.message.chat.id }}` resolves to a number | Require strings |
| `UnavailableNodeExecutor` and `TelegramTriggerIngress` (still unused) are left in place | No behavioural reason to delete them in this lane; the interface is dead scaffolding that the ingress superseded | Delete both |

## 4. Changed files

| Type | Path | Note |
| --- | --- | --- |
| Edit | `packages/workflow-schema/nodes/telegram.send_message.json`, `trigger.telegram.json` | `connectionId` (`x-weav-connection` TELEGRAM, required, minLength 1, not a template field) |
| Edit | `packages/contracts/http/workflow/definition.schema.json` | `trigger.telegram` split from `trigger.webhook` (webhook stays field-less); `connectionId` on both Telegram blocks |
| Edit | `packages/contracts/http/workflow/openapi.yaml` | `POST /webhooks/telegram/{endpointKey}`; publish 409 / 502 codes |
| Add | `infrastructure/telegram/TelegramBotApiClient`, `TelegramSendMessageNodeExecutor`, `TelegramWebhookAdapter` | Client, executor, webhook port adapter |
| Add | `application/port/out/TelegramWebhookPort`, `application/service/TelegramTriggerException`, `application/trigger/TelegramUpdate` | Port, stable error codes, update normalizer |
| Edit | `infrastructure/http/PinnedHttpTransport` | `executeTelegramBotApi` (fixed host, `/bot<token>/<method>` path shape, no query, https) |
| Edit | `application/node/IntegrationReadiness`, `UnavailableNodeExecutor` | Base-URL readiness; empty unavailable set |
| Edit | `application/service/WorkflowPublicationService` | Registration, retirement, pause/resume, in-use check; new 11-argument constructor (older constructors kept) |
| Edit | `application/trigger/WebhookTriggerService` | `acceptTelegram`; shared `authenticate` / `admit` |
| Edit | `application/port/out/WorkflowTriggerPort`, `infrastructure/persistence/repository/WorkflowTriggerAdapter`, `domain/.../WorkflowTrigger` | `findTelegramByEndpoint`, `isTelegramConnectionInUse`, `replaceSecretHash`; `provisionWebhook` also for TELEGRAM. No Flyway migration |
| Edit | `presentation/http/WebhookController`, `WorkflowController`, `infrastructure/web/WebhookRequestPath`, `infrastructure/security/SecurityConfig` | Telegram route, 409/502 mapping, path redaction, permitAll |
| Edit | `application.properties`, `compose.dev.yml`, `.env.example` | `WORKFLOW_PUBLIC_BASE_URL` (empty default). No `.env` exists in this worktree, so none was appended |
| Edit | `services/api-gateway/src/workflow/workflow.module.ts`, `rate-limit/gateway-throttler.guard.ts`, `config/gateway.config.ts`, `app.module.ts`, `README.md` | Telegram proxy controller, rate-limit key, `BOT_SERVICE_URL` removed |
| Delete | `services/bot-service/**` | 35 tracked files |
| Edit | `compose.dev.yml`, `apps/web/e2e/docker/task8-runtime.compose.yml`, `.github/workflows/ci.yml`, `package.json`, `scripts/dev/setup.ps1`, `scripts/start-workflow-v1-live-smoke.ps1`, `.env.example` (BOT_DB_*), `pnpm-lock.yaml` | bot-service references removed; CI lint is now non-blocking for every service (comment updated) |
| Edit | `packages/contracts/http/workflow/examples/manual-unconfigured-dependency.json` | The public "unconfigured dependency" sample used `telegram.send_message`; it now uses `ai.summarize` (acceptance test fixture) |
| Edit | `CLAUDE.md`, `AGENTS.md` | Repository map row and one environment fact, identical in both |
| Edit | `docs/rulebook.md`, `docs/specs/services/bot-service.md` (superseded notice), `api-gateway.md`, `workflow-service.md`, `notification-service.md`, `docs/specs/README.md`, `docs/architecture/repository-structure.md`, `docs/development/SETUP.md`, `services/workflow-service/README.md` | UC022-UC024 rewritten; references fixed |
| Tests | see section 6 | Old tests adjusted where behaviour legitimately changed |

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| GitNexus impact (upstream, index one merge behind) | `node T:\Weav\.gitnexus\run.cjs impact "<Symbol>" --direction upstream --repo Weav` | `WorkflowTrigger` **HIGH** (19 impacted, 8 direct; the change is one extra allowed type in `provisionWebhook`, no signature change). `IntegrationReadiness`, `UnavailableNodeExecutor`, `WorkflowPublicationService`, `WebhookTriggerService`: LOW. `WebhookRequestPath`, `WorkflowTriggerAdapter`, `WebhookController`: UNKNOWN, `PinnedHttpTransport`, `SecurityConfig`: ambiguous across services; `WorkflowTriggerPort`: not found. All confirmed with `git grep` (callers: publication service, webhook/schedule services, adapter, tests) |
| workflow-service | `./mvnw verify` (UTC, per-service lock) | Full run: 539 tests, 2 failures and 3 errors. The 3 errors are the known environment-only ones (`HttpTransportIntegrationTest` x2: TLS test certificate; `WorkflowNotificationLifecyclePersistenceIntegrationTest.compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox`: no `notification-service/dist`). The 2 failures were mine and are fixed: `WorkflowCleanArchitectureTest` (my ingress test in an `application` package imported an infrastructure class; now uses a local fake) and `WorkflowV1AcceptanceTest.unconfiguredDependencyFixtureFailsClosedWithOnePersistedAttempt` (its fixture used `telegram.send_message` as the "unconfigured dependency"; it now uses `ai.summarize`, which still fails closed with `DEPENDENCY_NOT_CONFIGURED` while AI is off). Re-run after the fixes: `WorkflowCleanArchitectureTest` 2/2, `TelegramIngressTest` 7/7, `WorkflowV1AcceptanceTest` 3/3. A second full run was not repeated. All new Telegram tests pass, including `TelegramTriggerHttpIntegrationTest` 4/4 on PostgreSQL |
| api-gateway | `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | 111 tests (9 suites), 85 tests (6 suites), build OK |
| api-gateway lint | `pnpm exec eslint "{src,test}/**/*.ts"` | 2 pre-existing errors in `notifications/notifications.module.ts`; none in changed files |
| Lockfile | `pnpm install` then `pnpm install --frozen-lockfile` | `pnpm install` updated `pnpm-lock.yaml` (bot-service importer and orphans removed, 125 lines); `pnpm install --frozen-lockfile` then reports "Already up to date" |
| Diff hygiene | `git add -N .` then `git diff --check` | clean (only the CRLF-to-LF notice for the two schema files I rewrote) |

Not checked: nothing was sent to the real Telegram API; Docker image builds were not run.

## 6. Tests added

| Class | Covers |
| --- | --- |
| `infrastructure/telegram/TelegramSendMessageNodeExecutorTest` (11) | success and output ids; numeric chat id; 401 (reported, no token leak); 400/403/404; 429; 5xx, timeout, unexpected errors; invalid responses; configuration failures before any call; wrong provider / token shape; workspace denial and outage; real transport refuses other hosts, schemes, ports, paths, queries |
| `infrastructure/telegram/TelegramWebhookAdapterTest` (4) | `setWebhook` body (url, secret_token, `allowed_updates=["message"]`); stable failure codes without the token; `deleteWebhook` never throws; base URL normalisation |
| `application/TelegramTriggerPublicationTest` (8) | publish registers URL + secret and hides the secret; `TELEGRAM_BOT_IN_USE`; failed registration clears the bot; no base URL keeps `DEPENDENCY_NOT_CONFIGURED`; republish to another bot clears the old one, same bot only replaces; paused republish registers nothing; pause deletes, resume rotates and registers; resume in-use and readiness-blocked |
| `application/trigger/TelegramIngressTest` (7) | normalized input and `telegram:<id>` key; field dropping; non-text updates; duplicates and key replay; wrong / missing / short / long / unknown secrets (comparison also runs for unknown keys); auth before body inspection; webhook and Telegram routes never accept each other's triggers |
| `presentation/http/TelegramWebhookControllerTest` (4) | header forwarding, 200 bodies, generic 404 with redacted path, path helpers |
| `presentation/http/TelegramTriggerHttpIntegrationTest` (4, real PostgreSQL) | publish, ingress, idempotency, type separation, bot in use, pause / resume rotation, failed registration rolls back, republish |
| Adjusted | `NodeConfigSchemasTest` (tables), `DefinitionValidatorTest`, `WorkflowPublicationTest`, `WorkflowPublicationHttpTest`, `WorkflowGenerationServiceTest`, `UnavailableNodeExecutorTest`, `WorkflowPublicationTestConfiguration` (port decorator), `ExecutionRuntimeIntegrationTest` (the "unavailable integration" case no longer has a type) |
| Gateway | `workflow.module.spec.ts` (3), `routes.e2e-spec.ts` (3), `gateway.config.spec.ts` (1) |

## 7. Risks and next steps

| Level | Item | Handling |
| --- | --- | --- |
| Medium | If the DB commit fails after a successful `setWebhook`, the compensation deletes the bot's webhook; a still-ACTIVE older trigger of the same bot then has no webhook until the next publish or pause/resume | Rare; documented. A republish fixes it |
| Medium | Registration holds the workflow row lock and a DB connection for one Telegram round trip (up to the 30 s call timeout) | Acceptable for the thesis scale |
| Medium | A deleted workflow would leave its webhook registered. The service has no delete path yet (`Workflow.delete` is unused) | When UC017 is built, call `TelegramWebhookPort.unregister` for its active Telegram triggers |
| Low | A Telegram connection whose token is revoked later makes Telegram deliveries fail silently until the user republishes with a new token. The executor reports `AUTHENTICATION_REJECTED` to Workspace on send | Surface in the connection status (FE) |
| Low | `retry_after` is not honoured | See decisions |
| Low | AI generation does not offer `trigger.telegram` | Follow-up if wanted |

## 7b. Review round 1 (coordinator review of ac46801, merged with the Google lane as 94ecd80)

| Item | Result |
| --- | --- |
| MEDIUM rollback compensation | Done, see decisions. `TelegramRollbackCompensationTest` (5) drives real `TransactionSynchronization` callbacks through a fake transaction: failed registration call, failed commit, failed restore (error recorded, nothing deleted), new bot cleared (unless active), commit clears only the retired bot |
| MEDIUM HTTP inside the transaction | Control timeout (10 s default, in `application.properties`, `compose.dev.yml`, `.env.example`) and the 5-trigger cap; tests in `TelegramWebhookAdapterTest` and `TelegramTriggerPublicationTest` |
| LOW sorted advisory locks | Done; `botLocksAreTakenInSortedOrderWhateverTheNodeOrder` |
| LOW guarded after-commit delete | Done; `afterCommitClearingSkipsABotThatAnActiveTriggerUsesByNow` (publish and pause) |
| LOW resume without base URL | Done; `resumeWithoutAPublicBaseUrlActivatesTheRestAndLeavesTelegramDisabledNotConfigured` |
| Hardening | Done; method allow-list and token masking tests in `TelegramSendMessageNodeExecutorTest` |
| Concurrency test | `TelegramTriggerHttpIntegrationTest.twoConcurrentPublishesOnTheSameBotLetExactlyOneWin` on PostgreSQL: one 200, one 409 `TELEGRAM_BOT_IN_USE`, one ACTIVE trigger |
| New port methods | `hasActiveTelegramTrigger`, `updateTelegramRegistration`, `disableTelegramNotConfigured`; the test port decorator delegates them |

## 8. Handoff for the FE partner (do not edit here)

`apps/mobile` still targets the removed link flow with routes the gateway never served:

- `apps/mobile/src/infrastructure/http/http-telegram.repository.ts` (`GET /api/telegram/status`, `POST /api/telegram/link-code`, `POST /api/telegram/unlink`)
- `apps/mobile/src/infrastructure/mock/mock-telegram.repository.ts`, `apps/mobile/src/domain/telegram/telegram.types.ts`, `apps/mobile/src/features/telegram/hooks/useTelegram.ts`, `apps/mobile/src/infrastructure/repository-factory.ts`
- UI: `apps/mobile/src/app/(app)/telegram/index.tsx`, entry point in `apps/mobile/src/app/(app)/(tabs)/profile.tsx`, `apps/mobile/src/stores/i18n.store.ts` strings
- Web equivalent (mock only): `apps/web/src/api/telegram.api.ts`, `apps/web/src/pages/TelegramPage.tsx`

Replacement: a TELEGRAM connection (`token`) on the existing connections screens plus the `trigger.telegram` / `telegram.send_message` nodes. Publish can now fail with 409 `TELEGRAM_BOT_IN_USE` and 502 `TELEGRAM_WEBHOOK_REGISTRATION_FAILED`; `trigger.telegram` shows as disabled (`DEPENDENCY_NOT_CONFIGURED`) when `WORKFLOW_PUBLIC_BASE_URL` is unset.

## 9. Live-test runbook (Cloudflare quick tunnel)

Do this by hand; nothing here was run by the agent.

1. Create a bot with @BotFather and keep the token private.
2. Start the dev stack as usual (gateway on `localhost:3000`).
3. `cloudflared tunnel --url http://localhost:3000` and copy the `https://<random>.trycloudflare.com` URL.
4. Set `WORKFLOW_PUBLIC_BASE_URL=<that URL>` in `.env`, then recreate workflow-service (`docker compose -f compose.yml -f compose.dev.yml --profile app up -d workflow-service`).
5. In the web app, create a **Telegram** connection with the bot token (the connection test calls getMe).
6. Build a workflow: `trigger.telegram` (that connection) then `telegram.send_message` with `chatId = {{ trigger.input.message.chat.id }}` and `text = You said: {{ trigger.input.message.text }}`, same connection. Publish (expect 200; a second active workflow on the same bot gives 409).
7. Check the registration without printing the token: `curl https://api.telegram.org/bot<token>/getWebhookInfo` shows the tunnel URL ending in `/api/v1/webhooks/telegram/<key>`, `allowed_updates: ["message"]`, `pending_update_count` 0 and no `last_error_message`.
8. Message the bot. Expect the echo reply and a run in the workflow's executions (trigger type TELEGRAM, input with `updateId` and `message`).
9. Send a photo: Telegram gets 200, no run starts.
10. Pause the workflow and run `getWebhookInfo` again: `url` is empty. Messages now go unanswered. Resume: a new `secret_token` is registered and the bot answers again.
11. Clean up: stop the tunnel, pause or unpublish the workflow, unset `WORKFLOW_PUBLIC_BASE_URL`, revoke or rotate the bot token if it was shared.

## 10. References

- `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md` (section 1)
- `packages/workflow-schema/README.md`, `docs/work_logs/K/workflow/node-config-schema.md`

## Live test

Run `scripts/live-test-nodes.ps1` (see `scripts/README.md`) for an end-to-end live check through the gateway; it replaces the UI until the web app supports these nodes.
