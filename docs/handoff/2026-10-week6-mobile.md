# Week 6 mobile handoff (partner)

## A. Mobile Google sign-in (W6-D1)

Backend is ready (identity-service + API Gateway). Nothing in `apps/mobile` was changed. This section is what the app must do. Design: the server runs the whole Google flow with PKCE; the app only opens a browser, catches a deep link and exchanges a one-time code for a normal session.

### A.1 Prerequisites

| What | Detail |
| --- | --- |
| Identity must have mobile enabled | Env `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback` on identity (empty = disabled; both mobile routes then answer `503 DEPENDENCY_UNAVAILABLE`). Set by K, not by you. |
| New app config `EXPO_PUBLIC_IDENTITY_URL` | The PUBLIC base URL of identity-service (browser leg), e.g. `https://<tunnel>.trycloudflare.com` in dev. The exchange does NOT use it: it goes through the gateway (`EXPO_PUBLIC_API_BASE_URL`). |
| Deep-link scheme `weav` | `apps/mobile/app.json` has `"scheme": "mobile"` today. Add `weav` (`"scheme": ["mobile", "weav"]` or replace it). This is a native config change: it needs a native rebuild (`expo prebuild` / a new dev client or EAS build), an OTA update is not enough. |
| PKCE helpers | `expo-crypto` is NOT installed. Add it (it also needs the rebuild) for random bytes and SHA-256, or any SHA-256 you prefer. `expo-web-browser`, `expo-linking`, `expo-secure-store` are already installed. No `expo-auth-session` needed. |
| HTTPS identity on a device | The correlation cookie that ties the Google callback to the start request is `Secure`. The system browser drops it over plain `http://` unless the host is `localhost`. A phone or emulator reaching a LAN IP / `10.0.2.2` over http will fail at the callback with `400 OAUTH_CALLBACK_INVALID`. Use an HTTPS tunnel to identity (`cloudflared tunnel --url http://localhost:8081`). The coordinator then sets `GOOGLE_REDIRECT_URI=https://<tunnel>/auth/oauth/google/callback` on identity and registers that exact URI in Google Cloud Console (same OAuth client as the web). |

### A.2 Flow

```
App                         System browser            Identity (public URL)          Google          Gateway
 | make verifier+challenge       |                          |                          |                |
 | openAuthSessionAsync(startUrl, 'weav://auth/callback') -->|                          |                |
 |                               | GET /auth/oauth/google/mobile/start?... ----------->|                |
 |                               |<-- 303 to Google + Set-Cookie __Secure-weav_oauth_tx|                |
 |                               |------------------------ user signs in ------------->|                |
 |                               | GET /auth/oauth/google/callback?code&state (cookie) |                |
 |                               |<-- 303 weav://auth/callback?transaction_id=..&handoff_code=..        |
 |<-- result.url (deep link) ----|                          |                          |                |
 | POST /api/auth/oauth/mobile/exchange {transactionId, handoffCode, codeVerifier} ------------------->|
 |<-- 200 {accessToken, refreshToken, tokenType, expiresIn, refreshExpiresAt, user} --------------------|
```

### A.3 Step by step

1. **PKCE.** Generate a `codeVerifier`: 43..128 characters from `A-Z a-z 0-9 - . _ ~` (for example 32 random bytes, base64url, no padding = 43 chars). Keep it in memory only. `codeChallenge = base64url(SHA-256(codeVerifier))` with no padding, always exactly 43 characters. Method is always `S256`.
2. **Open the browser** (do not use `fetch` for this leg; the cookie must land in the browser that later receives Google's callback):
   ```ts
   const startUrl =
     `${IDENTITY_URL}/auth/oauth/google/mobile/start` +
     `?codeChallenge=${codeChallenge}&codeChallengeMethod=S256`;
   const result = await WebBrowser.openAuthSessionAsync(startUrl, 'weav://auth/callback');
   ```
3. **Read the result.** `result.type === 'success'` carries `result.url`. Any other type (`cancel`, `dismiss`, `locked`) means the user left: show nothing or a neutral message and stay on the login screen. Parse `result.url` (for example `Linking.parse`):

   | Query parameter | Meaning |
   | --- | --- |
   | `transaction_id` + `handoff_code` | Success: continue to step 4. Both are 43 base64url characters. Always present together. |
   | `transaction_id` + `oauth_error=cancelled` | The user cancelled on Google's consent screen. Not an error banner; return to login. |
   | `transaction_id` + `oauth_error=provider_unavailable` | Google or the token exchange failed. Show "Google sign-in is unavailable, try again". |

   If the browser shows a JSON error page instead of redirecting (callback with missing/expired cookie or `state`, `400 OAUTH_CALLBACK_INVALID`), the auth session never returns a `success` URL; treat `cancel`/`dismiss` the same way and let the user retry. A new attempt always starts at step 1 with a NEW verifier.
4. **Exchange through the gateway** (public route, no `Authorization` header, no cookies, no CSRF):
   ```
   POST {EXPO_PUBLIC_API_BASE_URL}/api/auth/oauth/mobile/exchange
   Content-Type: application/json

   { "transactionId": "<transaction_id>", "handoffCode": "<handoff_code>", "codeVerifier": "<verifier from step 1>" }
   ```
   Body is strict: exactly these three fields (an extra field, a wrong length or a character outside the alphabets gives `400`). `transactionId` and `handoffCode` are 43 chars of `A-Za-z0-9_-`; `codeVerifier` is 43..128 chars of `A-Za-z0-9._~-`.

   `200` response, the SAME shape as `POST /api/auth/login` (`TokenResponse`):
   ```json
   {
     "accessToken": "<jwt>",
     "refreshToken": "<opaque 43 chars>",
     "tokenType": "Bearer",
     "expiresIn": 900,
     "refreshExpiresAt": "2026-10-15T08:00:00Z",
     "user": { "id": "<uuid>", "email": "person@gmail.com", "displayName": "Person", "...": "same fields as login" }
   }
   ```
   Tokens are in the BODY only; the response sets no cookies. Store them exactly like the password login does (`http-auth.repository.ts`: tokens into `useAuthStore`, refresh token into SecureStore) and refresh with the existing `POST /api/auth/refresh`. Do not log tokens, the verifier or the handoff code.
5. **One shot.** The handoff code is single use and lives 60 seconds. Exchange right after the deep link arrives. A wrong verifier counts as a failure (5 failures burn the handoff); a successful exchange or a reuse of the same code gives `401`. Do not retry an exchange automatically; on failure go back to step 1.

### A.4 Errors

**Branch on the HTTP status first**, then (optionally) on `error.code`. The exchange goes through the gateway, so the same status can carry a gateway code or an identity code. Body shape for both: `{ "error": { "code": "...", "message": "...", "details": [] }, "status": <http>, "requestId": "..." }` (identity's body may omit `requestId`).

| HTTP | Gateway code (before/instead of identity) | Identity code (relayed unchanged) | Meaning and what the app should show |
| --- | --- | --- | --- |
| 400 | `BAD_REQUEST` (body is not a JSON object or fails the strict schema: extra field, wrong length or alphabet) | `VALIDATION_ERROR` / `MISSING_PARAMETER` (mobile/start query, or exchange body) | App bug (challenge not 43 base64url chars, method not exactly `S256`, malformed body). Do not retry; log without the secret values. |
| 401 | none | `OAUTH_HANDOFF_INVALID` | Wrong verifier, expired (60 s), already used, 5 failures reached, or the code belongs to another client (a web handoff). Restart the flow with a new verifier. |
| 401 | none | `UNAUTHORIZED` | The Google account may not sign in (account disabled, or Google did not verify the email). Generic message. |
| 409 | none | `ACCOUNT_LINK_REQUIRED` | An account with this email already exists with a password. Show "sign in with your password, then link Google from the web app". Google linking stays web-only. The handoff is spent. |
| 409 | none | `CONFLICT` | A concurrent sign-in created the same Google account; restart the flow. |
| 429 | `TOO_MANY_REQUESTS` (gateway throttling, shared public-auth bucket per IP) | `RATE_LIMITED` (identity, +`Retry-After`) | Too many attempts from this IP. Wait for `Retry-After` and retry manually. |
| 503 | `SERVICE_UNAVAILABLE` (identity unreachable / timed out) | `DEPENDENCY_UNAVAILABLE` (mobile sign-in disabled on the server, or Valkey/Google down) | Offer password login; try again later. |

For the browser leg (`mobile/start`) only identity answers, and the browser shows its JSON body; the app just sees the auth session end without a `success` URL (treat as cancel).

### A.4b Rate limits and proxies (for K / deployment)
- Both identity and gateway key their limits on the client IP. Identity trusts `X-Forwarded-For` only from the gateway, so the browser legs (`mobile/start`, `callback`) that reach identity directly through a tunnel or reverse proxy (cloudflared, Caddy) all appear as the proxy's IP: they share ONE bucket per proxy IP. `OAUTH_START_IP` is 10 per 15 minutes and is shared with the web start (`POST /auth/oauth/google/start`), so a busy demo can hit `429` on sign-in.
- Deployment: set `GATEWAY_TRUST_PROXY_HOPS` to match the proxy chain in front of the gateway, and add the public reverse proxy to identity's trusted-proxy pattern, otherwise every user looks like one IP.

### A.5 Account rules (same as web Google login)
- A Google account already linked to a user signs that user in. A new Google account with a verified email and no existing user creates a user without a password (`displayName` from Google); an existing email gives `409 ACCOUNT_LINK_REQUIRED`.
- Scopes are only `openid email profile`. Linking and unlinking Google accounts is not available on mobile.

### A.6 How to test
1. K: identity running with `GOOGLE_CLIENT_ID/SECRET`, `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback`, an HTTPS tunnel to identity and `GOOGLE_REDIRECT_URI` set and registered to the tunnel callback; gateway running.
2. App: `EXPO_PUBLIC_IDENTITY_URL=https://<tunnel>`; rebuilt dev client with the `weav` scheme.
3. Tap "Sign in with Google": the system sheet opens, Google consent shows, the sheet closes by itself, the app lands signed in. Expect exactly one `POST /api/auth/oauth/mobile/exchange` in the gateway log with status 200.
4. Negative checks: cancel on the consent screen (back to login, no banner); close the sheet manually; call the exchange twice (second is `401 OAUTH_HANDOFF_INVALID`).

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

## C. Shared templates API (W6-C1)

Backend is ready (workflow-service + API Gateway). Nothing in `apps/mobile` was changed. Mobile screens are the partner's work; this is the contract. Web uses the same routes (gallery tabs, enter-code dialog, share dialog in the builder).

### C.1 Idea

A user shares one of their workflows as a template: a sanitized snapshot (connections, recipients, chat ids, sheet ids and similar personal fields are removed on the server). Others browse or open a template by its 8-character code, then copy it into one of their workspaces as a new draft and re-pick connections. The static built-in templates of the app are unrelated and stay as they are.

| Visibility | Who sees it |
| --- | --- |
| `PRIVATE` | members of the workspace it was shared from ("team library"); never resolvable by code |
| `UNLISTED` | anyone signed in who has the code or the id; never listed |
| `PUBLIC` | the gallery (search and browse); published immediately; a system admin can take it down |

All routes need `Authorization: Bearer <access token>` and go through the gateway under `/api/v1`. A template the caller may not see answers `404` (never `403`), also for ids and codes that do not exist.

### C.2 Routes

| Call | Result |
| --- | --- |
| `GET /templates?scope=public&q=&page=0&size=20` | gallery page, most used first. `scope=mine` = everything you own (any visibility). `scope=workspace&workspaceId=<id>` = PRIVATE templates of that workspace (`403` if not a member) |
| `GET /templates/by-code/{code}` | open by code. Typing is forgiving: `wv7k-3m9q`, spaces and lower case all work; `I`/`L` read as `1`, `O` as `0`. `404` for an unknown, deleted or PRIVATE code. Rate limited (see C.4) |
| `GET /templates/{id}` | open by id |
| `POST /templates/{id}/use` body `{"workspaceId":"<id>","name":"optional"}` | `201 {"workflowId":"<id>"}`: a new draft in that workspace. Needs permission to create workflows there (`403` otherwise). Open the builder on the returned id |
| `PATCH /templates/{id}` body any of `{name, description, visibility}` | owner only (`403` for others who can see it) |
| `DELETE /templates/{id}` | owner only, `204` |
| `POST /workspaces/{ws}/workflows/{wf}/template/preview` | what sharing would remove (see below); writes nothing |
| `PUT /workspaces/{ws}/workflows/{wf}/template` body `{name, description?, authorName?, visibility}` | share or refresh; `201` first time, `200` when the workflow already has a template (same id and code) |

JSON shapes (camelCase, dates ISO-8601):

```json
// TemplateSummary (items of the list; no definition)
{ "id": "uuid", "name": "Hoa don", "description": "…" , "authorName": "Khai",
  "nodeTypes": ["trigger.gmail", "email.send"], "visibility": "PUBLIC",
  "usageCount": 3, "createdAt": "…", "updatedAt": "…", "owned": false }

// list page
{ "items": [TemplateSummary], "page": 0, "size": 20, "totalElements": 7 }

// TemplateDetail = TemplateSummary + definition and editorState; shareCode, workspaceId and
// sourceWorkflowId are present only when "owned" is true
{ …TemplateSummary, "definition": { "schemaVersion": "1.0", "nodes": [], "edges": [], "variables": {} },
  "editorState": { "nodes": { "<nodeId>": { "name": "…", "position": { "x": 0, "y": 0 } } } },
  "shareCode": "WV7K3M9Q" }

// preview
{ "definition": {…}, "editorState": {…},
  "removedFields": [ { "nodeId": "send_email", "field": "to" } ],
  "warnings": [ { "nodeId": "send_email", "field": "body", "reason": "EMAIL" } ],
  "existing": TemplateDetail | null }
```

`reason` is `EMAIL` (looks like an e-mail address) or `TOKEN` (24+ characters of letters, digits, `_`, `-`). Warnings are not removed: the owner must read the text and decide, so show them and ask for a confirmation before saving.

### C.3 Enter-code flow (what the app should do)

1. Input accepts the code as typed; send it unchanged to `GET /templates/by-code/{code}` (the server normalises it). Trim the field and keep the length under 32 characters.
2. Show name, author, description and the node list (`nodeTypes`). The number of connections the user must re-pick is the number of nodes in `definition.nodes` whose type needs a connection (email.send, telegram.send_message, google.*, trigger.gmail, trigger.telegram).
3. "Use template" calls `POST /templates/{id}/use` with the active workspace id, then opens the new workflow in the builder. The copy has no connections: the builder shows each connection field empty.
4. Errors: `404` "code not found" (do not reveal whether it exists but is private); `403` on use "you cannot create workflows in this workspace"; `429` too many attempts, wait a minute.

### C.4 Limits and errors

- At most 50 templates per user (`409` code `TEMPLATE_LIMIT_REACHED`); another member already sharing the same workflow gives `409` `TEMPLATE_OWNED_BY_OTHER`; sharing a workflow without steps is `400`.
- Name 1-255 characters, description up to 2000, author name up to 120; unknown JSON fields are rejected with `400`.
- Gateway rate limit `template`: 20 per minute per user for every change (share, patch, delete, use) and every code lookup (`GET /templates/by-code/*`); other reads use the general limit. A `429` carries `Retry-After`.
- Body rules: optional string fields (`description`, `authorName`, PATCH `name`/`visibility`, use `name`) may be `null`, meaning "absent" (a blank `description` string clears it); bodies are capped at 16 KB (`400` beyond); preview and share answer `400` code `TEMPLATE_NODE_NOT_SHAREABLE` when the workflow has a node of an unknown type.
- Deleted workspace: its PRIVATE templates disappear for everyone but the owner; UNLISTED and PUBLIC ones stay.

## D. Stop a run and run expressions (W6-C3)

### What it does
A user can stop a run that is queued, waiting or running, and mappings gain four run values. Both are additive: nothing existing changed shape.

### 1. Stop a run
`POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}/cancel` with the normal bearer token and no body. The caller needs the same permission as "run" (`WORKFLOW_RUN`).

| Status | Body | Meaning | What to show |
| --- | --- | --- | --- |
| 202 | `{ "status": "CANCELLED" }` | The run was still queued and ended at once | Run shows "Đã dừng" / "Stopped" |
| 202 | `{ "status": "CANCEL_REQUESTED" }` | The run is going; the step already running finishes, the rest never start | "Đang dừng…" / "Stopping…" until a poll returns `CANCELLED` |
| 403 | | No run permission | hide or disable the action |
| 404 | | Unknown run, or the run belongs to another workflow/workspace | treat as gone |
| 409 | `error.code = EXECUTION_ALREADY_FINISHED` | The run ended before the request | "Lượt chạy đã kết thúc, không thể dừng." then refresh |

- Show the action ("Dừng") only while the run status is `QUEUED`, `WAITING` or `RUNNING`, and ask for a confirm that says the current step finishes first.
- The final status is `CANCELLED` (already in the status enum). Its error is `{ "code": "CANCELLED_BY_USER" }`; unstarted steps are `CANCELLED`. Label it "Đã dừng" / "Stopped" (not "failed": a stopped run sends no failure notification and counts as neither success nor failure in monitoring).
- The list/detail responses do not say that a stop was requested; keep "Đang dừng…" in the screen state and rely on polling (2 s) for the final status. Repeating the request while a stop is pending is safe (`202 CANCEL_REQUESTED` again).

### 2. Run expressions
Config fields that accept `{{ ... }}` now also accept `{{ now }}` (UTC time, ISO 8601, taken when the step starts), `{{ run.id }}`, `{{ workflow.id }}`, `{{ workflow.name }}`. If the app has a variable picker, list them under a group "Lần chạy" / "This run". Existing expressions (`trigger.input.*`, `nodes.<id>.output.*`, `variables.*`) are unchanged, including steps or variables literally named `now`.

### 3. Workspace that no longer exists
Calls scoped to a workspace now answer `404` (error code `RESOURCE_NOT_FOUND`) instead of `403` when the caller is not a member of the workspace, or it is deleted or missing. `403` is only for a member who lacks the capability.

For the mobile app: workflow routes now answer 404 (not 403) for non-members; `ErrorState` may want to show its calm "no access" state for 404 on workflow screens too.

### 4. How to check
1. Start a long run (an http step against a slow URL), call cancel: `202 CANCEL_REQUESTED`, then the run ends `CANCELLED` after the current step; no "failed" notification arrives.
2. Cancel a finished run: `409 EXECUTION_ALREADY_FINISHED`.
3. A step with body `{{ run.id }} {{ now }}` shows the run id and a UTC timestamp in its output.

## E. Control bot nodes (W6-B)

### What it does
Three new workflow node types. Nothing existing changed shape; the only API-visible change is one new execution trigger value, `WORKFLOW_EVENT`, and one new connection provider, `DISCORD`.

### 1. `trigger.workflow_event` (starts a workflow when another one finishes)
- Config: `events` (required, non-empty list of `FAILED` / `SUCCEEDED`), `workflowIds` (optional list of workflow ids of the same workspace; empty means every other workflow).
- Runs of this trigger have `triggerType = "WORKFLOW_EVENT"` in the run list and detail (add it to the trigger-type label map; unknown values should fall back to the raw text). Registrations in the trigger list use `type = "WORKFLOW_EVENT"`.
- Trigger input (`trigger.input.*`): `workflowId`, `workflowName`, `executionId`, `status` (`FAILED` or `SUCCEEDED`), `errorCode`, `errorMessage` (null on success), `startedAt`, `finishedAt`, `durationMs`, and `runUrl` (only when the server has `WORKFLOW_WEB_BASE_URL`; it points at the web app, not a mobile deep link).
- Cancelled runs never fire it, a run started by this trigger never fires it again, and a workflow never fires itself.
- Publishing is rejected with `error.details` code `WORKFLOW_NOT_IN_WORKSPACE` when `workflowIds` names a workflow of another workspace.

### 2. `weav.workflow` (run, pause, resume or inspect workflows; answer chat commands)
- Config: `operation` (`run`, `pause`, `resume`, `status`, `list_failures`, `command`), `workflow` (id or exact name), `input` (object, `run` only), `limit` (1-20, default 5, `list_failures`), `text` (`command` only), `sender` (`command` only, template such as `{{ trigger.input.message.from.id }}`) and `allowedSenders` (`command` only, list of sender ids; at least one, required at publish).
- It acts as the user who published the workflow and needs that user's permission (`WORKFLOW_RUN`, `WORKFLOW_MANAGE_STATE`, `WORKFLOW_MONITOR`); a denied call fails the step with `FORBIDDEN`.
- A `command` whose `sender` is not in `allowedSenders` does nothing and answers `ok: false` with `reply` "Bạn không có quyền điều khiển quy trình."
- Runs started by a `weav.workflow` `run` step inside a workflow-event chain are marked, and the marked runs never fire `trigger.workflow_event` (this stops A-runs-B-runs-A loops). The marker is the run's idempotency key prefix `wfctl-chain-`; it is not shown in any API response.
- `command` never fails the step: the output has `ok` and `reply` (plain Vietnamese text, at most 1000 characters) to send back to the chat.

### 3. `discord.send_message`
Needs a `DISCORD` connection (auth type `TOKEN`, the secret is the channel webhook URL). Config: `connectionId`, `content` (at most 2000 characters), `username` (optional, at most 80). Mentions never ping.

### 4. How to check
1. Publish a workflow with `trigger.workflow_event` (`events: ["FAILED"]`), then make another workflow fail: the first one runs once, with `triggerType = WORKFLOW_EVENT` and the failed run's details as input.
2. Run a `weav.workflow` `command` step with text `/status <workflow name>`: the output `reply` describes the workflow.
