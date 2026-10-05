# Gmail trigger (Week 2, Lane C)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-05 (Asia/Saigon) |
| Repository / branch | Weav / `feat/gmail-trigger` (worktree `T:\Weav-wt\gmail`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented; tests listed in section 6; not committed; not checked against real Gmail |
| Scope | `trigger.gmail` (polling), `gmail.readonly` scope, reconnect surfacing, V11 migration |

## 2. Summary

- New node `trigger.gmail` (`connectionId`, optional `query`, optional `pollIntervalMinutes` default 5). Each new email starts one run. Run input: `messageId, threadId, from, to, cc, subject, date, snippet, body, bodyTruncated, labelIds`.
- Gmail connections now ask for `openid email gmail.readonly gmail.send`. `gmail.metadata` is dropped (Gmail rejects `format=full` and `q=` when a token carries it, even with readonly).
- A stored Google grant that lacks a required scope (every Gmail connection made before this change) now fails with a stable, non-retryable code telling the user to reconnect.

## 3. Google Cloud Console (exact scopes)

OAuth consent screen -> Data access (Scopes) must list for the Weav OAuth client:

- keep: `openid`, `.../auth/userinfo.email` (`email`), `https://www.googleapis.com/auth/gmail.send`, `spreadsheets`, `calendar.events`, `drive.file` (unchanged)
- ADD: `https://www.googleapis.com/auth/gmail.readonly` (restricted scope; fine for the demo because only listed Test users sign in)
- REMOVE after merge (optional): `https://www.googleapis.com/auth/gmail.metadata`
- Enable the Gmail API for the project (already on for `email.send`).
- App in Testing mode: refresh tokens expire after 7 days, so a Gmail connection stops working weekly and must be reconnected (it then shows the reconnect code below). Test users must be listed.

## 4. Decisions

| Decision | Reason |
| --- | --- |
| `gmail.metadata` removed, not kept next to readonly | Gmail refuses message reads and `q=` for a token that includes metadata |
| `include_granted_scopes` is NOT sent for Gmail (still sent for Sheets/Calendar/Drive) | Incremental auth would merge an earlier `gmail.metadata` grant of the same Google account into the reconnect token and break reads. Fallback if a reconnect token still carries metadata: remove Weav at myaccount.google.com/permissions, reconnect |
| Idempotency key is `gmail:<triggerId>:<messageId>`, not `gmail:<messageId>` | The unique index is `(workflow_id, idempotency_key)`, per workflow, not per trigger. Including the trigger id keeps two Gmail triggers of one workflow, and a republished trigger, independent. A reused key with changed input (labels change between polls) is treated as "already admitted" |
| `poll_cursor TIMESTAMPTZ` on `workflow_triggers` (V11) | Same type as `next_run_at`; holds the newest Gmail `internalDate` admitted (ms precision fits). No CHECK on trigger type/status exists, so nothing else to extend |
| Separate `GmailTriggerPort` (implemented by `WorkflowTriggerAdapter`) instead of new methods on `WorkflowTriggerPort` | Test fakes (and other lanes) implement `WorkflowTriggerPort`; adding abstract methods would break them |
| Gmail scan is a second `@Scheduled` method `scanGmail()` in `WorkflowScheduleScanner` (same bean, same tick period) | Reuses the scanner, but a slow Gmail call cannot delay schedule slots (fixedDelay is per method). Switch: `weav.workflow.gmail.poller.enabled` (default true), `weav.workflow.gmail.poller.batch-size` (default 10). No `.env` change needed |
| Poll flow: claim tx (lock workflow, lock trigger, same order as schedules; verify; push `next_run_at` by interval) -> resolve + Gmail outside any transaction -> one admission tx per email (oldest first) -> short cursor tx | No lock or transaction during HTTP. Failures keep the cadence because `next_run_at` already moved |
| Pause clears `next_run_at`; resume sets cursor and `next_run_at` to now | Like schedules, mail received while paused is not replayed. Publish sets cursor = publish time, first poll due at once |
| Each poll reads the newest 100 matches (`messages.list`, paged) and admits the OLDEST 10 of them, oldest first (superseded by review round 1; `ponytail:` comment in `GmailTriggerProcessor`) | Cursor never jumps over unread mail; the next poll continues. Upgrade path: `users.history.list` with a stored `historyId` |
| Transport: new `executeGmailGetWithBearerToken` on host `gmail.googleapis.com` (the host `email.send` uses), exact paths `/gmail/v1/users/me/messages` and `/messages/{hex id up to 32}`, no query in the URI | Anything else (send, trash, nested, encoded, dot segments) is rejected. Existing methods unchanged |
| A message that vanished or is unreadable (4xx other than 401/403, too large) is skipped; 401/403/429/5xx stop the poll | One poison email must not block the mailbox |
| HTML-only mail: tags stripped by regex, entities decoded, `<script>/<style>` dropped (`ponytail:` note) | Plain-text input only; never rendered |
| RFC 2047 subjects/addresses are decoded | Vietnamese subjects arrive as encoded words |
| Workflow lastError codes shown to the UI (`reasonCode`, additive enum): `CONNECTION_RECONNECT_REQUIRED`, `AUTHENTICATION_REJECTED`, `CONNECTION_FORBIDDEN`, `CONNECTION_UNAVAILABLE`, `GMAIL_POLL_FAILED` | Rate limits/outages collapse to `GMAIL_POLL_FAILED` |

## 5. Reconnect experience (traced)

Before this change: Workspace `ResolveConnectionUseCase` threw `InvalidStateException` -> HTTP 422 `{code:"INVALID_STATE", message:"Google connection authorization is invalid"}`. workflow-service `WorkspaceClient.resolve` treated every non-200 other than 403/404 as `WorkspaceDependencyUnavailableException`, so `email.send` failed `CONNECTION_UNAVAILABLE`, retryable (retried for nothing). The connection status stayed ACTIVE (only a confirmed provider rejection marks INVALID).

Now:

- Workspace: new `ConnectionReconnectRequiredException` (subclass of `InvalidStateException`, still 422) with body code `CONNECTION_RECONNECT_REQUIRED` for: stored scopes missing a required one, refresh rejected, refresh no longer grants required scopes, and status INVALID. A DISABLED connection keeps `INVALID_STATE`. Connection status does not change by the scope check itself.
- workflow-service: `WorkspaceClient` maps 422 + that code to `ConnectionReconnectRequiredException`. `email.send`, `google.sheets`, `google.calendar`, `google.drive` fail `CONNECTION_RECONNECT_REQUIRED`, non-retryable: "The Gmail connection must be reconnected: open Connections and reconnect it." The Gmail poller records `CONNECTION_RECONNECT_REQUIRED` as the trigger `lastError` (visible as `reasonCode` on the workflow trigger list) and tries again next interval.
- How the user reconnects: Connections page -> the Gmail connection -> reconnect (API: `POST /workspaces/{id}/connections/{connectionId}/oauth/authorize`, then the Google consent, then the callback/`oauth/complete`). The existing OAuth completion replaces the stored credential including `grantedScopes` and marks the connection ACTIVE; the connection id is unchanged, so workflows keep working with no edit. Google shows the new "read your email" consent (restricted scope; "unverified app" warning for Test users).

## 6. Changed files (summary)

- workspace-service: `GoogleOAuthScopePolicy`, `GoogleOAuthProvider` (no incremental grants for Gmail), `ResolveConnectionUseCase`, `InvalidStateException` (protected ctor), new `ConnectionReconnectRequiredException`; tests updated (`gmail.metadata` -> `gmail.readonly`) and new reconnect tests; README, spec doc, contracts README and openapi (additive description).
- workflow-service: `TriggerType/ExecutionTriggerType.GMAIL`, `WorkflowTrigger.pollCursor`, JPA entity and mapper, `WorkflowTriggerAdapter` (due query, claim write, cursor/error write, pause/resume), `WorkflowPublicationService` (register GMAIL), `GmailTriggerProcessor/Service`, `GmailMailboxPort`, `GmailTriggerPort`, `GmailMailbox`, `GmailMessageParser`, `GmailClient` list/get, `PinnedHttpTransport`, `WorkspaceClient`, three Google executors, `WorkflowResponse` code allow-list, `WorkflowScheduleScanner`, `application.properties`, `V11__gmail_trigger_poll_cursor.sql`.
- packages: `workflow-schema/nodes/trigger.gmail.json`, `definition.schema.json` (type + block, appended), workflow `openapi.yaml` enums (trigger/execution type, reasonCode).
- Tests: `GmailMessageParserTest`, `GmailMailboxTest`, `GmailTriggerProcessorTest`, `GmailTriggerIntegrationTest` (Testcontainers: migration, publish/pause/resume/republish, overlapping polls, cursor), `GmailReadAllowListTest`, real-server case in `HttpTransportIntegrationTest`, `WorkspaceClientTest`, `GmailNodeExecutorTest`, `NodeConfigSchemasTest`, `DefinitionValidatorTest`, `UnavailableNodeExecutorTest`.

## 7. Evidence

- `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` in `services/workspace-service`: 421 tests, 0 failures, BUILD SUCCESS.
- Same in `services/workflow-service`: 622 tests (after review round 1; workspace-service re-run 421), 0 failures, BUILD SUCCESS (includes Testcontainers `GmailTriggerIntegrationTest`).
- Schema loader gained `maxLength`, `maximum` and `default` keywords (needed by the node file); `DefinitionJsonCodecTest` keeps the draft schema consistent.

## 7b. Review round 1 (Java reviewer)

Changes: (1) `GmailMessageParser.stripHtml` is now one linear character scanner (no regex), input cut to 256 KiB; test with 500k `<`, 50k unclosed `<script`, 100k unclosed tags and 200k spaces under a 2 s preemptive timeout. (2) A message over the 1 MiB response cap is read again with `format=metadata` and admitted with `body: ""` and `bodyOmitted: true`; other permanent per-message failures are logged (`event=gmail_message_skipped reason=<code> messageId=<id>`) and recorded as trigger `reasonCode` `GMAIL_MESSAGE_SKIPPED`. (3) Newest 100 ids (nextPageToken followed, at most 5 pages) -> oldest 10 admitted; more than 100 matches records `GMAIL_BACKLOG_TRUNCATED`; 25 mails over 3 polls admit all 25 once, in order. (4) `after:` uses cursor second minus 1 and mail older than the cursor is dropped (equal timestamp is kept, deduped by the idempotency key). (5) Gmail 403 is split: `rateLimitExceeded`/`userRateLimitExceeded`/`quotaExceeded` -> `HTTP_RATE_LIMITED` retryable (also on `email.send`, where nothing was sent so retry is safe); `insufficientPermissions` or `PERMISSION_DENIED` -> `CONNECTION_RECONNECT_REQUIRED`; any other 403 -> `HTTP_BUSINESS_REJECTED`. (6) Each admission runs in its own transaction that re-locks workflow then trigger and re-reads `poll_cursor` and ACTIVE status, so a pause/resume while Gmail was being read skips older mail or stops the poll. (7) `maxLength` counts code points; schema README lists `maximum`, `maxLength` and `default` (informational, not applied by the backend).

Trigger input (all keys always present, so mappings like `{{ trigger.input.bodyOmitted }}` never miss):

| Key | Value |
| --- | --- |
| messageId, threadId | Gmail ids |
| from, to, cc, subject | decoded header text, empty string when absent, each at most 2000 chars |
| date | internalDate as ISO-8601 UTC |
| snippet | Gmail snippet |
| body | text/plain part, else tag-stripped text/html; at most 32 KiB UTF-8 |
| bodyTruncated | true when the body was cut at 32 KiB |
| bodyOmitted | true when the message was too large to read in full and only headers and snippet were read; false otherwise |
| labelIds | list of label ids |

Rollout note: every existing GMAIL connection (granted `gmail.metadata` + `gmail.send`) returns `CONNECTION_RECONNECT_REQUIRED` from Workspace resolve until it is reconnected, including for `email.send` nodes that worked before. Connection test endpoint: it first checks the stored scopes against the policy (so an old connection reports auth invalid, i.e. reconnect), then calls `users/me/profile` (`GoogleOAuthProvider.verifyGmail`). The profile call never needed `gmail.metadata` specifically (profile accepts readonly), so it keeps working under `gmail.readonly`.

## 8. Risks and notes

- The web app (`apps/web/src/api/workflow-v1.api.ts` `triggerType` union) and api-gateway enum lists do not know `GMAIL` yet; not edited (apps/ and gateway out of lane). The node editor reads node schemas, so `trigger.gmail` appears automatically if the catalog is served from the schema package.
- `email.send` can be triggered by its own sent mail if a workflow sends to the watched mailbox: use `query` like `in:inbox` (live test uses it).
- Up to 10 emails admitted per poll (oldest of the newest 100); very large mails are admitted with bodyOmitted.
- V11 may collide with another lane's migration number; renumber on merge.
- Real Gmail never exercised here; confirm in the live test.

## 9. Live test (for `scripts/live-test-nodes.ps1`)

1. Console: add `gmail.readonly` to the consent screen scopes, Gmail API enabled, your account is a Test user.
2. Create (or reconnect, if it predates this change) the Gmail connection: `POST /workspaces/{ws}/connections/{id}/oauth/authorize`, open the returned URL, approve send + read. Existing connection: before reconnecting, run an `email.send` node and expect `CONNECTION_RECONNECT_REQUIRED`.
3. Create a workflow: `trigger.manual` plus `trigger.gmail` `{connectionId, query:"in:inbox subject:weav-live", pollIntervalMinutes:1}`, optional `telegram.send_message` after the Gmail trigger using `{{ trigger.input.subject }}`. Publish.
4. Check `GET workflows/{id}` trigger list: GMAIL, ACTIVE, `reasonCode` null.
5. Send yourself (or from another account) an email with subject `weav-live test`. Within about 1 minute expect exactly one execution with `triggerType` GMAIL and input `{messageId, threadId, from, to, cc, subject:"weav-live test", date (ISO UTC), snippet, body (plain text), bodyTruncated:false, labelIds:[...]}`. Wait one more interval: still one execution.
6. Pause the workflow: trigger DISABLED; send another mail; no run. Resume: still no run for that mail (not replayed), a new mail does start one.
7. Cleanup: pause the workflow.
