# W7-A1 Invite by Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace OWNER can invite an e-mail without a Weav account; the person signs up, verifies the address and accepts from `/invitations`.

**Architecture:** workspace-service owns `workspace_invitations` and the accept rule (verified e-mail from identity's directory must match). It records a v2 event `workspace.invitation.created`; notification-service turns it into an inbox row for the inviter plus one EMAIL delivery sent over SMTP (nodemailer). Gateway proxies; web adds the invite fallback, pending list, `/invitations` page and a dashboard banner.

**Tech Stack:** Spring Boot (workspace, identity), NestJS + Prisma + nodemailer (notification), NestJS (gateway), React + Vite + TanStack Query (web).

**Spec:** `docs/superpowers/specs/2026-10-10-w7-a1-invite-by-email-design.md` (read it first; this plan does not repeat its tables).

## Lanes

- **A1a backend** (`T:\Weav-wt\w7-a1a`, branch `feat/w7-a1a-invite-backend`): Tasks 1-7.
- **A1b web** (`T:\Weav-wt\w7-a1b`, branch `feat/w7-a1b-invite-web`): Tasks 8-9. Codes against the JSON shapes below; uses `page.route` stubs, so it does not wait for A1a.
- File ownership is disjoint: A1a never edits `apps/web`; A1b never edits `services/` or `packages/`.

## Global Constraints

- Additive only: `POST /workspaces/{id}/members` keeps returning `404 USER_NOT_FOUND` for unknown e-mails.
- Expiry 7 days; max 50 PENDING per workspace; resend once per 10 minutes; role on accept MEMBER with `AddMemberUseCase` defaults.
- No invite tokens. No e-mail address, e-mail body or SMTP credential in any log line (log ids and error codes only).
- Identity's OTP/password-reset mail is untouched.
- `NOTIFICATION_EMAIL_ENABLED` defaults to `false`; notification-service reuses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_AUTH_ENABLED`, `SMTP_STARTTLS_ENABLED`, `SMTP_STARTTLS_REQUIRED`, `SMTP_SSL_ENABLED`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`.
- Copy (vi/en) for the e-mail and inbox row is fixed in spec section 5.
- Maven: `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`. NestJS lint check without rewriting: `pnpm --dir <svc> exec eslint "{src,test}/**/*.ts"`.

## JSON shapes (shared by A1a and A1b)

```text
OwnerInvitation  = { id, workspaceId, email, status: "PENDING"|"EXPIRED"|"ACCEPTED"|"DECLINED"|"REVOKED",
                     invitedBy, createdAt, expiresAt, lastSentAt }          (ISO-8601 UTC strings)
POST   /api/v1/workspaces/{id}/invitations {email}      -> 201 OwnerInvitation
GET    /api/v1/workspaces/{id}/invitations              -> 200 { items: OwnerInvitation[] }
DELETE /api/v1/workspaces/{id}/invitations/{invId}      -> 204
POST   /api/v1/workspaces/{id}/invitations/{invId}/resend -> 200 OwnerInvitation
MyInvitation     = { id, workspaceId, workspaceName, invitedByName, expiresAt }
GET    /api/v1/invitations                              -> 200 { items: MyInvitation[], emailVerified: boolean }
POST   /api/v1/invitations/{invId}/accept               -> 200 { workspaceId }
POST   /api/v1/invitations/{invId}/decline              -> 204
Errors (existing ApiErrorResponse {code, message, requestId}):
  409 USER_EXISTS | USER_INACTIVE | INVITATION_EXISTS | INVITATION_NOT_PENDING | EMAIL_NOT_VERIFIED
  429 INVITATION_LIMIT | INVITATION_RESEND_TOO_SOON
  410 INVITATION_GONE
  404 INVITATION_NOT_FOUND (also for another e-mail's invitation)
```

## Review Focus

1. E-mail case/alias: `An@Example.com ` invited, user registers `an@example.com` -> accept works (both sides through `IdentityEmailNormalizer.canonicalize`). Test in Task 4.
2. Two owners invite the same e-mail at once -> exactly one PENDING row (partial unique index -> `409 INVITATION_EXISTS`, not 500). Test in Task 2.
3. Broker redelivers `workspace.invitation.created` -> one inbox row and one EMAIL delivery, no dead-letter. Test in Task 6.
4. Expired invitation re-invited -> old row becomes REVOKED, new PENDING row created, accept of the old id -> `410`. Tests in Tasks 3 and 4.
5. Workspace soft-deleted after inviting -> invitee list hides it, accept -> `410`. Test in Task 4.

---

### Task 1: identity exposes `emailVerified`; workspace reads it

**Files:**
- Modify: `services/identity-service/src/main/java/com/weav/identity/application/dto/UserDirectorySummary.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/IdentityUserSummary.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java`
- Test: identity `InternalDirectoryController` test (existing directory test class), workspace `IdentityDirectoryHttpClient` test.

**Interfaces:**
- Produces: `UserDirectorySummary(UUID userId, String email, String displayName, boolean active, boolean emailVerified)`; `IdentityUserSummary(UUID userId, String email, String displayName, boolean active, boolean emailVerified)`; JSON field `emailVerified` (missing -> `false`).

- [ ] Step 1: Failing tests: identity `/internal/directory/users/batch` and `/by-email` responses contain `"emailVerified": true` for a verified user and `false` otherwise; workspace client maps `emailVerified` and maps a response without the field to `false`.
- [ ] Step 2: Run both; expect FAIL.
- [ ] Step 3: Add the component (identity: the `User` e-mail-verified getter), update every constructor call (keep a 4-arg convenience constructor in `IdentityUserSummary` defaulting to `false` so existing tests compile).
- [ ] Step 4: `./mvnw verify` in both services; expect PASS (known env-only errors in CLAUDE.md excepted).

### Task 2: invitation persistence and domain

All paths under `services/workspace-service/src/main/java/com/weav/workspace/` unless absolute.

**Files:**
- Create: `services/workspace-service/src/main/resources/db/migration/V8__workspace_invitations.sql` (DDL exactly as spec section 3)
- Create: `domain/model/WorkspaceInvitation.java`, `domain/valueobject/InvitationStatus.java` (`PENDING, ACCEPTED, DECLINED, REVOKED`), `domain/port/out/WorkspaceInvitationRepository.java`
- Create: `infrastructure/persistence/entity/WorkspaceInvitationJpaEntity.java`, `infrastructure/persistence/repository/SpringDataWorkspaceInvitationRepository.java`, `WorkspaceInvitationRepositoryAdapter.java`
- Create: `domain/exception/GoneException.java` (410), `TooManyRequestsException.java` (429), and code-specific subclasses: `InvitationExistsException` (Conflict, `INVITATION_EXISTS`), `InvitationNotPendingException` (Conflict), `EmailNotVerifiedException` (Conflict), `UserExistsException` (Conflict), `InvitationLimitException` (429), `InvitationResendTooSoonException` (429), `InvitationGoneException` (410), `InvitationNotFoundException` (extends `ResourceNotFoundException`, code `INVITATION_NOT_FOUND`)
- Modify: `infrastructure/web/GlobalExceptionHandler.statusFor` (map `GoneException` -> 410, `TooManyRequestsException` -> 429)
- Test: repository adapter Testcontainers test; `GlobalExceptionHandler` test.

**Interfaces:**
- Produces: `WorkspaceInvitation` with `id, workspaceId, email, invitedBy, status, expiresAt, lastSentAt, respondedAt, respondedBy, createdAt, updatedAt`; methods `boolean isLive(Instant now)` (PENDING and `expiresAt > now`), `String viewStatus(Instant now)` (`EXPIRED` for PENDING past expiry), `void revoke(Instant now)`, `void accept(UUID userId, Instant now)`, `void decline(UUID userId, Instant now)`, `void resend(Instant now)` (sets `lastSentAt = now`, `expiresAt = now + 7d`), static `pending(UUID workspaceId, String canonicalEmail, UUID invitedBy, Instant now)`.
- Produces repository: `save`, `findById(UUID)`, `findPendingByWorkspaceAndEmail(UUID, String)`, `countPendingByWorkspace(UUID)`, `listPendingByWorkspace(UUID, int limit)` (newest first), `listPendingByEmail(String canonicalEmail)`.
- Constants in `WorkspaceInvitation`: `TTL = Duration.ofDays(7)`, `RESEND_COOLDOWN = Duration.ofMinutes(10)`, `MAX_PENDING_PER_WORKSPACE = 50`.

- [ ] Step 1: Failing tests: domain transitions (`isLive`, `viewStatus` EXPIRED, accept/decline/revoke only from PENDING); adapter round-trip; inserting a second PENDING row for the same (workspace, email) raises a `DataIntegrityViolationException` that the adapter translates to `InvitationExistsException` (Review Focus 2); handler returns 410/429.
- [ ] Step 2: Run; FAIL.
- [ ] Step 3: Implement following `Membership`/`MembershipJpaEntity`/`MembershipRepositoryAdapter` and `MembershipPersistenceExceptionTranslator` patterns.
- [ ] Step 4: `./mvnw verify`; PASS.

### Task 3: owner use cases + event + controller

**Files:**
- Create: `application/usecase/CreateInvitationUseCase.java`, `ListWorkspaceInvitationsUseCase.java`, `RevokeInvitationUseCase.java`, `ResendInvitationUseCase.java`, `application/dto/OwnerInvitationView.java`, `presentation/http/InvitationController.java` (`@RequestMapping("/workspaces/{workspaceId}/invitations")`), `presentation/http/request/CreateInvitationRequest.java` (`@NotBlank @Email @Size(max=320) String email`)
- Modify: `application/notification/WorkspaceNotificationRecorder.java` (+ `WorkspaceNotificationEvent` data record)
- Test: unit tests per use case; controller slice test.

**Interfaces:**
- Consumes: Task 2 domain/repository, Task 1 `IdentityUserSummary`.
- Produces: `OwnerInvitationView.from(WorkspaceInvitation, Instant now)` -> JSON `OwnerInvitation`; `WorkspaceNotificationRecorder.recordInvitationCreated(UUID workspaceId, UUID inviterUserId, String workspaceName, String inviteeEmail, String inviterName, Instant expiresAt)` -> event type `workspace.invitation.created`, recipients `[inviterUserId]`, entity WORKSPACE, data `{workspaceName, inviteeEmail, inviterName, expiresAt}`.

Flow for Create (mirror `AddMemberUseCase`): owner pre-check in a short transaction -> canonicalize -> `identityDirectory.findByEmail` (outside transaction): active -> `UserExistsException`, inactive -> `UserInactiveException` -> inviter display name via `getUsersByIds(List.of(actor))` -> transaction with `mutationLock.lock(workspaceId)`, owner re-check, existing PENDING: live -> `InvitationExistsException`, expired -> `revoke(now)`; count >= 50 -> `InvitationLimitException`; save; record event. Resend: live PENDING else `InvitationNotPendingException` (also for expired: owner must re-invite); `now - lastSentAt < 10m` -> `InvitationResendTooSoonException`; `resend(now)`; record event again. Revoke: PENDING (live or expired) -> REVOKED, else `InvitationNotPendingException`. Invitation of another workspace id -> `InvitationNotFoundException`.

- [ ] Step 1: Failing tests: non-owner -> 403 before any identity call (verify mock never called); active account -> `USER_EXISTS`; inactive -> `USER_INACTIVE`; live duplicate -> `INVITATION_EXISTS`; 50 pending -> `INVITATION_LIMIT`; expired re-invite revokes old row and creates new (Review Focus 4); resend at 9 min -> `INVITATION_RESEND_TOO_SOON`, at 11 min -> 200 with `expiresAt = now + 7d` and a second event; revoke twice -> second `INVITATION_NOT_PENDING`; event data fields exact.
- [ ] Step 2: Run; FAIL.
- [ ] Step 3: Implement; inject the existing `Clock` bean for `now`.
- [ ] Step 4: `./mvnw verify`; PASS.

### Task 4: invitee use cases + controller + integration test

**Files:**
- Create: `application/usecase/ListMyInvitationsUseCase.java`, `AcceptInvitationUseCase.java`, `DeclineInvitationUseCase.java`, `application/dto/MyInvitationView.java`, `presentation/http/MyInvitationController.java` (`@RequestMapping("/workspaces/invitations")`)
- Test: unit tests; Testcontainers integration test `WorkspaceInvitationIntegrationTest`.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: JSON `MyInvitation`, `{items, emailVerified}`, accept `{workspaceId}`.

Rules: caller looked up with `identityDirectory.getUsersByIds(List.of(callerId))`; canonical caller e-mail compared with the row; mismatch or unknown id -> `InvitationNotFoundException`; unverified -> list returns `{items: [], emailVerified: false}`, accept/decline -> `EmailNotVerifiedException`; not live or workspace deleted -> `InvitationGoneException`; accept when already a member -> mark ACCEPTED, return 200; otherwise inside `mutationLock.lock(workspaceId)` save `Membership.member(...)`, `notifications.recordMemberAdded(...)`, after-commit `authorizationCache.evict(...)` (same calls as `AddMemberUseCase`), mark ACCEPTED. `invitedByName` from one `getUsersByIds` batch for all inviters.

- [ ] Step 1: Failing tests: literal path `/workspaces/invitations` is not routed to `GET /workspaces/{workspaceId}`; e-mail case/whitespace match (Review Focus 1); other e-mail -> 404; unverified -> 409 `EMAIL_NOT_VERIFIED` and list flag false; expired / revoked (incl. the old id after a re-invite, Review Focus 4) -> 410; soft-deleted workspace hidden + 410 (Review Focus 5); accept twice -> 200 both, one membership; integration: accept creates membership, outbox has `workspace.member_added`, invitation ACCEPTED; decline -> DECLINED, 204.
- [ ] Step 2: Run; FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: `./mvnw verify`; PASS.

### Task 5: contracts

**Files:**
- Modify: `packages/contracts/http/workspace/openapi.yaml` (7 paths, schemas `OwnerInvitation`, `MyInvitation`, error codes above)
- Modify: `packages/contracts/events/notification/event-v2.schema.json` (+ `workspace.invitation.created` with data `{workspaceName (1-200), inviteeEmail (3-320), inviterName (1-200), expiresAt (date-time)}`); add `packages/contracts/events/notification/examples/workspace.invitation.created.json`
- Test: existing contract tests (find with `grep -rl event-v2.schema packages services --include=*.spec.ts --include=*.java`); they must pass with the new example.

- [ ] Step 1: Add the example first; run the contract tests; FAIL (unknown type).
- [ ] Step 2: Update schema + openapi; run; PASS.

### Task 6: notification-service EMAIL provider and invitation event

**Files:**
- Create: `services/notification-service/prisma/migrations/202610100001_email_provider/migration.sql` (`ALTER TYPE ... ADD VALUE 'EMAIL';` with the enum's DB name from the first migration)
- Modify: `prisma/schema.prisma` (enum), `src/domain/notification.ts` (`providerSchema` + `EMAIL`), `src/domain/notification-event.ts` (data schema for the new type; recipients must be exactly `[actorUserId]`), `src/domain/notification-catalog.ts` (inbox copy), `src/infrastructure/prisma.inbox.repository.ts` (`ingest`), `src/infrastructure/providers.ts` (`EmailProvider`), `src/config/settings.ts`, `src/app.module.ts`, `package.json` (`nodemailer`, `@types/nodemailer`), `test/runtime.integration.cjs` (v2 type list), compose files + `.env.example` (pass `SMTP_*` and `NOTIFICATION_EMAIL_ENABLED=false` to notification-service; identity's existing block stays)
- Test: `src/infrastructure/providers.spec.ts`, `src/domain/notification-catalog.spec.ts`, `src/domain/notification-event.spec.ts`, inbox repository test.

**Interfaces:**
- Consumes: event from Tasks 3/5.
- Produces: delivery row `{userId: inviter, provider: 'EMAIL', destination: data.inviteeEmail, sourceEventId: eventId, eventType: 'workspace.invitation.created', executionId: null, inboxId: <inviter's inbox row id>, payload: {workspaceName, inviterName, expiresAt}, status: 'PENDING'}`; `EmailProvider implements NotificationProvider`; exported pure `renderInvitationEmail(payload, baseUrl): {subject: string, text: string}`.

`ingest` change: after `createMany` of inbox rows, when `eventType === 'workspace.invitation.created'` create the delivery with `skipDuplicates` on `(sourceEventId, userId, provider, destination)`. In the existing "stored deliveries" branch, an invitation event whose stored deliveries all have this event type is a replay: return without error (today any non-execution delivery throws `InboxPersistenceConflictError`). `EmailProvider.send`: `PROVIDER_DISABLED` (permanent) when disabled; destination must match `/^[^\s@]{1,64}@[^\s@]{1,255}$/` and be <= 320 chars else `INVALID_DESTINATION`; nodemailer transport built once from settings (`secure: SMTP_SSL_ENABLED`, `requireTLS: SMTP_STARTTLS_REQUIRED`, `ignoreTLS: !SMTP_STARTTLS_ENABLED`, `auth` only when `SMTP_AUTH_ENABLED`, connection/greeting/socket timeouts `NOTIFICATION_TIMEOUT_MS`); error with `responseCode` 4xx or no code (network) -> retryable `SMTP_<code|UNAVAILABLE>`, 5xx -> permanent. Settings: SMTP fields required only when `NOTIFICATION_EMAIL_ENABLED=true`.

- [ ] Step 1: Failing tests: event schema accepts the example and rejects recipients other than the actor; catalog renders vi/en inbox copy with the e-mail; `renderInvitationEmail` contains inviter, workspace, `<base>/invitations`, expiry date, both languages; provider: disabled -> permanent, bad destination -> permanent, fake transport 450 -> retryable, 550 -> permanent, success -> `{kind: 'sent'}`, logger never receives the destination; ingest twice with the same event -> one inbox row + one EMAIL delivery, no throw (Review Focus 3).
- [ ] Step 2: Run `pnpm --dir services/notification-service test`; FAIL.
- [ ] Step 3: Implement; `pnpm --dir services/notification-service exec prisma generate`.
- [ ] Step 4: `pnpm --dir services/notification-service test`, `test:e2e`, `build`, eslint check; PASS.

### Task 7: gateway routes

**Files:**
- Modify: `services/api-gateway/src/workspace/workspace.controller.ts` (4 owner routes under `api/v1/workspaces/:workspaceId/invitations`)
- Create: invitee controller `@Controller('api/v1/invitations')` in `src/workspace/` forwarding to proxy paths `/invitations`, `/invitations/{id}/accept`, `/invitations/{id}/decline` (the proxy prefixes `/workspaces`); register in `workspace.module.ts`
- Modify: `src/rate-limit/gateway-throttler.guard.ts`: `isInvitationRequest` (POST create and POST resend) in its own bucket, following `isTemplateRequest`
- Test: `test/workspace.e2e-spec.ts`, `test/routes.e2e-spec.ts`, throttler unit test.

- [ ] Step 1: Failing e2e: each of the 7 routes forwards method, path and body to the stubbed workspace upstream and relays status/body (incl. 410/429); UUID path params validated like the members routes; create/resend throttled in their own bucket.
- [ ] Step 2: Run `pnpm --dir services/api-gateway test:e2e`; FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: `test`, `test:e2e`, `build`, eslint check; PASS.

### Task 8 (A1b): owner UI on the Members tab

**Files:**
- Modify: `apps/web/src/api/workspace.api.ts` (`createInvitation(workspaceId, {email})`, `listInvitations(workspaceId)`, `revokeInvitation(workspaceId, invId)`, `resendInvitation(workspaceId, invId)`; type `OwnerInvitation`), `apps/web/src/hooks/useWorkspace.ts` (query key `workspaceKeys.invitations(userId, workspaceId)`), `apps/web/src/pages/WorkspacePage.tsx`, `apps/web/src/lib/i18n/translations.ts`
- Test: new `apps/web/e2e/workspace-invitations.spec.ts` (copy the `page.route` setup of `workspace-connections.spec.ts`)

Behaviour: add-member error `USER_NOT_FOUND` -> inline prompt (spec section 7 copy) with "Gửi lời mời" -> create; map `INVITATION_EXISTS`, `INVITATION_LIMIT`, `USER_EXISTS`, `INVITATION_RESEND_TOO_SOON` to translated messages; owner-only "Lời mời đang chờ" list (e-mail, expiry, Expired badge, Resend, Revoke with confirm); invalidate the list after each mutation.

- [ ] Step 1: Failing Playwright: unknown e-mail -> prompt -> invite -> row appears; resend too soon -> message; revoke -> row gone; non-owner sees no list.
- [ ] Step 2: Run `VITE_API_MODE=http pnpm --dir apps/web exec playwright test e2e/workspace-invitations.spec.ts --project=chromium`; FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run it again plus `tsc --noEmit -p tsconfig.app.json`, `build`, `lint`; PASS.

### Task 9 (A1b): `/invitations` page and dashboard banner

**Files:**
- Create: `apps/web/src/pages/InvitationsPage.tsx`
- Modify: `apps/web/src/App.tsx` (route `/invitations` inside `AppLayout`), `apps/web/src/api/workspace.api.ts` (`listMyInvitations()`, `acceptInvitation(id)`, `declineInvitation(id)`; type `MyInvitation`), `apps/web/src/pages/DashboardPage.tsx` (banner when items > 0, link to `/invitations`), `translations.ts`
- Test: extend `apps/web/e2e/workspace-invitations.spec.ts`

Behaviour: list cards (workspace name, inviter, expiry) with Accept/Decline; accept -> invalidate workspace list, switch active workspace to the returned `workspaceId`, navigate `/workspace`; `emailVerified: false` -> notice linking `/settings/profile` (existing e-mail verification); `410` -> "Lời mời đã hết hạn hoặc bị thu hồi" and refetch.

- [ ] Step 1: Failing Playwright: banner shows count; accept switches workspace; decline removes card; unverified notice; 410 message.
- [ ] Step 2: Run; FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run spec + tsc + build + lint; PASS; console and network clean in the run.

## After the lanes (coordinator)

Merge A1a then A1b into `week6` (`--no-ff`); `detect_changes` on the clean main checkout per lane; live check on Neon `dev-k` after the second-stack check (V8 + Prisma migration apply on start; `NOTIFICATION_EMAIL_ENABLED=true` with the Resend SMTP values already in `.env`): K invites a new `+alias`, receives the e-mail, signs up, verifies, accepts. Work log: `docs/work_logs/K/workspace/invite-by-email.md`. Mobile handoff note in `docs/handoff/`.
