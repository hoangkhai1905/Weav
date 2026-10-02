# Notification Inbox HTTP v2

Notification owns the persisted inbox and exposes it at `/api/v2/notifications`. The API Gateway exposes the same authenticated paths and proxies them to Notification. Existing `/api/notifications` and `/api/v1/notifications` remain the legacy delivery view; their response shapes and read state are unchanged.

## Authentication and scope

Send `Authorization: Bearer <Identity access JWT>`. Notification validates the access-token signature, issuer, audience, expiry, active-user status, and required claims. Every operation is scoped only by the verified JWT `sub`; `userId` is not an accepted query parameter. Missing/invalid authentication returns `401` using the service error envelope.

Inbox content is a stored, safe summary. A `target` is only a catalog navigation descriptor, not a URL or access grant. A destination service must still authorize access using current membership/permissions. In particular, `workspace.member_removed` has `{ "kind": "NONE" }`.

## List

`GET /api/v2/notifications`

| Query        | Default | Allowed values                                       |
| ------------ | ------- | ---------------------------------------------------- |
| `limit`      | `20`    | Decimal integer `1`–`100`                            |
| `cursor`     | none    | Opaque base64url JSON cursor, at most 512 characters |
| `unreadOnly` | `false` | Exact `true` or `false`                              |
| `category`   | none    | `WORKFLOW`, `WORKSPACE`, `CONNECTION`, `SECURITY`    |
| `locale`     | `vi`    | `vi`, `en`                                           |

Unknown, repeated, empty, or invalid query values return `400`. Results are ordered by `createdAt DESC, id DESC`. The opaque cursor contains `{ "id": "<uuid>", "createdAt": "<ISO-8601 timestamp with timezone>" }`; clients must treat it as opaque and send it URL-encoded. The cursor is generated from the last returned item only when another item exists. The JWT recipient scope and filters still apply on every page.

Response:

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000010",
      "eventType": "workflow.completed",
      "category": "WORKFLOW",
      "severity": "SUCCESS",
      "title": "Workflow run completed",
      "message": "The run of workflow “Daily report” completed successfully.",
      "target": {
        "kind": "EXECUTION",
        "workspaceId": "00000000-0000-4000-8000-000000000020",
        "executionId": "00000000-0000-4000-8000-000000000030"
      },
      "workspaceId": "00000000-0000-4000-8000-000000000020",
      "executionId": "00000000-0000-4000-8000-000000000030",
      "occurredAt": "2026-09-27T04:00:00.000Z",
      "createdAt": "2026-09-27T04:01:00.000Z",
      "readAt": null
    }
  ],
  "nextCursor": null
}
```

The `items` object has exactly the fields shown. Only the requested locale's stored title, message, and validated catalog target are returned. Provider destinations, delivery status, raw payload, source/deduplication IDs, user IDs, and actor IDs are not part of this contract.

## Unread count and read state

- `GET /api/v2/notifications/unread-count` → `200 { "count": 3 }`
- `PATCH /api/v2/notifications/:id/read?locale=en` → `200 { "item": <InboxView> }`
- `POST /api/v2/notifications/read-all` → `200 { "updatedCount": 3 }`

`locale` on the PATCH is optional and defaults to `vi`; no other PATCH query parameter is accepted. The ID must be a UUID. Missing and foreign-user IDs both return `404`. Repeating a read is idempotent and preserves the original `readAt`; read-all changes only previously unread inbox rows. Invalid IDs/query values return `400`.

## Errors and compatibility

Errors use the service envelope `{ "error": { "code", "message", "details": [] }, "status", "timestamp", "path" }`. Relevant statuses are `400` invalid input, `401` invalid/missing JWT, `404` missing or foreign inbox item, and `503` unavailable dependency; internal failures do not expose database details.

Legacy delivery-read APIs and v2 inbox-read APIs are independent compatibility views during rollout. A legacy read does not update an inbox item, and a v2 read does not change a provider delivery or worker lease. Backfill seeds inbox state once; there is no online bidirectional synchronization. Perform the initial bounded reconciliation with the legacy consumer and legacy read writes quiesced, and keep them quiesced through final migration/reconciliation checks. Resume normal ingestion on the Task 3-compatible service only after those checks pass; enable web/mobile clients on v2 after the coordinated cutover. Producer labels in v2 event schemas are validation metadata, not publisher authentication; restrict publishing through broker ACLs.
