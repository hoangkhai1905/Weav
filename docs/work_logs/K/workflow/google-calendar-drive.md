# Google Calendar and Drive nodes (Week 1, Lane 3)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon); live test 2026-10-05 |
| Branch | `feat/google-calendar-drive`, merged into `feat/week1-nodes` (fc2f34d), then `staging` (bab11b8) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, committed and merged into `staging`; live test against real Google passed (section 7) |
| Scope | Workspace providers `GOOGLE_CALENDAR` and `GOOGLE_DRIVE`, nodes `google.calendar` and `google.drive`, contracts and gateway enum |
| Spec | `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md`, section 2, tier 3 |

## 2. Summary

- workspace-service connects two more Google OAuth providers through the existing flow: `GOOGLE_CALENDAR` (scopes `openid`, `email`, `calendar.events`) and `GOOGLE_DRIVE` (`openid`, `email`, `drive.file`). OAuth2 only.
- workflow-service nodes: `google.calendar` creates an event; `google.drive` uploads a text file or lists files. Configs are schema files (`google.calendar.json`, `google.drive.json`); `NodeCatalog` and `DefinitionValidator` pick them up unchanged.
- Review: 2 rounds; exact method-plus-path allow-list, raw path preservation in `withQuery`, opt-in invitations, `google.drive.operation` no longer a template field, drive.file visibility note on `folderId`.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| No database migration | `connection.provider` is `VARCHAR(32)` with no CHECK; new names are at most 15 chars |
| `ConnectionProvider.isGoogleOAuth()` replaces five copies of `== GMAIL \|\| == GOOGLE_SHEETS` | One place to extend; GMAIL and GOOGLE_SHEETS behaviour unchanged |
| New `infrastructure/google` package: `GoogleApiClient` (fixed host, token check, status mapping), abstract `GoogleApiNodeExecutor`, two small executors. Sheets and Gmail keep their own classes | Calendar and Drive share everything except config parsing and the request |
| `PinnedHttpTransport.executeGoogleApiWithBearerToken` plus `RawBody` record: fixed host `www.googleapis.com`, DNS approved and pinned; `RawBody` lets Drive send `multipart/related`. Existing methods unchanged | No second transport class |
| Outbound allow-list is exact, method included: POST `/calendar/v3/calendars/{id}/events` (one segment), GET `/drive/v3/files`, POST `/upload/drive/v3/files`. Paths with `..`, `/./`, `//`, `%2e`, `%5c`, or `%2f` outside the calendarId segment are rejected | A raw prefix check allowed sub-paths and traversal on the shared Google host |
| `withQuery` keeps the caller's raw path and takes only the query from `URIBuilder` | `URIBuilder` re-encodes the path; an id with `%2F` must reach Google as sent (real-server test in `HttpTransportIntegrationTest`) |
| Drive upload content cap is 512 KiB (UTF-8 bytes) | The outbound request cap is 1 MiB and the multipart envelope is added on top; a bigger cap would fail in the transport instead of as `CONFIGURATION_ERROR` |
| Status mapping: 401 `AUTHENTICATION_REJECTED` (also reported to Workspace); 403 `HTTP_BUSINESS_REJECTED` with a "reconnect and approve all access" message; 403 with `rateLimitExceeded` / `userRateLimitExceeded` / `quotaExceeded` is `HTTP_RATE_LIMITED` (retryable); 404 `HTTP_BUSINESS_REJECTED`; 429 retryable; 408 and 5xx `HTTP_DEPENDENCY_UNAVAILABLE` retryable; timeouts retryable | Google reports Calendar/Drive quota as 403 |
| Calendar start/end accept an RFC 3339 date-time with offset, a local date-time plus IANA `timeZone`, or an all-day `YYYY-MM-DD`; both ends the same kind, start before end. Invalid input fails as `CONFIGURATION_ERROR` before any call | Matches what Google accepts |
| Calendar invitations are opt-in: boolean `sendInvitations` (default false); `sendUpdates=all` only when true and there are attendees, else `none` | A workflow must not email people by surprise |
| `google.drive.operation` is not a template field | The FE renders a plain select and publish checks the enum |
| `NodeSideEffects`: `google.calendar` always side-effecting; `google.drive` side-effecting unless `operation` is the literal `list`. Schema `x-weav-node.sideEffect` is `true` for both (parity test uses an empty config) | Same rule as `google.sheets` read |
| Per-operation required fields (`name` for upload) are checked at runtime, not in the schema | The schema subset has no conditionals |

## 4. Changed files

| Area | Files |
| --- | --- |
| Schemas and contracts | `google.calendar.json`, `google.drive.json`; `definition.schema.json` (two enum entries, two `allOf` blocks); workspace `openapi.yaml` `ConnectionProvider` enum |
| api-gateway | `workspace.controller.ts` zod enum, `test/workspace.e2e-spec.ts` ("unsupported provider" case now `GOOGLE_DOCS`) |
| workspace-service | `ConnectionProvider`, `ConnectionProviderPolicy`, `GoogleOAuthScopePolicy`, `CredentialPayloadCodec`, `OAuthPendingState`, `ResolvedConnectionCredential`, Start/Complete/Resolve use cases, `GoogleConnectionProvider`, `WorkspaceApplicationConfig`, plus matching tests |
| workflow-service | new `GoogleApiClient`, `GoogleApiNodeExecutor`, `GoogleCalendarNodeExecutor`, `GoogleDriveNodeExecutor`; edited `PinnedHttpTransport`, `WorkspaceClient` (`PROVIDERS`), `NodeSideEffects`; tests `GoogleApiNodeExecutorsTest`, `HttpTransportIntegrationTest`, `NodeConfigSchemasTest`, `DefinitionValidatorTest` |

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| workspace-service | `./mvnw verify` (UTC) | 419 tests, 0 failures, 3 errors all `WorkspaceNotificationRuntimeIntegrationTest` (needs notification-service `dist`, environment-only) |
| workflow-service | `./mvnw verify` (UTC), after review round 2 | 523 tests, 0 failures, 2 errors (the known `HttpTransportIntegrationTest` TLS certificate errors) |
| api-gateway | `test` / `test:e2e` / `build`; eslint and prettier on touched files | 107 unit, 82 e2e pass; build 0; lint clean |
| Diff check | `git add -N .` then `git diff --check` | clean |
| GitNexus impact | upstream, index one merge behind | `PinnedHttpTransport`, `GoogleOAuthScopePolicy`, `ConnectionProviderPolicy`, `CredentialPayloadCodec` MEDIUM (additive, no signature change); others LOW or UNKNOWN, confirmed with `git grep` |

## 6. Risks and next steps

| Level | Item | Handling |
| --- | --- | --- |
| Medium | A retryable 5xx or timeout on `google.calendar` or a Drive upload can create a duplicate event or file if Google processed the first request (same as `google.sheets` append) | Add an idempotency key (`id` for events, a request id for uploads) if it shows up |
| Medium | `drive.file` only sees files Weav created or the user opened with Weav; `list` will not show others | Stated in the node description; the narrow scope the spec chose |
| Medium | `WorkflowGenerationService.capabilities()` lists every catalog type, so the AI generator is offered both nodes | Needs a server-side filter there (outside this lane) |
| Low | Existing Google connections do not gain the new scopes; users create separate Calendar and Drive connections | By design: one provider, one scope list |
| Low | `PinnedHttpTransport` is also edited by other lanes (append-only) | Keep both blocks on conflict |

Next (open): add `GOOGLE_CALENDAR` and `GOOGLE_DRIVE` to `apps/web/src/api/connection.api.ts`, the connections page and the node catalog (web owner; the web provider list still shows only the old four); decide whether the AI generator should offer the two nodes.

## 7. Live test (2026-10-05): done

- Run `scripts/live-test-nodes.ps1 -Flow google` (see `scripts/README.md`). Real Google: GOOGLE_CALENDAR and GOOGLE_DRIVE OAuth hand-off completed (redirect URL pasted, web app not running); the Calendar, Drive upload, Drive list workflow succeeded. K reported all steps passed.
- Not recorded as checked (original manual checklist; the script may not cover them): consent screen scopes, attendee invitation email, all-day events, `folderId`, `nameContains` with an apostrophe, access revocation (expect `AUTHENTICATION_REJECTED` and reconnect), access-token expiry refresh (about 1 h).
- Left behind: the "Weav live test" calendar event and `weav-live-test-<timestamp>.txt` in K's Google account; the test workspace and connections listed in `telegram-nodes.md` section 9.
