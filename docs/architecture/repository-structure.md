# Repository Structure

This document records the planned Weav monorepo structure.

## Architecture principles

- Monorepo for Web, Mobile, backend services, shared contracts, and infrastructure.
- Business-heavy services follow Clean Architecture where it adds value.
- Domain/Application layers do not depend on databases, message brokers, frameworks, or external APIs.
- Database migrations belong to the service that owns the data.
- `packages/shared` must not contain business logic.
- Workflow Service contains API, Scheduler, and Worker responsibilities, which may run as separate processes/containers.
- RabbitMQ is infrastructure; publishers/consumers live in the services that use it.

## Top-level layout

```text
weav/
├── apps/
│   ├── web/
│   └── mobile/
├── services/
│   ├── api-gateway/
│   ├── auth-service/
│   ├── workflow-service/
│   ├── ai-service/
│   ├── ocr-service/
│   └── bot-service/
├── packages/
│   ├── contracts/
│   ├── workflow-schema/
│   └── shared/
├── infrastructure/
├── docs/
├── tests/
├── examples/
├── scripts/
├── .github/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
└── README.md
```

The deeper folders are scaffolded as placeholders and should be adjusted when each module is implemented.
