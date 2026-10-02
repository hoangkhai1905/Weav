# Component specs

One spec per service and app, describing the **V1 target** and marking each capability `Implemented`, `Partial`, or `Planned` based on the code on `dev`. Cross-cutting rules (business rules BR01–BR09, use-case owners, architecture, security) are in the [rulebook](../rulebook.md).

| Component | Stack | Spec |
| --- | --- | --- |
| API Gateway | NestJS | [services/api-gateway.md](services/api-gateway.md) |
| Identity | Spring Boot | [services/identity-service.md](services/identity-service.md) |
| Workspace | Spring Boot | [services/workspace-service.md](services/workspace-service.md) |
| Workflow | Spring Boot | [services/workflow-service.md](services/workflow-service.md) |
| AI | NestJS | [services/ai-service.md](services/ai-service.md) |
| OCR | FastAPI | [services/ocr-service.md](services/ocr-service.md) |
| Bot | NestJS | [services/bot-service.md](services/bot-service.md) |
| Notification | NestJS | [services/notification-service.md](services/notification-service.md) |
| Web | React + Vite | [apps/web.md](apps/web.md) |
| Mobile | React Native + Expo | [apps/mobile.md](apps/mobile.md) |

## How these specs relate to other docs

- **Code wins.** When a spec and the code disagree, fix the spec or list the conflict under its "Open questions".
- **Feature designs** (one change, with alternatives and a plan) go in [docs/superpowers/specs](../superpowers/specs) and [plans](../superpowers/plans). When a feature lands, update the component spec's status tables.
- **Contracts** (OpenAPI, event schemas) live in [packages/contracts](../../packages/contracts). Specs link to them; they don't copy them.

## Spec template

Every spec uses these sections, in this order. If a section has nothing in it, write "None" rather than leaving it out.

1. Header line: overall V1 status, owner, last-verified date and branch
2. Purpose and scope (including what the component does *not* do)
3. Use cases covered (UC | name | status | notes)
4. Business rules
5. Domain model and data
6. API (public through the Gateway; internal service-to-service)
7. Events and messaging
8. Dependencies
9. Security
10. Configuration (variable names and defaults, never secret values)
11. Non-functional requirements
12. Status and known gaps
13. Testing
14. Open questions
15. References
