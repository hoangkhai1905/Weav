# Google Calendar and Drive nodes (Week 1, Lane 3)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-04 (Asia/Saigon) |
| Repository / branch | Weav / `feat/google-calendar-drive` (worktree `T:\Weav-wt\google`) |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Implemented and verified locally with fake Google transport; not committed; not yet checked against real Google |
| Scope | Workspace providers `GOOGLE_CALENDAR` and `GOOGLE_DRIVE`, nodes `google.calendar` and `google.drive`, contracts and gateway enum |
| Spec | `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md`, section 2, tier 3 |

## 2. Summary

- workspace-service connects two more Google OAuth providers through the existing flow: `GOOGLE_CALENDAR` (scopes `openid`, `email`, `calendar.events`) and `GOOGLE_DRIVE` (`openid`, `email`, `drive.file`). OAuth2 only.
- workflow-service has two new nodes. `google.calendar` creates an event. `google.drive` uploads a text file or lists files.
- Node configs are schema files (`packages/workflow-schema/nodes/google.calendar.json`, `google.drive.json`); `NodeCatalog` and `DefinitionValidator` pick them up unchanged.

## 3. Decisions

| Decision | Reason | Alternatives |
| --- | --- | --- |
| No database migration | `connection.provider` is `VARCHAR(32)` with no CHECK constraint (V1 migration; no later migration mentions providers). The enum is stored as STRING; the new names are at most 15 characters | Add a CHECK (not needed) |
| `ConnectionProvider.isGoogleOAuth()` replaces five copies of `== GMAIL \|\| == GOOGLE_SHEETS` | One place to extend for the next Google provider. Behavior for GMAIL and GOOGLE_SHEETS is unchanged | Extend each condition by hand |
| New `infrastructure/google` package: `GoogleApiClient` (fixed host, token check, status mapping), abstract `GoogleApiNodeExecutor` (config, connection, sanitize, report rejection), two small executors | Calendar and Drive share everything except config parsing and the request. Sheets and Gmail keep their own classes untouched | Copy the Sheets client and executor twice |
| `PinnedHttpTransport.executeGoogleApiWithBearerToken` plus `RawBody` record | Fixed host `www.googleapis.com` and path prefixes `/calendar/v3/calendars/`, `/drive/v3/files`, `/upload/drive/v3/files`; DNS stays approved and pinned. `RawBody` lets Drive send `multipart/related` instead of JSON. Existing methods unchanged | A second transport class |
| Drive upload content cap is 512 KiB (UTF-8 bytes), not 1 MiB | The outbound request cap is 1 MiB and the multipart envelope is added on top; a bigger cap would fail inside the transport instead of as `CONFIGURATION_ERROR` | Raise `WORKFLOW_HTTP_MAX_REQUEST_BYTES` |
| Status mapping: 401 `AUTHENTICATION_REJECTED` (also reported to Workspace, like Sheets); 403 `HTTP_BUSINESS_REJECTED` with a "reconnect and approve all access" message; 403 whose `error.errors[].reason` is `rateLimitExceeded`, `userRateLimitExceeded` or `quotaExceeded` is `HTTP_RATE_LIMITED` (retryable, since Google reports Calendar/Drive quota as 403); 404 `HTTP_BUSINESS_REJECTED`; 429 retryable; 408 and 5xx `HTTP_DEPENDENCY_UNAVAILABLE` retryable; timeouts come from the transport (retryable) | Treat every 403 as permanent (would not retry quota errors) |
| Calendar start and end accept an RFC 3339 date-time with offset, a local date-time plus `timeZone`, or an all-day date `YYYY-MM-DD`. Both ends must be the same kind and start must be before end. `timeZone` must be an IANA id | Matches what Google accepts; invalid input fails as `CONFIGURATION_ERROR` before any call or connection lookup | Offset-only |
| Calendar invitation emails are opt-in: boolean `sendInvitations` (default false). `sendUpdates=all` only when it is true and there are attendees, otherwise `sendUpdates=none` | A workflow must not email people by surprise | Always invite (first version, reverted after review) |
| Outbound allow-list is exact: POST `/calendar/v3/calendars/{id}/events` (one segment), GET `/drive/v3/files`, POST `/upload/drive/v3/files`; the method is part of the check. Paths with `..`, `/./`, `//`, `%2e`, `%5c`, or `%2f` outside the calendarId segment are rejected | A raw prefix check allowed sub-paths and traversal on the shared Google host | Prefix list (first version, reverted after review) |
| `withQuery` keeps the caller's raw path and only takes the query from `URIBuilder` | `URIBuilder` re-encodes the path; an id with `%2F` must reach Google as sent. Covered by a real-server test in `HttpTransportIntegrationTest` | Leave as is |
| `google.drive.operation` is no longer a template field | New node: the FE renders a plain select and publish checks the enum | Keep template |
| `NodeSideEffects`: `google.calendar` always side-effecting; `google.drive` side-effecting unless `operation` is the literal `list` (a mapping or missing value counts as side-effecting). Schema `x-weav-node.sideEffect` is `true` for both, which agrees with the parity test (it checks with an empty config) | Same rule as `google.sheets` read | |
| Per-operation required fields (`name` for upload) are checked at runtime, not in the schema | The schema subset has no conditionals; documented in the field descriptions, like `google.sheets.values` | |
| The AI generator is not widened on purpose, but `WorkflowGenerationService.capabilities()` lists every `NodeCatalog` type with `IntegrationReadiness.configured()`, so both new types are offered to the AI automatically | See risks | Filter in the generator (outside this lane) |

## 4. Changed files

| Type | Path | Note |
| --- | --- | --- |
| Add | `packages/workflow-schema/nodes/google.calendar.json`, `google.drive.json` | Node configs |
| Edit | `packages/contracts/http/workflow/definition.schema.json` | Two enum entries, two `allOf` blocks (re-serialized with the same 2-space layout) |
| Edit | `packages/contracts/http/workspace/openapi.yaml` | `ConnectionProvider` enum |
| Edit | `services/api-gateway/src/workspace/workspace.controller.ts`, `test/workspace.e2e-spec.ts` | zod enum; e2e provider list; the "unsupported provider" case now uses `GOOGLE_DOCS` |
| Edit | workspace-service: `ConnectionProvider`, `ConnectionProviderPolicy`, `GoogleOAuthScopePolicy`, `CredentialPayloadCodec`, `OAuthPendingState`, `ResolvedConnectionCredential`, `StartConnectionOAuthUseCase`, `CompleteConnectionOAuthUseCase`, `ResolveConnectionUseCase`, `GoogleConnectionProvider`, `WorkspaceApplicationConfig` | Providers, scopes, beans, registry |
| Edit | workspace-service tests: `GoogleOAuthScopePolicyTest`, `GoogleOAuthProviderTest`, `ConnectionAuthorizationPolicyTest`, `CredentialUseCasesTest`, `WorkspaceConnectionHttpIntegrationTest` | Scope policy (incl. `userinfo.email` alias), authorization URL scopes, provider policy, codec, registry fixture |
| Add | workflow-service `infrastructure/google/GoogleApiClient`, `GoogleApiNodeExecutor`, `GoogleCalendarNodeExecutor`, `GoogleDriveNodeExecutor` | Executors |
| Edit | `PinnedHttpTransport`, `WorkspaceClient` (`PROVIDERS`), `NodeSideEffects` | Transport entry point, provider allow-list, side-effect rule |
| Add / Edit | `GoogleApiNodeExecutorsTest` (new), `HttpTransportIntegrationTest` (raw path and `RawBody` test), `NodeConfigSchemasTest` (parity tables, `Map.of` became `Map.ofEntries`), `DefinitionValidatorTest` (type list) | |

## 5. Evidence

| Check | Command | Result |
| --- | --- | --- |
| GitNexus impact (index one merge behind) | `node T:\Weav\.gitnexus\run.cjs impact <symbol> --direction upstream --repo Weav` | `NodeSideEffects` LOW (4); `WorkspaceClient` LOW; `PinnedHttpTransport` MEDIUM (additive, no signature change); `GoogleOAuthScopePolicy`, `ConnectionProviderPolicy`, `CredentialPayloadCodec` MEDIUM; `GoogleConnectionProvider`, `StartConnectionOAuthUseCase`, `CompleteConnectionOAuthUseCase`, `ResolveConnectionUseCase` LOW; `ConnectionProvider`, `OAuthPendingState`, `ResolvedConnectionCredential`, `WorkspaceApplicationConfig` UNKNOWN, callers confirmed with `git grep` (all switches and sets extended; the exhaustive enum switch in `ConnectionAuthorizationPolicyTest` was the only compile break) |
| workspace-service | `./mvnw verify` (UTC, lock held) | 419 tests, 0 failures, 3 errors, all `WorkspaceNotificationRuntimeIntegrationTest` (needs a built `services/notification-service/dist`, environment-only) |
| workflow-service | `./mvnw verify` (UTC, lock held) | after review fixes: see the round 2 note below. Round 1: 519 tests, 0 failures, 3 errors, all known environment-only (`HttpTransportIntegrationTest` x2 TLS test certificate missing, `WorkflowNotificationLifecyclePersistenceIntegrationTest` needs a built notification-service `dist`). First run caught `DefinitionValidatorTest` hard-coding the 13 types; updated and renamed `exposesExactlyTheSupportedNodeTypes` |
| api-gateway | `pnpm --dir services/api-gateway test` / `run test:e2e` / `build`; read-only eslint on the two touched files | 107 unit pass; 82 e2e pass; build exit 0; eslint clean; prettier clean |
| Diff check | `git add -N .` then `git diff --check` | clean |

Not verified: real Google (see checklist), the web and mobile connection screens (the web `connection.api.ts` provider list and the connections page still show only the old four providers).

## 6. Risks

| Level | Risk | Handling |
| --- | --- | --- |
| Medium | A retryable 5xx or timeout on `google.calendar` or `google.drive` upload can create a duplicate event or file if Google processed the first request. The runner's side-effect handling covers interrupted attempts but not provider 5xx | Same behavior as `google.sheets` append. Add an idempotency key (`id` for events, a request id for uploads) if it shows up |
| Medium | `drive.file` only sees files Weav created or the user opened with Weav. `list` will not show other files | Description on the node says so; this is the narrow scope the spec chose |
| Medium | The AI generator can now propose both nodes (see decisions) | Needs a server-side filter in `WorkflowGenerationService.capabilities()`, owned outside this lane |
| Low | Existing Google connections do not gain the new scopes; users create separate Calendar and Drive connections | By design: one provider, one scope list |
| Low | `PinnedHttpTransport` is also edited by other lanes; the change is append-only | Resolve conflicts at merge by keeping both blocks |

## 7. Check against real Google (not done)

1. Consent screen for each provider shows exactly the expected scopes: Calendar = view and edit events (`calendar.events`) plus email and openid; Drive = files created or opened by this app (`drive.file`) plus email and openid. Nothing about Gmail or Sheets.
2. Create an event with a local time plus `timeZone` and with an offset time; check the time zone in Google Calendar. Add an attendee and confirm the invitation email arrives. Try an all-day event.
3. Upload a text file (with a non-ASCII name and content) and open it from the returned `webViewLink`. Try `folderId`.
4. `list` returns the uploaded file (only files Weav created or opened); try `nameContains` with an apostrophe in the name.
5. Revoke access in the Google Account security page, run again: the run fails with `AUTHENTICATION_REJECTED` and the connection shows as needing reconnect.
6. Wait for the access token to expire (about one hour) and run again to exercise the Workspace refresh-token path.

## 8. Next steps

1. Review, commit and merge into the week-1 branch.
2. Add `GOOGLE_CALENDAR` and `GOOGLE_DRIVE` to `apps/web/src/api/connection.api.ts`, the connections page and the node catalog (web owner).
3. Decide whether the AI generator should offer the two nodes.

## 9. Review round 2

Fixed: exact method-plus-path allow-list with traversal and `%2f` rules, `withQuery` raw path preservation (test sends a real request to a local server and asserts the raw path `/calendar/v3/calendars/a%2Fb%40x.test/events` plus `sendUpdates=none`), opt-in `sendInvitations`, `google.drive.operation` no longer a template field, and the `folderId` description and 404 message now mention the drive.file visibility limit.

Round 2 verify: workflow-service `./mvnw verify` 523 tests, 0 failures, 2 errors (the two known `HttpTransportIntegrationTest` TLS certificate errors; the notification bridge test passed this time). workspace-service was not touched in round 2.
