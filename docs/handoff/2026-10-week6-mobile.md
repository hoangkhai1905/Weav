## B. Workspace delete (W6-D2)

For the partner who owns `apps/mobile`. Nothing here changed that folder. The backend, gateway and web are done; the mobile app needs the call, the confirmation UI and the notification mapping.

### What it does
An OWNER can delete a workspace (soft delete). The server first pauses every workflow of the workspace (schedule, webhook, Telegram, Gmail triggers stop), then marks the workspace deleted, disables its connections, deletes their saved credentials and notifies the other members. A deleted workspace disappears from every list and returns `404` everywhere; its name can be reused by the same owner.

### 1. Repository call
`deleteWorkspace(id, name)` -> `DELETE /api/v1/workspaces/:id` with a JSON body (needs `Content-Type: application/json`).

```http
DELETE /api/v1/workspaces/3fa85f64-5717-4562-b3fc-2c963f66afa6
Authorization: Bearer <access token>
Content-Type: application/json

{ "name": "Alpha team" }
```

Success: `204 No Content`, empty body. The name is compared trimmed and case-insensitively. Allow a long timeout (the server may take up to ~30 s to stop workflows; web uses 40 s).

| Status | Meaning | What to show |
| --- | --- | --- |
| 400 | `name` missing, blank, over 255 chars, or does not match the workspace name | "Typed name does not match" and keep the sheet open |
| 401 | Not signed in | normal sign-in flow |
| 403 | Caller is a member, not the owner | hide the action for non-owners; treat 403 as "owner only" |
| 404 | Workspace already deleted or caller has no access | treat as deleted: remove it locally, no error |
| 503 | Not every workflow could be stopped; the workspace was NOT deleted (some workflows may already be paused) | "Workflows could not be stopped, the workspace was not deleted. Try again later." Retry is safe (idempotent) |

Error bodies follow the usual envelope (`{ code, message, requestId }` or `{ error: { code, ... } }`); branch on the HTTP status.

Known and accepted: other services cache a member's access for up to 30 s (workflow-service), so a member with a warm cache entry may still act on the deleted workspace for up to 30 s after the delete; the workspace and its list are gone immediately.

### 2. UI
- Show "Delete workspace" only when the current member's role is `OWNER` (the Workspace settings screen is the natural place; web puts it in a "Danger zone" block).
- Confirmation: a destructive sheet that lists the consequences (workflows stop, connections and credentials removed, members lose access) and requires typing the workspace name before the confirm button is enabled.
- After `204`: remove the workspace from the store and from cached queries, select another workspace if one remains, otherwise open the create-workspace / first-workspace screen. Do not keep showing the deleted workspace.

### 3. Notifications
Other members receive a new event type (the owner who deleted does not):
- `eventType`: `workspace.deleted`, category `WORKSPACE`, severity `WARNING`, `target: { "kind": "NONE" }` (like `workspace.member_removed`).
- Copy comes from the server in the user's locale: "Không gian làm việc đã bị xóa" / "Workspace deleted", message "Không gian làm việc “{name}” đã bị chủ sở hữu xóa. Các quy trình của nó đã dừng." Because the workspace no longer exists, do not navigate on tap.
- If the app caches the workspace list, a `workspace.deleted` notification for the currently selected workspace should trigger a workspace list refresh (the next list call no longer returns it, and calls scoped to it return 404).

### 4. How to check
1. As owner of a throwaway workspace with one published workflow, delete with the right name: `204`, workspace gone from the list, workflow triggers stop.
2. Wrong name: `400`, nothing changes.
3. As a plain member of the same kind of workspace: no delete action; a manual `DELETE` returns `403`.
4. With a second account that is a member: after the owner deletes, that account gets the `workspace.deleted` notification and the workspace disappears from its list on refresh.
