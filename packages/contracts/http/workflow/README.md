# Workflow HTTP contract

The canonical contract is [`openapi.yaml`](./openapi.yaml). Workflow Service
receives the resource paths without `/api/v1`; the API Gateway owns that public
prefix. The contract covers workflow resources and lifecycle, manual execution
and monitoring, one-time webhook provisioning and ingress, scheduled triggers,
and the internal connection usage operation.

## Execution admission and monitoring

`POST /workspaces/{workspaceId}/workflows/{workflowId}/executions` accepts only
an object input:

```json
{"input":{"count":2}}
```

The authenticated principal must have `WORKFLOW_RUN`, and the workflow must be
`PUBLISHED`. The execution row, initial node rows, and UUID-only outbox intent
are committed before the service returns `202`:

```json
{
  "executionId":"00000000-0000-0000-0000-000000000002",
  "workflowId":"00000000-0000-0000-0000-000000000001",
  "workflowVersionId":"00000000-0000-0000-0000-000000000003",
  "status":"QUEUED"
}
```

`GET` execution list and detail require `WORKFLOW_MONITOR`. The service checks
the workspace, workflow, and execution tuple together before returning a
projection. List ordering is deterministic by `createdAt` descending and ID
descending. Detail logs default to `logPage=0&logSize=20`, accept at most 100
entries per page, and expose `hasNext`.

Execution output, errors, attempt data, log messages, and log metadata are
sanitized recursively before they reach the HTTP response. Provider
credentials, bearer values, signed URL query values, and credential-bearing
fields are removed or redacted. The API never serializes JPA associations.

Malformed JSON, invalid UUIDs, validation failures, pagination violations,
authorization failures, lifecycle conflicts, and unexpected failures use the
standard structured error envelope. The raw request body limit applies to the
manual execution route, including chunked requests.

## Monitoring and alert rules (W6-A)

`GET /workspaces/{workspaceId}/executions` is the workspace-wide run history
(filters `status`, `workflowId`, `from`, `to`, paging as the per-workflow list;
a time range is at most 90 days). `GET /workspaces/{workspaceId}/monitoring/summary?days=1..30`
returns counts, success rate, average and p95 duration, a zero-filled UTC day
trend, the top failing workflows and the latest failures in one response. Both
need `WORKFLOW_MONITOR`. `GET|POST /workspaces/{workspaceId}/alert-rules` and
`PUT|DELETE .../alert-rules/{ruleId}` manage per-workspace alert rules (at most
20; changes need `WORKFLOW_EDIT`). When a rule fires, Workflow enqueues the
`monitoring.alert.consecutive_failures` or `monitoring.alert.long_running`
notification event (see `events/notification`). Contract tests:
`MonitoringHttpTest` (workflow-service) and the monitoring block of
`workflow.module.spec.ts` (api-gateway).

## Internal connection usage

`GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage` is
called by Workspace Service with `X-Internal-Service-Key`. The success shape is
exactly `{"inUse":true}` or `{"inUse":false}`. A missing or invalid key returns
`401`; the bounded process-wide limiter returns `429`; database failures return
a sanitized `500`. The lookup reads only Workflow-owned reference data and
counts stored immutable versions, including versions of soft-deleted workflows.

## Webhooks and schedules

Publishing a workflow provisions new webhook endpoint keys and random secrets.
The plaintext secret is returned only in the publication response with
`Cache-Control: no-store`; persisted data contains a SHA-256 verifier. A later
workflow read never returns the endpoint key or secret. Republish rotates the
endpoint and secret, and prior registrations become inactive.

`POST /webhooks/{endpointKey}` accepts `X-Webhook-Secret` without a user JWT.
Unknown, wrong, missing, inactive, paused, and superseded endpoints all return
the same generic `404`. Ingress bodies are limited to 1 MiB and the process
applies a bounded rate limiter. Endpoint keys and secrets must be excluded from
logs, metrics, traces, and error details.

`trigger.schedule` registrations use the published six-field cron and IANA
timezone. The durable scanner bounds each batch and admits the execution,
outbox intent, and schedule-slot advance atomically. After downtime, missed
ticks are coalesced into one run for the stored due instant; resume schedules
the next future occurrence rather than replaying paused slots.

The current V1 implementation includes manual, webhook, and scheduled
admission. Deferred provider integrations remain unavailable or gated: do not
infer readiness from a documented node type alone. See
[`services/workflow-service/README.md`](../../../../services/workflow-service/README.md)
for runtime configuration, integration readiness, and acceptance commands.

## Stop a run and run expressions (W6-C3)

`POST /workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}/cancel`
needs `WORKFLOW_RUN` and has no body. A QUEUED run ends CANCELLED at once
(`202 {"status":"CANCELLED"}`); a RUNNING or WAITING run gets a flag the runner
checks between nodes (`202 {"status":"CANCEL_REQUESTED"}`): the node already running
finishes, the rest are CANCELLED and the run ends CANCELLED with error code
`CANCELLED_BY_USER`. A run that already ended answers `409 EXECUTION_ALREADY_FINISHED`;
an unknown run, or one of another workflow or workspace, answers 404. A stopped run
records no `workflow.failed` notification and counts as neither success nor failure
in monitoring. Contract tests: `ExecutionCancelStateTest`, `ExecutionRunnerTest` and
`WorkflowExecutionHttpTest` (workflow-service), the stop block of
`workflow.module.spec.ts` (api-gateway).

Mappings gain `{{ now }}` (ISO-8601 UTC instant when the step starts), `{{ run.id }}`,
`{{ workflow.id }}` and `{{ workflow.name }}`; existing roots are unchanged.
