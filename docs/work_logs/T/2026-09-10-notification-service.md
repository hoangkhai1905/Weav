# Nhật ký 2026-09-10 — Notification Service

## 1. Metadata

- Repository: Weav; timezone Asia/Saigon.
- Branch: `feature/ocr-service-production`; baseline commit `3e1ea57`.
- Scope: implement Notification Service directly in current worktree; no delegation, task creation, plan artifact or commit.
- Status: implemented and locally verified; live upstream/provider integration not verified.

## 2. Kết quả

- Notification-owned Prisma/PostgreSQL schema, additive `read_at` and `source_event_id`, JSONB, UTC timestamps and indexes; no cross-service FK/database reads.
- RabbitMQ durable topic exchange, consumer queue, confirmed sanitized DLQ, transactional recipient persistence before ACK, event deduplication.
- Telegram/Expo adapters, finite deadlines, error sanitization, bounded persisted retries, SKIP LOCKED claims and stale-lease fencing; durable Expo receipt checks.
- JWT-protected inbox/list/count/read/read-all; canonical and legacy routes; readiness/liveness.
- Minimum gateway proxy and Compose configuration; small mobile HTTP envelope mapper. Web and mobile mock behavior unchanged.

## 3. Yêu cầu và giới hạn

User requested code-only execution, no agent delegation, no plan and preservation of unrelated dirty files. Existing mobile/web/OCR/scripts/configuration edits were left in place. No production database or provider credentials were used. No external Workflow/Bot database access or send endpoint was introduced.

## 4. Hiện trạng trước thay đổi

Notification service was a Nest starter. Existing mobile expected `/api/notifications`; gateway had no notification routes. Research references and source findings are in `2026-09-09-notification-service-research.md`.

## 5–6. Quyết định

- Use the existing Compose schema convention `notification`; no automatic schema synchronization/migration at startup.
- Inbox contains one delivery per provider/destination, so multiple channels produce multiple items per execution.
- Discard arbitrary upstream summaries/errors; render generated safe success/failure text plus workflow metadata. Provider errors are allowlisted codes, never raw responses.
- Read-state updates leave `updated_at` unchanged because it fences worker ownership. Expired workers cannot overwrite a newer claim.
- Expo tickets are private payload keys, hidden from HTTP. Poll after 15 minutes; stop missing-receipt polling after 23 hours. A ticket is not a successful delivery receipt.
- At-least-once delivery: crash after provider acceptance and before commit may duplicate a send. No exactly-once claim.
- Default providers disabled; terminal `PROVIDER_DISABLED` rows are not silently resent when enabled later.

## 7–8. Files và configuration

- `services/notification-service/src/{domain,application,infrastructure,presentation,config,testing}`: implementation and focused tests.
- `services/notification-service/{prisma,prisma.config.ts,test,README.md,package.json,tsconfig.build.json,Dockerfile.dev}`: schema/migration, runtime verification and setup.
- `services/api-gateway/src/notifications`, gateway AppModule/package: bounded proxy integration and tests.
- `apps/mobile/src/infrastructure/http/{notification.mapper.ts,notification.mapper.test.cjs,http-notification.repository.ts}`: envelope compatibility only.
- `.env.example`, `compose.dev.yml`, `pnpm-lock.yaml`: non-secret configuration/dependencies. Existing lockfile changes preserved.
- Added pg/Prisma adapter/runtime-utils, amqplib, JWT verification, undici7 and direct Fastify dependency. Prisma generation is service-private.
- Runtime variables/routes/retry policy/event envelope and migration deployment commands are documented in the service README.

## 9. Kiểm chứng

| Command | Result |
| --- | --- |
| `pnpm --dir services/notification-service test -- --runInBand` | PASS: 7 suites, 52 tests |
| `pnpm --dir services/notification-service build` | PASS: generated private Prisma client + Nest build |
| `pnpm --dir services/notification-service test:e2e` | PASS: 11 tests, real Nest/Fastify with mocked persistence/providers |
| `pnpm --dir services/notification-service test:integration` | PASS: 7 tests, actual PostgreSQL 17 and RabbitMQ 4 |
| `pnpm --dir services/api-gateway test -- --runInBand` | PASS: 3 suites, 20 tests including existing OCR tests |
| `pnpm --dir services/api-gateway build` | PASS |
| `node --test apps/mobile/src/infrastructure/http/notification.mapper.test.cjs` | PASS: 2 tests |
| Service ESLint on `src/**/*.ts` and `test/**/*.ts` | PASS |
| Gateway ESLint on `src/notifications/**/*.ts` | PASS |
| `docker compose --env-file .env.example -f compose.yml -f compose.dev.yml --profile app config --quiet` | PASS; sandbox emitted Docker config-read warnings, not Compose errors |
| `git diff --check` | PASS; repository LF/CRLF warnings only |

Real integration checks: deploy migration twice; Prisma schema diff empty; concurrent event replay/recipient dedup; concurrent exclusive claims; foreign-user reads; read-all idempotence; read-state lease preservation; stale completion fencing; restart recovery; persisted provider retry; actual broker-to-inbox/DLQ; cursor HTTP; production AppModule boot/readiness with generated client. External Telegram/Expo delivery uses mocked HTTP/SDK tests only.

Regression fixes verified during this session: build output root after adding Prisma config; custom-client runtime dependency; unsafe detail links; unrecognized Expo error-code sanitization; PostgreSQL's 63-byte constraint-name limit. Test failures were observed before these fixes and checks rerun afterward.

## 10. Risks và tooling

- GitNexus CLI index-only analysis succeeded earlier. Notification AppModule/bootstrap and gateway AppModule impacts were LOW (one direct caller); mobile repository direct caller was its factory with indirect importers. No HIGH/CRITICAL result.
- New symbols were not yet present in the index: impact returned UNKNOWN, not treated as safe. Targeted caller searches/manual inspection plus focused tests were used. Referenced `.claude/skills/gitnexus-impact-analysis/SKILL.md` was absent.
- No commit was created; pre-commit GitNexus change detection therefore remains a requirement for whoever commits later.
- Docker/pnpm access required sandbox escalation; approved execution affected only test containers/local dependency cache. No source changes were inferred from infrastructure failures.

## 11. Handoff

Implementation is ready for review. Before a real deployment, supply the documented database/JWT/provider configuration, apply migrations explicitly, and have Workflow publish the documented envelope with resolved recipients. Real Workflow-to-device delivery is not claimed. The existing mobile UI displays the first page; this task did not add pagination UI or replace web mocks.

## 12. References

- Service README: `services/notification-service/README.md`.
- Original prompt: `docs/prompts/notification-service-gpt6-astra.md`.
- Notion source links and architecture findings: previous research work log.

## 13. Session state

Uncommitted implementation in the existing dirty worktree; no PR or agent task. Verification-before-completion and systematic-debugging/TDD guided the regression checks. No plan was written. Test infrastructure uses only the `weav-notification-test` Compose project; temporary migration databases and created delivery rows are removed by their tests.

Cleanup completed: `docker compose -p weav-notification-test -f services/notification-service/test/compose.yml down --volumes` exited 0. Only the two test containers, their disposable data volumes and test network were removed; they can be regenerated with the documented test commands. No user/production data was removed.

Runtime startup verification: `docker compose --env-file .env -f compose.yml -f compose.dev.yml --profile app up -d --build --wait rabbitmq notification-service` completed successfully; `rabbitmq` is healthy, Notification `/health` and `/ready` returned 200 from inside the container, and RabbitMQ contains `notification-service.execution-events` with one consumer plus the empty DLQ. API Gateway was also built/started on host port 3000; unauthenticated `/api/notifications` returned 401 as expected. The provider flags remain disabled, so no real Telegram/Expo send was attempted.

Authenticated proxy verification: a short-lived test JWT was generated inside the Notification container and used through `api-gateway:3000/api/notifications`; the request returned HTTP 200 with `{ items: [], nextCursor: null }`. The mobile repository and response mapper are wired to the legacy routes, but the checked-in mobile example remains `EXPO_PUBLIC_API_MODE=mock`; HTTP mode must be enabled in the developer's mobile environment before the app uses the gateway. The web notification UI remains localStorage-backed by the stated scope.

Branch/runtime follow-up on 2026-09-10: created `notification-service`, merged `origin/codex/identity-m3` at `5fa92a7`, restored the pre-existing dirty worktree, and rebuilt/started Identity, API Gateway, Notification Service, and RabbitMQ. Identity readiness and Notification health returned 200; RabbitMQ was healthy; the Gateway Notification route returned 401 without credentials as required.
