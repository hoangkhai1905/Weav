# Work log: Rulebook and component specs

| Field | Value |
| --- | --- |
| Date | 2026-09-30 (Asia/Saigon) |
| Branch / start commit | `dev` / `cdd2afa` |
| Status | Done (docs only); open questions await the team |
| Scope | Add `docs/rulebook.md` and one V1 spec per service and app under `docs/specs/` |

## Summary

- `docs/rulebook.md`: actors, BR01–BR09, UC → owner map, architecture/data/workflow/security rules, API and event conventions, definition of done, thesis/Notion conflicts.
- `docs/specs/README.md` and 10 specs (8 services, web, mobile) in one template, with every capability marked `Implemented` / `Partial` / `Planned` from the code on `dev`, citing file paths.
- Sources, in order: code and contracts, then `docs/superpowers/specs` and READMEs, then the thesis (§3.2) and Notion "Chốt kiến trúc Microservices V1". Code wins; conflicts are listed under each spec's "Open questions".

## Decisions

| Decision | Reason |
| --- | --- |
| Specs describe the V1 target with per-capability status | The user chose this; it keeps thesis scope visible without claiming unbuilt features |
| English, with thesis IDs kept | The user chose this |
| `email.send` marked Implemented, not Partial | `GmailNodeExecutor` and `GmailClient` are unconditional `@Component`s with a unit test; the workflow README gaps row is stale. Not yet run against real Gmail. |

### Follow-up decisions (same day)

| Decision | Recorded in |
| --- | --- |
| Owners: Workflow, Identity, AI, Workspace = K; Notification, OCR, Gateway = T; web, mobile and web admin = T for now, shared later; Bot = TBD | spec headers, rulebook §4 |
| UC017, UC027, UC028 stay Planned; implement later | specs (already Planned) |
| Bot = Telegram as a workflow channel: chat linking (users and workspace groups), Telegram trigger, group notifications via `telegram.send_message`; no list/run/pause from chat | `docs/specs/services/bot-service.md`, rulebook §3–4 |
| Mobile = everything web does except designing workflows, focused on monitoring | `docs/specs/apps/mobile.md` |
| OCR Service JWT verification deferred while T tests OCR on Colab | `docs/specs/services/ocr-service.md` |
| Web direct Identity call for Google OAuth acknowledged, fix pending | `docs/specs/apps/web.md` |
| Gateway handoffs passed to T | `docs/specs/services/api-gateway.md` |

## Changed files

| Type | Path |
| --- | --- |
| Add | `docs/rulebook.md`, `docs/specs/README.md`, `docs/specs/services/*.md` (8), `docs/specs/apps/{web,mobile}.md` |
| Edit | `docs/README.md` (links to the rulebook and specs; fixed the broken setup-guide link) |

## Verification

| Check | Result |
| --- | --- |
| Relative links in all new docs (script) | 0 broken |
| Secret patterns in new docs (grep) | none |
| Spot checks: mobile legacy `/api/workflows` etc. paths; web `deleteWorkflow` returns 405; Gateway controller list | confirmed in code |
| `git diff --check` | clean |
| Tests | Not run (docs only). Test counts in the specs are the 2026-09-30 `dev` results from the AI-service merge log. |

## Main open questions (details in each spec)

- Ownership of each component is not recorded in the docs (specs say TBD or suggest one).
- UC017 delete workflow and UC028 admin execution monitoring have no Workflow endpoint; UC027 has no admin route in Workspace.
- Bot Service is a scaffold (UC022–UC024 Planned); the Bot → Workflow contract is undefined.
- Mobile repositories for workflows, executions, connections, Telegram, and AI call legacy `/api/...` paths the Gateway does not serve.
- Web calls Identity directly for Google OAuth (bypasses the Gateway).
- OCR checks only that a Bearer token is present and does not verify the Service JWT; the contract requires verification.
- Gateway handoffs: generate route (32 KiB body, upstream deadline ≥ 80 s), webhook ingress, Bot, admin and delete routes.
- `.env.example` Google OAuth variable names differ from what Identity reads.

## Next steps

1. The team resolves the open questions; update spec status tables as features land.
2. Update the stale `email.send` row in `services/workflow-service/README.md`.
