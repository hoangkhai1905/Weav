# Week 7 mobile handoff

Each Week 7 lane appends its own `##` section below. Append only; do not reorder other sections.

## W7-A1 invitations

Owners can now invite an e-mail address that has no Weav account. The person signs up with that address, verifies it, and answers the invitation. No mobile code was written; this is what the app needs when it adds the screens.

### Add-member fallback

`POST /api/v1/workspaces/{id}/members` is unchanged and still returns `404 USER_NOT_FOUND` for an unknown e-mail. On that 404 the app can offer "send an invitation instead" and call the create route below.

### Owner routes (OWNER only, Bearer JWT)

| Route | Result |
| --- | --- |
| `POST /api/v1/workspaces/{id}/invitations` `{ "email": "..." }` | `201` `OwnerInvitation` |
| `GET /api/v1/workspaces/{id}/invitations` | `200` `{ "items": OwnerInvitation[] }` (pending, expired ones included, newest first, max 50) |
| `DELETE /api/v1/workspaces/{id}/invitations/{invitationId}` | `204` |
| `POST /api/v1/workspaces/{id}/invitations/{invitationId}/resend` | `200` `OwnerInvitation` (once per 10 minutes) |

`OwnerInvitation` = `{ id, workspaceId, email, status, invitedBy, createdAt, expiresAt, lastSentAt }`. `status` is `PENDING`, `EXPIRED`, `ACCEPTED`, `DECLINED` or `REVOKED`; all times are ISO-8601 UTC. Invitations expire after 7 days.

### Invitee routes (any signed-in user)

| Route | Result |
| --- | --- |
| `GET /api/v1/invitations` | `200` `{ "items": MyInvitation[], "emailVerified": boolean }` |
| `POST /api/v1/invitations/{invitationId}/accept` | `200` `{ "workspaceId": "..." }` (joins as MEMBER; calling it twice is fine) |
| `POST /api/v1/invitations/{invitationId}/decline` | `204` |

`MyInvitation` = `{ id, workspaceId, workspaceName, invitedByName, expiresAt }`. If the caller's e-mail is not verified the list is empty with `emailVerified: false`; send the user to the existing e-mail verification screen. After accept, switch the active workspace to the returned `workspaceId`.

### Error codes (`{ code, message, requestId }`)

- `409`: `USER_EXISTS` (an account exists, use the direct add), `USER_INACTIVE`, `INVITATION_EXISTS`, `INVITATION_NOT_PENDING`, `EMAIL_NOT_VERIFIED`.
- `429`: `INVITATION_LIMIT` (50 pending per workspace), `INVITATION_RESEND_TOO_SOON`; the gateway also rate limits create and resend per user (`429 TOO_MANY_REQUESTS`).
- `410`: `INVITATION_GONE` (expired, revoked, declined, or workspace deleted).
- `404`: `INVITATION_NOT_FOUND` (also returned for another e-mail's invitation).

### How to check

1. Owner calls the create route with a fresh `+alias` address; the e-mail arrives when `NOTIFICATION_EMAIL_ENABLED=true`.
2. Sign up with that address, verify it, then `GET /api/v1/invitations` lists it and accept makes the user a member.

## W7-A2 (node bundle)

No mobile change required. Connection providers SLACK and TEAMS (authType TOKEN) were added to the workspace connection provider enum; mobile only needs an update if it lists providers exhaustively.
