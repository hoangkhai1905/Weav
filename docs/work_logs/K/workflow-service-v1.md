# Workflow Service V1 — consolidated work log

## Metadata and source of truth

| Field | Value |
| --- | --- |
| Work period | 2026-09-21 through 2026-09-24, Asia/Saigon |
| Repository / branch | Weav / `feature/workflow-service` |
| Owner | K / Codex coordinator and bounded workers |
| Baseline / implementation commit | `c836de2` / `18b6dfa` (`Implement Workflow Service V1`) |
| Status | Workflow V1 implementation committed locally; direct service smoke and integrated tests passed; external activation gates remain closed |
| Canonical documents | `docs/superpowers/specs/workflow-service-spec.md`, `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, `services/workflow-service/README.md` |

This replaces 29 per-task and review logs in `docs/work_logs/K/`. Their full historical detail remains available in commit `18b6dfa`; use `git show 18b6dfa:docs/work_logs/K/<old-name>.md` if an exact worker command or intermediate result is needed. The status below reflects the final integrated result, not every earlier provisional handoff.

## Delivered behavior and decisions

| Area | Final V1 behavior |
| --- | --- |
| Definition and mapping (Tasks 1–3) | Immutable JSON snapshots preserve explicit null; a 13-node catalog and schema validate draft structure and full publish semantics separately. DAG, trigger roots, condition ports, schedule syntax/timezone, reachability, and upstream mapping references are checked. Mapping supports only `{{ trigger.input... }}`, `{{ nodes.<id>.output... }}`, and `{{ variables... }}` paths; no scripting or implicit missing values. |
| Security and authoring (Tasks 4–7) | Identity access JWT protects public resource routes; Workspace capabilities authorize each operation. Internal usage uses its own service key. Create seeds one manual trigger; save replaces an editable draft under a workflow row lock; publication stores an immutable version and trigger registrations atomically; pause/resume preserve queued runs. Raw request size and credential-shaped fields are bounded/rejected. |
| Connection usage (Task 7) | V2 migration backfills `nodes[*].config.connectionId` into a transactionally maintained projection. Non-deleted drafts and **all stored immutable versions**, including versions of soft-deleted workflows, count as in use. An unknown/no-reference connection returns `200 {"inUse":false}`; Workflow does not call Workspace for the usage query. Workspace deletion fails closed on Workflow errors. |
| Admission and delivery (Tasks 8–12) | Manual, schedule, and webhook admissions pin the current version and write execution, node rows, and UUID-only outbox intent in one transaction. RabbitMQ publisher requires routed confirms. Worker leases/fencing, scanner recovery, attempts, retries, graph branches/joins, and sanitized monitor projections are persisted. Provider calls run outside database transactions; side effects remain at least once. |
| HTTP and Sheets (Tasks 13–14 plus assurance) | `http.request` resolves Workspace credentials per attempt; outbound targets are restricted by URL/DNS policy, pinned resolution, timeouts and size/header limits; redirects, automatic retries, and compression are disabled. HTTPS/SNI/hostname, slow-response deadline, and sanitization regressions passed. Google Sheets supports values read/append/update with a fixed Google endpoint and resolved OAuth credential. A real provider smoke was not run. |
| Closed integrations (Tasks 15 and 18) | Email, Telegram send/trigger, and AI nodes have explicit unavailable/readiness behavior; they do not produce fake success. HTTP `API_KEY` remains rejected until Workspace resolve supplies the configured header name. Workflow's OCR client and RS256 signer are present but OCR URL/artifact execution and verification gates default to disabled; production OCR activation was not accepted. |
| Automatic triggers (Tasks 16–17) | Schedule scanner coalesces missed slots and prevents duplicate admission under concurrency. Webhook publication issues a one-time endpoint key/secret, stores only a hash verifier, uses generic 404 for invalid/inactive credentials, no-store response, rate/body bounds, and atomic admission. V4 migration adds a unique endpoint index with duplicate-data preflight. |
| Web catalog (Task 20) | Catalog and palette align to 13 V1 types; condition ports/operators, six-field cron/timezone, and integration readiness are visible. Old unsupported draft nodes are retained and warned on. The existing local-storage builder was **not** connected to the new backend by this task. |
| Runtime and contract (Task 21) | Workflow OpenAPI/schema/examples, service configuration, additive migrations V2–V4, Compose overlay, and direct-service smoke scripts are present. Readiness checks database/broker; liveness is process-local and health details are hidden. |

Task 19 Gateway routing belongs to the user's partner and is excluded from this delivery. Notification Service was not part of this work. Do not interpret visible AI/Telegram/OCR catalog entries as live provider integrations.

## Verification and release review

| Check | Final evidence | Limit |
| --- | --- | --- |
| Workflow Maven | 354 tests, 0 failures/errors/skips across 56 Surefire suites; executable JAR package passed | Java 25 tests used `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`, Docker Desktop/Testcontainers, and the cached Maven repository. |
| Workspace boundary | 63 focused security, connection, usage, and Workflow contract tests passed | Docker was initially stopped in one attempt; rerun after restart passed. |
| Web | TypeScript build and Vite build passed; focused ESLint passed; Playwright Chromium Workflow catalog/UI 30 passed | Browser ran in mock API mode, not a backend-connected authoring flow. OCR cases were excluded from release review. |
| Direct live smoke | Identity registration/login, Workspace create, Workflow draft create/save/get/list, publish, manual admission, persisted SUCCESS, condition active/inactive states, expected skipped HTTP/join nodes; zero outbound HTTP calls | Isolated test schemas on the shared project database remain. The helper removed its containers/network/volume and never drops schemas. |
| Schema and contract | Testcontainers applied V2–V4; migration/backfill, webhook duplicate preflight, JSON/schema fixtures, and OpenAPI parsing passed | Migration compatibility is covered by tests, not a production upgrade rehearsal. |
| Git review | `git diff --cached --check` passed before commit `18b6dfa`. GitNexus pre-commit scan covered 241 staged files, 3,216 changed symbols and 157 affected processes; `critical` blast radius was corroborated with source/test review | Symbol listing was capped at 1,000, so it was not an exhaustive per-symbol inspection. Post-commit graph/embeddings indexing succeeded; full-text/BM25 index failed on invalid UTF-8 and remains a GitNexus maintenance item. |
| 2026-09-24 log and local config maintenance | 29 Workflow logs replaced by this file; four other K logs were hash-checked unchanged. All 57 missing Workflow-related keys are present once in ignored `.env`; Docker Compose config with `.env`, base and dev overlay passed | Existing `.env` lines/values were preserved exactly. Blank internal keys still require local provisioning before cross-service use. |

The direct smoke scripts now call Workflow Service without Gateway. The earlier Gateway-oriented attempt stopped during database bootstrap and is superseded by the passing direct smoke. Earlier worker-level test counts were provisional; use the final integrated results above for this commit.

## Configuration and operational limits

- `.env.example` contains documented Workflow database, service URL/key, admission, outbox, schedule, worker, HTTP, and disabled OCR settings. On 2026-09-24, the ignored local `.env` received 57 missing Workflow-related entries copied from that template; every existing line/value was preserved. No `.env` values were logged or committed.
- `WORKFLOW_INTERNAL_SERVICE_KEY` and `WEAV_INTERNAL_SERVICE_KEY` are blank in the new local entries. Provision two appropriate local values before using Workflow↔Workspace internal calls. The worker remains disabled by default; enable it only for an intended worker deployment.
- The live Google Sheets provider, backend-connected web authoring, production metrics/dashboards, and real external dependency acceptance remain separate work. OCR production gates remain disabled; AI/Bot/Gmail/Telegram contracts or adapters must be approved before activation.
- Execution delivery is durable but external provider side effects are at least once. Schedule downtime coalesces missed ticks, and republishing a webhook creates a new endpoint/one-time secret. Use the README's persisted outbox/lease/attempt evidence until dedicated metrics and alerts exist.
- Shared database smoke schemas and records were intentionally retained. Confirm exact ownership before any cleanup. Do not delete them as part of repository log condensation.

## Handoff

1. Keep Gateway routing with the partner; test its forwarding separately against the committed Workflow service.
2. Provision the two internal service keys locally before cross-service use. Validate `docker compose --env-file .env -f compose.yml -f compose.dev.yml --profile app config --quiet` after changing runtime settings.
3. For future Workflow changes, run focused tests, the relevant integration suite, `git diff --check`, and GitNexus impact/change checks. Review the current spec, plan, README, and this log; retrieve an old per-task log from commit `18b6dfa` only when its detailed provenance is needed.

No credentials, `.env` values, connection strings, access tokens, or personal data are recorded here.
