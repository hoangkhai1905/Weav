# Work logs

One log per feature, written by K or T (see `log_template.md`). Each member has one folder per area.

- **Active logs** sit directly in `<member>/<area>/` and are updated in place.
- **Older logs** (no update for about 5 days) move into `<member>/<area>/<YYYY>-W<ww>/`, the ISO week the log started.
  Move them with `git mv` so their history follows, and fix links to them.
- Old implementation plans were removed on 2026-11-02. Read them with
  `git show archive/plans-2026-11-02:docs/superpowers/plans/<file>`.

## K

### K/ai-service

- 2026-W40: [ai-service-v1.md](K/ai-service/2026-W40/ai-service-v1.md): Nhật ký AI Service V1 — spec, plan và implementation (`2026-09-25` → `2026-09-30`)
- 2026-W40: [review-medium-fixes.md](K/ai-service/2026-W40/review-medium-fixes.md): Nhật ký: ai-service review medium fixes (AI-1, AI-3)
- 2026-W41: [ai-generate-node.md](K/ai-service/2026-W41/ai-generate-node.md): ai.generate node and ai-service `prompt` operation (Week 2, Lane B)
- 2026-W41: [assistant-mvp.md](K/ai-service/2026-W41/assistant-mvp.md): AI assistant MVP (Week 3)
- 2026-W41: [assistant-spike.md](K/ai-service/2026-W41/assistant-spike.md): AI assistant tool-calling spike (Week 2, Lane D)

### K/backend

- 2026-W42: [backend-review-2026-10.md](K/backend/2026-W42/backend-review-2026-10.md): Nhật ký: Backend review fixes 2026-10

### K/docs

- active: [docs-cleanup.md](K/docs/docs-cleanup.md): Nhật ký: dọn thư mục docs (2026-11-02)
- 2026-W40: [rulebook-and-specs.md](K/docs/2026-W40/rulebook-and-specs.md): Work log: Rulebook and component specs

### K/gateway

- 2026-W40: [gateway-route-coverage.md](K/gateway/2026-W40/gateway-route-coverage.md): Nhật ký: API Gateway - phủ route còn thiếu và sửa lỗi liên quan
- 2026-W40: [review-medium-fixes.md](K/gateway/2026-W40/review-medium-fixes.md): Nhật ký: Gateway - sửa các phát hiện mức Thấp (Step 3)
- 2026-W41: [public-auth-bearer.md](K/gateway/2026-W41/public-auth-bearer.md): Nhật ký: Gateway - không chuyển Bearer cũ lên Identity ở route auth công khai

### K/identity

- 2026-W36: [identity-core-auth-readiness.md](K/identity/2026-W36/identity-core-auth-readiness.md): Identity Core Authentication - Readiness and Implementation Worklogs
- 2026-W40: [review-high-fixes.md](K/identity/2026-W40/review-high-fixes.md): Nhật ký: Identity - sửa các phát hiện mức High từ backend review (2026-10-01)
- 2026-W40: [review-medium-fixes.md](K/identity/2026-W40/review-medium-fixes.md): Nhật ký: Identity - sửa các phát hiện mức Medium từ backend review (2026-10-02)
- 2026-W40: [rs256-access-tokens.md](K/identity/2026-W40/rs256-access-tokens.md): Nhật ký: RS256 access token (ID-6 / GW-3 / WS-15 / X-8)
- 2026-W41: [google-account-chooser.md](K/identity/2026-W41/google-account-chooser.md): Work log: Google sign-in always shows the account chooser
- 2026-W41: [mobile-oauth.md](K/identity/2026-W41/mobile-oauth.md): Nhật ký: Đăng nhập Google cho mobile (W6-D1, backend)

### K/mobile

- 2026-W41: [mobile-ui.md](K/mobile/2026-W41/mobile-ui.md): Nhật ký làm việc: Mobile UI và nối API thật (apps/mobile)

### K/notification

- 2026-W40: [poison-message-fix.md](K/notification/2026-W40/poison-message-fix.md): Nhật ký: sửa poison message của notification-service (NT-1/X-4, NT-2/X-5)
- 2026-W40: [review-medium-fixes.md](K/notification/2026-W40/review-medium-fixes.md): Nhật ký: hardening notification-service (NT-3, NT-4, NT-5, NT-6)

### K/ocr

- 2026-W41: [colab-ocr-integration.md](K/ocr/2026-W41/colab-ocr-integration.md): Work log: Colab OCR integration and Gateway OCR timeout

### K/platform

- active: [demo-deployment.md](K/platform/demo-deployment.md): Demo deployment (domain, DNS, email, hosting)
- 2026-W40: [ci-github-actions.md](K/platform/2026-W40/ci-github-actions.md): CI: GitHub Actions
- 2026-W40: [review-medium-fixes.md](K/platform/2026-W40/review-medium-fixes.md): Platform - review-medium-fixes (X-9, X-10, X-12, X-13)

### K/qa

- 2026-W41: [e2e-audit.md](K/qa/2026-W41/e2e-audit.md): E2E QA audit: backend + web (Week 5, Phase 2)

### K/web

- 2026-W41: [account-workspace-connections.md](K/web/2026-W41/account-workspace-connections.md): Nhật ký: Web tài khoản, workspace, kết nối (Week 5, lane W5-C)
- 2026-W41: [builder-correctness.md](K/web/2026-W41/builder-correctness.md): Nhật ký: Builder correctness (W5-A, batch 1)
- 2026-W41: [control-bot-web.md](K/web/2026-W41/control-bot-web.md): Control bot (W6-B2): Discord connection, node inspectors, templates
- 2026-W41: [honest-pages.md](K/web/2026-W41/honest-pages.md): Nhật ký: Honest pages (web) - lane W5-B
- 2026-W41: [invite-by-email-web.md](K/web/2026-W41/invite-by-email-web.md): Nhật ký: mời thành viên qua email, phần web (W7-A1b)
- 2026-W41: [shared-templates-web.md](K/web/2026-W41/shared-templates-web.md): Nhật ký: Mẫu quy trình dùng chung (web) - lane W6-C2
- 2026-W41: [ui-redesign.md](K/web/2026-W41/ui-redesign.md): Nhật ký: Thiết kế lại giao diện web (ui-redesign)
- 2026-W41: [w7-ai-explain-sepay.md](K/web/2026-W41/w7-ai-explain-sepay.md): Nhật ký W7-A3: nút "Hỏi AI vì sao lỗi" + mẫu SePay (web)
- 2026-W41: [web-session-renewal.md](K/web/2026-W41/web-session-renewal.md): Giữ đăng nhập web theo phiên backend (7 ngày)
- 2026-W41: [week4-fe-integration.md](K/web/2026-W41/week4-fe-integration.md): Week 4 FE integration (staging + dev)
- 2026-W41: [workflow-import-export.md](K/web/2026-W41/workflow-import-export.md): Workflow JSON export/import + "New workflow" fix (W7-B)
- 2026-W42: [brand-logo.md](K/web/2026-W42/brand-logo.md): Nhật ký: Logo thương hiệu Weav (brand-logo)
- 2026-W42: [simple-node-ui.md](K/web/2026-W42/simple-node-ui.md): Simple node UI (settings and data passing)
- 2026-W43: [e2e-v2-spec-repair.md](K/web/2026-W43/e2e-v2-spec-repair.md): Repair Playwright specs stale since the v2 redesign
- 2026-W43: [workflows-list-fanout.md](K/web/2026-W43/workflows-list-fanout.md): Workflows list request fan-out (N+1)

### K/workflow

- active: [google-docs-node.md](K/workflow/google-docs-node.md): Nhật ký: node `google.docs` (tạo và thêm chữ vào Google Docs)
- 2026-W39: [workflow-service-acceptance-and-release.md](K/workflow/2026-W39/workflow-service-acceptance-and-release.md): Workflow Service V1 detailed record — acceptance and release
- 2026-W39: [workflow-service-admission-and-execution.md](K/workflow/2026-W39/workflow-service-admission-and-execution.md): Workflow Service V1 detailed record — admission and execution
- 2026-W39: [workflow-service-authoring-and-connections.md](K/workflow/2026-W39/workflow-service-authoring-and-connections.md): Workflow Service V1 detailed record — authoring and connections
- 2026-W39: [workflow-service-foundation.md](K/workflow/2026-W39/workflow-service-foundation.md): Workflow Service V1 detailed record — foundation
- 2026-W39: [workflow-service-providers-and-http.md](K/workflow/2026-W39/workflow-service-providers-and-http.md): Workflow Service V1 detailed record — providers and http
- 2026-W39: [workflow-service-triggers-and-readiness.md](K/workflow/2026-W39/workflow-service-triggers-and-readiness.md): Workflow Service V1 detailed record — triggers and readiness
- 2026-W39: [workflow-service-v1.md](K/workflow/2026-W39/workflow-service-v1.md): Workflow Service V1 — consolidated work log
- 2026-W40: [google-calendar-drive.md](K/workflow/2026-W40/google-calendar-drive.md): Google Calendar and Drive nodes (Week 1, Lane 3)
- 2026-W40: [node-config-schema.md](K/workflow/2026-W40/node-config-schema.md): Node config JSON Schema (Week 1, Lane 1)
- 2026-W40: [review-high-fixes.md](K/workflow/2026-W40/review-high-fixes.md): Nhật ký làm việc - Workflow Service: sửa các finding mức High từ backend review
- 2026-W40: [review-medium-fixes.md](K/workflow/2026-W40/review-medium-fixes.md): Nhật ký: workflow-service review medium fixes (WF-9, WF-12, WF-11, WF-8)
- 2026-W40: [telegram-nodes.md](K/workflow/2026-W40/telegram-nodes.md): Telegram nodes and bot-service removal (Week 1, Lane 2)
- 2026-W41: [attachments.md](K/workflow/2026-W41/attachments.md): Email attachments and the workflow file store (Week 4, lanes F1-F3)
- 2026-W41: [control-bot.md](K/workflow/2026-W41/control-bot.md): Nhật ký: bot điều khiển, sự kiện workflow, Discord - backend (W6-B1)
- 2026-W41: [core-logic-nodes.md](K/workflow/2026-W41/core-logic-nodes.md): Core logic nodes (logic.switch, data.set, text coercion) (Week 2, Lane A)
- 2026-W41: [execution-cancel-and-run-expressions.md](K/workflow/2026-W41/execution-cancel-and-run-expressions.md): Nhật ký: dừng lượt chạy, biểu thức lượt chạy, sửa nhỏ (W6-C3)
- 2026-W41: [gmail-trigger.md](K/workflow/2026-W41/gmail-trigger.md): Gmail trigger (Week 2, Lane C)
- 2026-W41: [monitoring.md](K/workflow/2026-W41/monitoring.md): Nhật ký: mô-đun giám sát (W6-A)
- 2026-W41: [node-polish.md](K/workflow/2026-W41/node-polish.md): Node polish: Sheets lookup, Calendar list, Telegram options, AND/OR condition (Week 4, lane F4)
- 2026-W41: [shared-templates.md](K/workflow/2026-W41/shared-templates.md): Nhật ký: mẫu workflow dùng chung, backend (W6-C1)
- 2026-W41: [w7-node-bundle.md](K/workflow/2026-W41/w7-node-bundle.md): Nhật ký: W7-A2 node bundle (format.datetime, format.text, slack.send_message, teams.send_message)
- 2026-W41: [week5-backend-fixes.md](K/workflow/2026-W41/week5-backend-fixes.md): Nhật ký Week 5: sửa backend (lane W5-D, batch 1)

### K/workspace

- 2026-W39: [workspace-connection-credential-domain-lifecycle.md](K/workspace/2026-W39/workspace-connection-credential-domain-lifecycle.md): Workspace Connection and Credential - Domain and Lifecycle Worklogs
- 2026-W39: [workspace-connection-credential-provider-runtime.md](K/workspace/2026-W39/workspace-connection-credential-provider-runtime.md): Workspace Connection and Credential - Provider and Runtime Worklogs
- 2026-W39: [workspace-core-v1.md](K/workspace/2026-W39/workspace-core-v1.md): Workspace Core V1 - Consolidated Worklogs
- 2026-W40: [review-high-fixes.md](K/workspace/2026-W40/review-high-fixes.md): Nhật ký: workspace-service - sửa finding High (X-2, WS-2, WS-3)
- 2026-W40: [review-medium-fixes.md](K/workspace/2026-W40/review-medium-fixes.md): Nhật ký: workspace-service, sửa findings mức Medium (WS-5, WS-4)
- 2026-W40: [workspace-google-connect.md](K/workspace/2026-W40/workspace-google-connect.md): 2026-09-29 — Workspace Google Connect fails with DependencyUnavailableException
- 2026-W40: [ws6-oauth-binding.md](K/workspace/2026-W40/ws6-oauth-binding.md): Nhật ký: WS-6 gắn OAuth Google với người dùng đã xác thực (lane E)
- 2026-W41: [invite-by-email.md](K/workspace/2026-W41/invite-by-email.md): Nhật ký: mời thành viên qua email (W7-A1)
- 2026-W41: [workspace-delete.md](K/workspace/2026-W41/workspace-delete.md): Nhật ký: Xóa không gian làm việc (W6-D2)

## T

### T/agents

- 2026-W36: [agent-cli-reliability.md](T/agents/2026-W36/agent-cli-reliability.md): Nhật ký làm việc - 2026-09-06
- 2026-W36: [agent-worker-hardening.md](T/agents/2026-W36/agent-worker-hardening.md): Nhật ký ngày 2026-09-06 — Agent worker bridge hardening
- 2026-W36: [agents-guidance.md](T/agents/2026-W36/agents-guidance.md): Work Log"��y��y� 2026-09-02+�u���T Agent guidance
- 2026-W36: [worker-probe.md](T/agents/2026-W36/worker-probe.md): Nhật ký ngày 2026-09-06 — CLI worker probe
- 2026-W37: [agent-cli-local-path.md](T/agents/2026-W37/agent-cli-local-path.md): Nhật ký ngày `2026-09-07`
- 2026-W37: [agents-guidance.md](T/agents/2026-W37/agents-guidance.md): Work Log — 2026-09-10 — Agent guidance update

### T/ai

- 2026-W43: [ai-provider-byok.md](T/ai/2026-W43/ai-provider-byok.md): AI nodes: chọn nhà cung cấp AI bằng key riêng (BYO key)

### T/backend

- 2026-W36: [clean-architecture-refactor.md](T/backend/2026-W36/clean-architecture-refactor.md): Nhật ký làm việc - 2026-09-02

### T/daily

- 2026-W36: [2026-09-01.md](T/daily/2026-W36/2026-09-01.md): Nhật ký làm việc - 2026-09-01
- 2026-W36: [2026-09-02.md](T/daily/2026-W36/2026-09-02.md): Nhật ký làm việc - 2026-09-02
- 2026-W36: [2026-09-05.md](T/daily/2026-W36/2026-09-05.md): Nhật ký ngày `2026-09-05`
- 2026-W36: [2026-09-06.md](T/daily/2026-W36/2026-09-06.md): Nhật ký ngày `2026-09-06`
- 2026-W37: [2026-09-07.md](T/daily/2026-W37/2026-09-07.md): Nhật ký ngày `2026-09-07`
- 2026-W37: [2026-09-08.md](T/daily/2026-W37/2026-09-08.md): Work log 2026-09-08
- 2026-W37: [2026-09-09.md](T/daily/2026-W37/2026-09-09.md): Nhật ký làm việc - 2026-09-09
- 2026-W37: [2026-09-11.md](T/daily/2026-W37/2026-09-11.md): Nhật ký làm việc - 2026-09-11

### T/gateway

- 2026-W38: [2026-09-16-api-gateway-implementation.md](T/gateway/2026-W38/2026-09-16-api-gateway-implementation.md): Nhật ký 2026-09-16 — API Gateway implementation
- 2026-W38: [2026-09-17-api-gateway-implementation.md](T/gateway/2026-W38/2026-09-17-api-gateway-implementation.md): Nhật ký 2026-09-17 — API Gateway
- 2026-W38: [api-gateway-ocr-timeout.md](T/gateway/2026-W38/api-gateway-ocr-timeout.md): Work log 2026-09-19 — API Gateway OCR timeout follow-up
- 2026-W38: [api-gateway-planning.md](T/gateway/2026-W38/api-gateway-planning.md): Nhật ký ngày 2026-09-16 — API Gateway planning
- 2026-W38: [api-gateway-task-5.md](T/gateway/2026-W38/api-gateway-task-5.md): Nhật ký ngày `2026-09-20`
- 2026-W38: [api-gateway-task-6.md](T/gateway/2026-W38/api-gateway-task-6.md): API Gateway Task 6 — 2026-09-20

### T/identity

- 2026-W36: [identity-remaining-endpoints-planning.md](T/identity/2026-W36/identity-remaining-endpoints-planning.md): Nhật ký 2026-09-06 — Identity remaining endpoints planning
- 2026-W37: [identity-m2.md](T/identity/2026-W37/identity-m2.md): Nhật ký ngày `2026-09-08`
- 2026-W37: [identity-m3.md](T/identity/2026-W37/identity-m3.md): Nhật ký Identity M3 - Task6 persistence
- 2026-W37: [identity-m4-m5.md](T/identity/2026-W37/identity-m4-m5.md): Nhật ký Identity M4/M5 - 2026-09-11

### T/mobile

- 2026-W39: [mobile-auth-session.md](T/mobile/2026-W39/mobile-auth-session.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-auth-sessions.md](T/mobile/2026-W39/mobile-auth-sessions.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-change-password.md](T/mobile/2026-W39/mobile-change-password.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-fe-final-regression.md](T/mobile/2026-W39/mobile-fe-final-regression.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [mobile-integration-closure.md](T/mobile/2026-W39/mobile-integration-closure.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [mobile-notification-integration.md](T/mobile/2026-W39/mobile-notification-integration.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-password-recovery.md](T/mobile/2026-W39/mobile-password-recovery.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-profile-integration.md](T/mobile/2026-W39/mobile-profile-integration.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-profile-session-verification.md](T/mobile/2026-W39/mobile-profile-session-verification.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-workspace-create-rename.md](T/mobile/2026-W39/mobile-workspace-create-rename.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-workspace-members.md](T/mobile/2026-W39/mobile-workspace-members.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [mobile-workspace-read-switch.md](T/mobile/2026-W39/mobile-workspace-read-switch.md): Nhật ký làm việc - 2026-09-21

### T/notification

- [mobile-push.md](T/notification/mobile-push.md): Mobile push notifications (Expo/FCM) — 2026-11-03
- 2026-W37: [notification-fe.md](T/notification/2026-W37/notification-fe.md): Notification FE — 2026-09-10
- 2026-W37: [notification-service-research.md](T/notification/2026-W37/notification-service-research.md): Notification Service research and implementation prompt
- 2026-W37: [notification-service.md](T/notification/2026-W37/notification-service.md): Nhật ký 2026-09-10 — Notification Service
- 2026-W40: [notification-local-test-handoff.md](T/notification/2026-W40/notification-local-test-handoff.md): Nhật ký ngày 2026-09-29 — Notification local test handoff
- 2026-W43: [dependency-security.md](T/notification/2026-W43/dependency-security.md): Nhật ký: bảo mật dependency notification-service

### T/web

- 2026-W39: [fe-integration-coverage-audit.md](T/web/2026-W39/fe-integration-coverage-audit.md): FE integration coverage audit — 2026-09-22
- 2026-W39: [fe-integration-final-handoff.md](T/web/2026-W39/fe-integration-final-handoff.md): FE integration final handoff — 2026-09-22
- 2026-W39: [web-auth-sessions.md](T/web/2026-W39/web-auth-sessions.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [web-change-password.md](T/web/2026-W39/web-change-password.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [web-integration-closure.md](T/web/2026-W39/web-integration-closure.md): Web integration closure — 2026-09-22
- 2026-W39: [web-localization-cleanup.md](T/web/2026-W39/web-localization-cleanup.md): Nhật ký ngày 2026-09-23 — Web localization cleanup
- 2026-W39: [web-notification-integration.md](T/web/2026-W39/web-notification-integration.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [web-ocr-integration.md](T/web/2026-W39/web-ocr-integration.md): Nhật ký đợt 6 - Web OCR integration hardening
- 2026-W39: [web-password-recovery.md](T/web/2026-W39/web-password-recovery.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [web-profile-integration.md](T/web/2026-W39/web-profile-integration.md): Nhật ký ngày `2026-09-22`
- 2026-W39: [web-workspace-create-rename.md](T/web/2026-W39/web-workspace-create-rename.md): Nhật ký đợt 2 - Web Workspace create + rename
- 2026-W39: [web-workspace-google-connections-plan.md](T/web/2026-W39/web-workspace-google-connections-plan.md): Work log — Web Workspace Google Connections plan
- 2026-W39: [web-workspace-members.md](T/web/2026-W39/web-workspace-members.md): Nhật ký làm việc - 2026-09-22
- 2026-W39: [web-workspace-read-switch.md](T/web/2026-W39/web-workspace-read-switch.md): Web Workspace read + switch foundation
- 2026-W39: [workflow-v1-web-integration.md](T/web/2026-W39/workflow-v1-web-integration.md): Nhật ký ngày `2026-09-24` — Workflow Service merge và Web integration
- 2026-W43: [admin-web.md](T/web/2026-W43/admin-web.md): Nhật ký: Web admin riêng (`apps/admin`)

### T/workflow

- 2026-W43: [live-node-test.md](T/workflow/2026-W43/live-node-test.md): Live test toàn bộ node workflow

### T/workspace

- 2026-W38: [workspace-connection-live-validation.md](T/workspace/2026-W38/workspace-connection-live-validation.md): Work log - Workspace Connection/Credential live validation and GitNexus
- 2026-W38: [workspace-merge-readiness.md](T/workspace/2026-W38/workspace-merge-readiness.md): Work log - Workspace demo cleanup and merge readiness
- 2026-W39: [workspace-connections-contract-audit.md](T/workspace/2026-W39/workspace-connections-contract-audit.md): Workspace Connections contract audit — 2026-09-22
- 2026-W39: [workspace-dev-service-key.md](T/workspace/2026-W39/workspace-dev-service-key.md): Workspace internal service key — 2026-09-23

## Weeks

| Week | Dates (2026, Mon to Sun) |
| --- | --- |
| 2026-W36 | 08-31 to 09-06 |
| 2026-W37 | 09-07 to 09-13 |
| 2026-W38 | 09-14 to 09-20 |
| 2026-W39 | 09-21 to 09-27 |
| 2026-W40 | 09-28 to 10-04 |
| 2026-W41 | 10-05 to 10-11 |
| 2026-W42 | 10-12 to 10-18 |
| 2026-W43 | 10-19 to 10-25 |
