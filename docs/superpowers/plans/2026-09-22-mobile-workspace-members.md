# Batch 10 — Mobile Workspace member management

## Scope

Nối mobile Workspace member add, permission update, remove và leave vào các public Gateway APIs hiện có. Reuse `WorkspaceRepository`, `useWorkspace`, `useWorkspaceStore` và query keys hiện tại; không thêm invitation/search, backend/Web/auth changes, member mutations khác, Workflow/AI/Bot.

## Contract decisions

- Add dùng `{ email }` của active Identity user hiện có: `POST /api/v1/workspaces/{workspaceId}/members`.
- Permissions dùng `PATCH /api/v1/workspaces/{workspaceId}/members/{userId}/permissions` với cả `canPublishWorkflow` và `canManageWorkflowState`.
- Remove dùng `DELETE /api/v1/workspaces/{workspaceId}/members/{userId}`; leave dùng `DELETE /api/v1/workspaces/{workspaceId}/members/me`.
- Add/update trả `MemberView`; remove/leave trả 204. HTTP mode không fallback mock/localStorage.
- Owner/self restrictions là backend authority; UI chỉ disable rõ khi loaded member role chứng minh owner restriction.

## Files and bounded changes

- `apps/mobile/src/domain/workspace/workspace.types.ts`: request types and repository methods.
- `apps/mobile/src/infrastructure/http/workspace.http.contract.ts`: route/body builders and `MemberView` mapping/validation.
- `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`: four HTTP adapters.
- `apps/mobile/src/infrastructure/mock/mock-workspace.repository.ts`: explicit mock implementation of the same interface only.
- `apps/mobile/src/features/workspace/hooks/useWorkspace.ts`: mutations, scoped invalidation, selection cleanup and late-response guard.
- `apps/mobile/src/features/workspace/workspace.mutations.ts`: pure validation/permission/confirmation helpers.
- `apps/mobile/src/app/(app)/workspace/index.tsx`: bounded member controls and states.
- Existing mobile CJS tests plus focused member contract/state tests; no new test dependency.
- `docs/work_logs/2026-09-22-mobile-workspace-members.md`: evidence and handoff.

## Acceptance

- Correct routes, methods, bodies, `MemberView` mapping, auth transport and no HTTP-to-mock fallback.
- Invalid email/permission input does not request; pending prevents duplicate mutation; errors preserve input/state.
- Remove/leave requires explicit cancelable confirmation; cancel sends no request.
- Successful mutation refreshes the user/workspace-scoped member/list/detail state; leave clears active selection safely.
- Account/workspace/logout changes prevent stale mutation results from updating current state.
- Workspace screen shows read/add/update/remove/leave behavior only where contract and loaded member role justify it.

## Verification commands

```text
node --test <focused mobile .test.cjs files>
node --test <all apps/mobile/src/**/*.test.cjs files>
pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false
pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <temporary-dir> --no-minify
pnpm --dir apps/mobile lint  # report existing missing-config limitation; no tooling install
git diff --check
```

Fixture, Expo Web export, native and live authenticated evidence remain separate. No commit, merge, push or stage-all.
