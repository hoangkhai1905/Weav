# Notification Service research and implementation prompt

## Metadata

| Trường | Giá trị |
|---|---|
| Ngày | `2026-09-09` |
| Dự án | `Weav` |
| Nhánh | `feature/ocr-service-production` |
| Phạm vi | Đọc Notion KLTN, quét code hiện tại, thiết kế contract và prompt cho GPT-6 Astra |
| Trạng thái | Hoàn thành nghiên cứu; chưa triển khai Notification Service |

## Nguồn đã đọc

- KLTN hub: https://app.notion.com/p/01c4d7a29afb8320bc3c018f408577a7
- Notification Service V1 schema: https://app.notion.com/p/67d4d7a29afb82fbbf1081ab3db6f03a
- Microservice boundaries: https://app.notion.com/p/57f4d7a29afb833ca27b014ed52a82db
- Class Model Source of Truth V1: https://app.notion.com/p/1074d7a29afb83fda6aa8142d505852d
- Project structure: https://app.notion.com/p/6844d7a29afb8277bac5010f4e85bd3c
- Usecases: https://app.notion.com/p/3084d7a29afb82d1aedf012b9a94f5c1
- Product backlog query: notification-related items are `Push notification`, `Cấu hình Webhook & luồng gửi thông báo`, `Setup Telegram Bot`, and `Telegram trigger`; all returned `New`.

## Kết quả chính

- Notification Service là NestJS/TypeScript, nhận `workflow.completed` và `workflow.failed` qua RabbitMQ.
- Service sở hữu `notification_deliveries` trong logical schema riêng; không query trực tiếp Workflow DB hoặc Bot DB.
- V1 providers là `TELEGRAM` và `EXPO_PUSH`; delivery states là `PENDING`, `SENDING`, `SENT`, `FAILED`.
- Architecture baseline dùng REST/JSON cho sync và RabbitMQ/JSON cho async; API Gateway là edge ingress.
- Current repository service is only the Nest starter. It has no domain/application/infrastructure/presentation implementation, migration/Prisma schema, RabbitMQ consumer, or provider adapter.
- Existing mobile HTTP repository already expects `GET /api/notifications`, `PATCH /api/notifications/:id/read`, and `POST /api/notifications/read-all`. Web currently uses localStorage.
- Compose and `.env.example` already reserve notification database variables and a notification-service container, but the gateway notification URL is still commented out.
- Workflow Service has `outbox_events` persistence and RabbitMQ dependencies, but no verified notification event publisher was found during this scan.

## Contract decision / risk

The Notion `NotificationDelivery` model does not contain a durable read flag, while the existing client contract requires mark-read endpoints. The implementation prompt chooses an additive `read_at` field. It also asks for an additive `source_event_id` or equivalent idempotency strategy so RabbitMQ redelivery cannot duplicate delivery rows. This deviation must be documented and, when implementation starts, synchronized with the Notion source of truth.

The event must carry explicit provider destinations/recipients because Notification Service is forbidden from reading Bot/Workflow databases. Recipient resolution is therefore a cross-service contract concern, not a hidden database lookup.

## Repository checks

| Check | Result |
|---|---|
| `pnpm --dir services/notification-service test -- --runInBand` | PASS — 1 starter suite, 1 test |
| `pnpm --dir services/notification-service build` | PASS |
| `git diff --check` | PASS for existing diff; only an LF/CRLF warning was reported for an already modified PowerShell file |
| GitNexus CLI/MCP | Unavailable in this workspace; no impact analysis was needed because this session created documentation only and did not edit existing code symbols |

## Artifact

- Implementation prompt: `docs/prompts/notification-service-gpt6-astra.md`

## Handoff

Use the prompt file with GPT-6 Astra in the current repository. It explicitly forbids plan output, agent delegation, and step-by-step narration, and requires direct implementation plus tests/build verification.
