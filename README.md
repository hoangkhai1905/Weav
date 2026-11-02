# Weav

Weav automates and monitors work processes for working professionals, in the style of Zapier or n8n. You build a
workflow from nodes in a visual builder, or describe it in plain language and let the AI draft it, then publish it,
run it and watch every execution on the web or on your phone. Weav is a graduation thesis project.

**Demo:** [app.weav.id.vn](https://app.weav.id.vn) (web), [admin.weav.id.vn](https://admin.weav.id.vn) (admin),
[api.weav.id.vn](https://api.weav.id.vn) (API). The demo VM is not always running.

## Features

- **Builder.** Drag nodes onto a canvas, configure them in forms, test-run, publish versions, import and export.
- **Triggers.** Manual, webhook, schedule, Telegram bot, Gmail, and events from other workflows.
- **Actions.** Telegram messages, email, Google Calendar, Drive and Sheets, HTTP requests, data and text formatting,
  conditions and switches, OCR text extraction, and controlling other workflows from chat (`/run`, `/pause`, `/status`).
- **AI.** Generate, summarize, classify and extract nodes; a generator that turns a description into a workflow draft
  (it can leave blanks for you to fill in later); and an in-app AI assistant.
- **Workspaces.** Members with roles, email invitations, and connections that store each service's credentials encrypted.
- **Monitoring.** Execution history with per-node results, cancel, and an in-app notification inbox.
- **Shared templates**, an **admin console**, and a **mobile companion app** (monitor and control, no builder).

## Architecture

Three Spring Boot services (Identity, Workspace, Workflow) and three NestJS services (API Gateway, AI, Notification)
behind one gateway, with RabbitMQ for events and one Neon PostgreSQL database per service. OCR is a separate FastAPI
service. See the [architecture overview](docs/architecture/overview.md) for the diagram, the main flows and the key
decisions.

| Part | Stack |
| --- | --- |
| Web, Admin | React 19, Vite, TypeScript |
| Mobile | React Native, Expo |
| Identity, Workspace, Workflow | Java 25, Spring Boot 4 |
| API Gateway, AI, Notification | Node 24, NestJS 11 |
| OCR | Python, FastAPI (uv) |
| Data and messaging | Neon PostgreSQL, RabbitMQ, Cloudflare R2 |
| AI provider | DeepSeek |
| Delivery | GitHub Actions, GHCR, Docker Compose, Cloudflare Tunnel |

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web`, `apps/admin`, `apps/mobile` | Client apps |
| `services/*` | One folder per backend service, each with its own build, tests and Dockerfile |
| `packages/contracts` | OpenAPI files and event schemas shared between services |
| `packages/workflow-schema` | Workflow definition and node schemas |
| `packages/shared` | Generic utilities only, no business logic |
| `compose*.yml` | Local stack (`compose.yml` + `compose.dev.yml`), overlays, and the production stack (`compose.prod.yml`) |
| `infrastructure/` | Cloudflare Tunnel config, deploy timer, nginx config for the web image |
| `scripts/` | Dev keys, smoke tests, the pull-based deploy script |
| `docs/` | Architecture, specs, runbooks and work logs ([map](docs/README.md)) |

## Getting started

You need Node 24 with pnpm 11.22, JDK 25, Docker, and a Neon PostgreSQL project (we do not run databases locally).

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in the Neon, RabbitMQ and JWT values
docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build \
  rabbitmq identity-service workspace-service workflow-service api-gateway notification-service ai-service
pnpm --dir apps/web dev   # http://localhost:5173
```

The full guide, including Google OAuth, the AI provider and OCR, is [docs/development/SETUP.md](docs/development/SETUP.md).

## Tests

| Part | Command |
| --- | --- |
| Web | `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/web build`, `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium` |
| Admin | `pnpm --dir apps/admin exec tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/admin exec playwright test --project=chromium` |
| Mobile | `npx tsc --noEmit -p .` (from `apps/mobile`) |
| Spring Boot services | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (from the service folder) |
| NestJS services | `pnpm --dir <service> test`, `test:e2e`, `build` |
| OCR | `uv run pytest` (from `services/ocr-service`) |

CI runs on every push and pull request. When CI passes on `main`, images are published to GHCR and the demo VM deploys
them within a few minutes ([runbook](docs/deployment/demo-runbook.md)).

## Documentation

- [Architecture overview](docs/architecture/overview.md) and [rulebook](docs/rulebook.md)
- [Component specs](docs/specs/README.md), one per service and app
- [Demo runbook](docs/deployment/demo-runbook.md)
- [Work logs](docs/work_logs/README.md)
- How we work (branches, tests, logs, commits): [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)
