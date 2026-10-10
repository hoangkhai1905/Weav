# E2E QA audit: backend + web (Week 5, Phase 2)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-07 (Asia/Saigon) |
| Branch / commit | `dev` / `c312150` (staging fast-forwarded to the same commit) |
| Owner | K / coordinator agent |
| Status | Done (Phase 2). Plan: `docs/superpowers/specs/2026-10-07-week5-plan.md` (approved 2026-10-07, D1-D4 = recommendations) |
| Scope | Every user flow of `apps/web` against the real dev stack (7 services, no OCR) on Neon branch `dev-k`. Findings only; fixes are planned in Phase 3 |
| Environment | `compose.yml` + `compose.dev.yml` `--profile app`; Vite `localhost:5173`, `VITE_API_MODE=http`; cloudflared quick tunnel -> gateway `:3000` (`WORKFLOW_PUBLIC_BASE_URL`); AI enabled (DeepSeek, keep calls few); email via Resend SMTP |

## 2. How each area is tested

Browser = built-in browser against `localhost:5173`, console + network checked on every page. API = direct gateway call to confirm the backend side of a finding. Static = web API client vs gateway route/DTO comparison.

| Area | Flows | Method |
| --- | --- | --- |
| Auth | register, OTP verify, login, logout, refresh, forgot/reset/change password, sessions list/revoke, profile edit, avatar, Google sign-in (K signs in), admin users | Browser with throwaway `+qa` accounts; Google by K |
| Workspaces | create, rename, switch, members, invite, permissions, leave | Browser (two throwaway accounts) |
| Connections | list, create per provider, OAuth connect (K), test, disable, delete, credential update | Browser; OAuth by K |
| Builder | each node form vs `packages/workflow-schema/nodes/*.json`, templates incl. `[n]`, validation messages, save draft, publish, pause, resume, rename, delete | Browser + Static |
| Triggers | manual, schedule, webhook (curl through tunnel), telegram (K's bot), gmail (attachments) | Browser + API |
| Nodes | http, email.send, telegram, sheets, calendar, drive, ai.*, data.set, condition, switch | Browser builder + run; API-level via `scripts/live-test-nodes.ps1` (K runs) |
| Executions | list, detail, node input/output, logs, failure display | Browser |
| Notifications | in-app list, unread count, read, read-all, live updates | Browser |
| AI | generator, assistant chat (SSE), history, delete conversation | Browser, 1-2 live calls only |
| Other pages | Dashboard, Settings, Telegram, Help | Browser |

## 3. Test accounts created (local stack, Neon `dev-k`)

| Account | Purpose | Cleanup |
| --- | --- | --- |
| `nhoangkhai195+qa1@gmail.com` ("QA One") | Owner of workspace "QA WS One" (`336d4ae8-...`); browser register, change password | Password in git-ignored `tmp/qa-accounts.txt`; delete account + workspace after Week 5 (no delete API yet) |
| `nhoangkhai195+qa2@gmail.com` ("QA Two") | Member of "QA WS One" (registered via API) | same |

## 4. Findings

Category: BUG = logic incorrect; MISMATCH = FE<->BE contract mismatch; UX = friction / easier-to-use idea; MISSING = missing feature. Severity: High / Medium / Low.

| # | Area | Steps to reproduce | Expected | Actual | Category | Severity | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Telegram page | Open `/telegram` | Page explains bot connections | Calls removed `/api/telegram/*` endpoints (bot-service gone since Week 1) | MISMATCH | Medium | Known; backlog section 2 |
| 2 | Register | `/register`, password `abc` | Field error "8-72 characters" | Generic "Không thể tạo tài khoản"; backend `details[].field=password` ignored; no client-side rule | UX | Medium | `POST /api/auth/register` 400 `VALIDATION_ERROR` |
| 3 | First run | Register new account, land on `/dashboard` | Onboarding: "create your first workspace" | Red "Không thể tải dữ liệu quy trình" + Retry (no workspace yet); no personal workspace auto-created | UX | High | screenshot in session; `GET /workspaces` 200 empty |
| 4 | Dashboard | Quick action "Tạo bằng AI" in http mode | Opens `/ai/workflow-generator` (AI enabled, page works from sidebar) | Disabled, text "chưa khả dụng ở chế độ API" | BUG | Medium | `apps/web/src/pages/DashboardPage.tsx:80` gates on `isWorkflowMockMode` |
| 5 | Members | Add `nobody@example.com` | "No account with this email" | "Không gian làm việc không còn tồn tại hoặc bạn không có quyền" | BUG | Medium | `POST .../members` 404 `USER_NOT_FOUND` mapped as workspace 404 |
| 6 | Members | Members tab, owner row | Owner shows full rights | Both permission chips "Bị hạn chế" for OWNER (owner can publish: verified) | BUG | Medium | members API `role:OWNER, canPublishWorkflow:false` |
| 7 | Members | Permission chips | Labelled "Publish" / "Pause-resume" | Two identical "Bị hạn chế" chips, icon-only difference | UX | Low | screenshot |
| 8 | Members | Click label "Email người dùng Identity hiện có" | Focuses input | Label not bound to input; text is dev jargon ("Identity") | UX/a11y | Low | read_page: label and textbox separate |
| 9 | Members | Invite someone without an account | Email invitation / pending invite | Only existing accounts can be added | MISSING | Medium | |
| 10 | Workspace | Settings tab | Delete / leave workspace, transfer ownership | Only rename; owner cannot leave or transfer | MISSING | Low | backlog 3 nice-to-have |
| 11 | Workspace overview | Overview cards | Real data | "Môi trường: Production" hard-coded; create page shows "Cụm Production (us-east-1)", "v2.4 engine", "hơn 30 mẫu" | UX (fake content) | Medium | `/workspace`, `/workflows/new` |
| 12 | Settings | Profile | Upload/remove avatar | No avatar UI although gateway has `PUT/DELETE /api/users/me/avatar` | MISSING (FE) | Medium | Static: no FE caller |
| 13 | Settings | Sessions list | "Chrome on Windows", last used time | Raw user-agent string; "Dùng gần nhất —" empty | UX | Low | |
| 14 | Settings | Change password, wrong current password | "Mật khẩu hiện tại không đúng" | "Thông tin đăng nhập không đúng hoặc phiên đã hết hạn" | UX | Low | `POST /api/auth/change-password` 401 |
| 15 | Create workflow | `/workflows/new` -> template "Thông báo & xử lý đơn hàng" -> "Dùng mẫu" | Draft with the template's steps | Workflow named in English with only `trigger.manual`; templates advertise nodes that do not exist (Shopify, Slack, Postgres, S3) | BUG | High | workflow `17b0cb79` definition has 1 node |
| 16 | Builder | Add HTTP node; canvas shows id `http_request_v1`; write `{{ nodes.http_request_v1.output.data[1].name }}` in data.set; publish | Template resolves | Publish 400 `MAPPING_ERROR: The referenced node does not exist`; real node id is `node-6` (only in saved JSON) | BUG | High | `PUT .../draft` body: ids `node-6`, `node-7` |
| 17 | Builder | Write a template in any field | Variable picker listing upstream outputs with correct paths | None; "Đầu vào" tab empty until a run exists; user must guess ids/paths | MISSING (UX) | High | |
| 18 | Builder | Publish error | Message names node + field, in VI | Raw English "Workflow definition is invalid: MAPPING_ERROR: ..." without node/field | UX | Medium | |
| 19 | Builder | Save draft, then click "Xuất bản" | Publish | Success toast stays over the header buttons; click hits the toast | UX | Medium | toast at top-right covers Run/Publish |
| 20 | Builder | Palette | Accurate labels | `email.send` labelled "Gửi email / Slack" (no Slack); OCR listed though disabled; header shows raw workspace UUID | UX | Low | |
| 21 | Executions | Run manual workflow (3 nodes, ~1.4 s) | Duration ~1.4 s | Run duration "0 ms" in list + header; `startedAt` 09:06:05 > `finishedAt` 09:05:51 | BUG | Medium | Root cause: `ExecutionStateAdapter.java:150` sets `started_at = CURRENT_TIMESTAMP` (DB clock) while node/finish times use the JVM clock; this PC's clock is ~17 s behind (Neon correct). Fix: one clock source. Env: K should resync Windows time |
| 22 | Runtime | manual -> http GET -> data.set with `data[1].name`, `data[0].address.city`, text interpolation | Resolved values | PASS: "Ervin Howell", "Status 200, city Gwenborough" | (pass) | - | execution `27ece8d0` |
| 23 | Builder | Blank workflow -> delete manual trigger -> add "Trình kích hoạt Webhook" -> Lưu | Draft saved | `PUT .../draft` 400 `UNKNOWN_CONFIG_FIELD`: FE default webhook config `{method:'POST'}`, schema has no properties. Webhook trigger unusable from the UI | MISMATCH | High | `apps/web/src/lib/constants/nodeCatalog.ts:30`; workflow `8c4d3219` |
| 24 | Builder | Add "Phân loại bằng AI" | Inputs for content + categories | Only "Danh mục"; required `content` has no input, node can never be configured (same for ai.summarize `inputText`, static) | MISSING (FE) | High | screenshot; `WorkflowBuilderPage.tsx:1919-1930` |
| 25 | Builder | Select node, press Delete | Node removed; visible delete action | Only Backspace works (React Flow default); no delete button or hint | UX | Medium | |
| 26 | Builder | "Bắt đầu từ đầu" | Ask for a name | Created immediately as "Untitled Automation Pipeline" (English) | UX | Low | |
| 27 | Builder | Rename in header, then a draft save fails | Rename saved on its own | Rename rides on `PUT /draft`; if the draft is invalid the rename is lost silently | UX | Medium | workflow `8c4d3219` still "Untitled..." |
| 28 | Workflows list | ⋯ menu: Lịch sử chạy, Nhân bản, Tạm dừng/Tiếp tục, Xóa (type "xóa 1") | Works | PASS (pause/resume/duplicate/delete all 2xx); menu items have no accessible names | (pass) / a11y Low | - | `DELETE .../06f064e2` 204 |
| 29 | Connections | Create Gmail connection | One step: name -> Google consent | Two steps; leaves a "Đã tắt / Chưa xác minh / Chưa có thông tin xác thực" connection until "Kết nối Google" | UX | Medium | connection `7747bc62` |
| 30 | Connections | "Kiểm tra kết nối" on a never-connected connection | "Not connected yet" | "Cần xác thực lại / Quyền Google cần được cấp lại" + a "Cần kết nối lại" notification | UX | Low | |
| 31 | Connections | ⋯ menu | Disable / enable | Only rename, test, delete; gateway has `POST .../disable` | MISSING (FE) | Low | |
| 32 | Notifications | Do own actions (create/pause/resume) | Notify on runs, failures, others' actions | Every own action creates an unread notification (10 in 15 min) | UX | Low | `/notifications` |
| 33 | Telegram page | Open `/telegram` | Real state or "connect your bot" guide | 100% hard-coded: fake `@weav_automation_bot` "ĐÃ KẾT NỐI", fake `@truong_dev`, fake logs, `/run` `/status` commands that do not exist; no API call | BUG (fake page) | High | replaces #1; `apps/web/src/pages/TelegramPage.tsx` |
| 34 | Help | Open `/help` | User guide: nodes, templates `{{ }}`, triggers | Developer links (React 19, Playwright E2E, specs) | UX | Medium | |
| 35 | AI generator page | Sidebar "Tạo bằng AI" -> type prompt -> "Tạo quy trình" -> "Dùng quy trình" | Calls `POST /workflows/generate`, shows the real draft | Pure animation of a hard-coded Stripe/PostgreSQL/Slack/gpt-4o-mini pipeline; no request; "Dùng quy trình" creates an empty workflow named "Stripe Order & AI Enrichment Pipeline" (falls back to `/workflows/wf-prod-8492` on error) | BUG (fake page) | High | `apps/web/src/pages/AiGeneratorPage.tsx:41-82`; the real generator is the builder ✨ panel (`GenerateWorkflowPanel.tsx`) |
| 36 | AI generator (builder ✨) | Prompt "... gửi email tóm tắt cho tôi" | Ask for the recipient (or default to my email) and let me answer | `needs_input {field: send_email.config.to}` shown as error "Thiếu một giá trị bắt buộc. send_email.config.to"; no answer box; only Sheets/Gmail connection pickers | UX | Medium | `POST .../workflows/generate` 200 (1 DeepSeek call) |
| 37 | Assistant | `/assistant`: "Hôm nay có lượt chạy nào lỗi không?" | Streamed answer via tools | PASS (SSE, tool step "Đang xem các lần chạy lỗi hôm nay", correct answer); breadcrumb says "Tổng quan"; suggests user supply workflow/execution ids | (pass) / UX Low | - | `POST /api/v1/assistant/chat` 200 (1 DeepSeek call) |
| 38 | Admin | Admin users page | Page for `systemRole=ADMIN` | No admin page/route in the web app; gateway has `GET/PATCH /api/admin/users` | MISSING (FE) | Medium | static |
| 40 | Forgot password | Request code, leave the page, come back with the code | "I already have a code" step | Step state lost; old code unusable (needs `challengeId` from the 202 body); must request a new code | UX | Medium | `POST /api/auth/forgot-password` 202 |
| 40b | Forgot password | New code -> code + new password on the same page | Reset, back to login | PASS (`otp/verify` 200, `reset-password` 204, "Đã đặt lại mật khẩu"); the reset also ended the other account's open session in the same browser | (pass) | - | `+qa2` |
| 41 | Execution detail | Run (manual -> http -> data.set) while it is running | Steps in graph order | Steps listed "Đặt dữ liệu, manual, HTTP Request" (pending first); run 9fff1c3a still "Đang chạy" after 10 s, no auto-refresh verified | UX | Low | execution `9fff1c3a` (failure display: to re-check) |
| 42 | Builder header | Published workflow at ~1190 px | Tabs and actions readable | "Lịch sử chạy", ✨ and "Cài đặt" overlap next to the "Đang bật" switch | UX | Low | screenshot |
| 43 | Builder | Telegram trigger -> telegram.send -> Xuất bản | Publish (Telegram is the trigger) | 400 `MANUAL_TRIGGER_REQUIRED`: every published workflow must also contain a manual trigger; UI blockers do not mention it | MISMATCH / UX | High | workflow `b5533f93`; rule in `DefinitionValidator` |
| 44 | Builder | Add "Kích hoạt thủ công" while another node is selected | New trigger unconnected | Auto-connects an edge from the last node INTO the trigger (invalid graph) | BUG | Medium | draft edges before fix |
| 45 | Builder | Rename in header + Enter, then Lưu | Name saved | `PUT /draft` body keeps "Untitled Automation Pipeline"; header rename never persists (also #27) | BUG | Medium | request body of `PUT .../b5533f93/draft` |
| 46 | Builder | telegram.send parse mode select | `none`/HTML/MarkdownV2 | Options "Mặc định" and "Không định dạng" both mean no parse mode | UX | Low | |
| 47 | Connections | "Xóa kết nối" | In-app confirm like workflow delete | Native `window.confirm` (blocked in embedded browsers, inconsistent UI); delete itself works (`DELETE` 204) | UX | Low | `ConnectionsPage.tsx:819` |
| 48 | Connections | List | Local time "x phút trước" | Raw ISO "Xác minh lần cuối: 2026-10-07T09:22:12.439215Z" | UX | Low | |
| 49 | Env | Publish Telegram workflow | Webhook registered | 502 "Failed to resolve host": workflow-service had the previous tunnel URL because compose read `.env` before the URL was written; fixed by recreating workflow-service, then publish 200 | ENV (not a bug) | - | message is clear; consider surfacing `WORKFLOW_PUBLIC_BASE_URL` health in UI |
| 50 | Telegram trigger | Publish echo workflow (`b5533f93`), K sends a message to the bot | Reply in the same chat | PASS: reply with HTML, silent, `reply_to` the user's message (K confirmed); run `cb6ab5e6` SUCCESS | (pass) | - | |
| 51 | Execution detail | Telegram-triggered run of a workflow that also has the (required) manual trigger | Only executed steps, or "not used" | Unused manual trigger listed first as "Đang chờ" and selected by default | UX | Medium | run `cb6ab5e6` |
| 52 | Executions | Watch a running run | Live update (thesis: real-time monitoring) | Status stays "Đang chạy" until "Làm mới" is clicked | UX / MISSING | Medium | run `5306d255` |
| 53 | Google suite | manual -> sheets append -> sheets lookup (B = Hanoi) -> email.send (HTML, cc, URL attachment, template from lookup) -> calendar create -> drive upload (content with calendar link) | All succeed | PASS: append `Sheet1!A1:C1`, lookup `{count:1, rows[0].values:[Alice,Hanoi,90]}`, email `SENT attachmentCount:1` (verified in Gmail: HTML, cc, weav-qa.pdf), event created, `weav-qa.txt` uploaded | (pass) | - | workflow `3820b388`, run `5306d255` |
| 54 | Runtime | Same run | Steps back to back | ~1 s idle between steps (6 nodes: 12.7 s work, 19 s wall clock) | PERF | Low | node timestamps |
| 55 | Builder | Sheets inspector text | Accurate | "Dùng kết nối Google Workspace để đọc và ghi Sheets/Docs" (no Docs); value hint uses `{{ id-buoc.output... }}` with no way to know the step id | UX | Low | |
| 56 | Builder | Calendar create start/end | Date-time picker | Plain text inputs; user must type RFC 3339 with offset | UX | Medium | |
| 57 | Builder | email.send with `replyToMessageId` | Subject optional ("để trống dùng Re: ...", as the hint says) | Readiness still demands a subject (static S13 confirmed in UI) | BUG | Low | |
| 58 | Gmail trigger | Workflow `e2a41382`: trigger.gmail (`subject:weav-qa-trigger has:attachment`, 1 min) -> drive upload `file: {{ trigger.input.attachments[0] }}` -> email.send `to: {{ trigger.input.from }}`, `replyToMessageId: {{ trigger.input.messageId }}`; forward a mail with `weav-qa.pdf` | Reply in the thread with the Drive link | Trigger PASS (picked up within 1 poll; attachment stored `fileId`, 13264 bytes); drive upload PASS (`weav-qa.pdf`); email.send FAILED `CONFIGURATION_ERROR` "The email node configuration is invalid." because `from` is `"Name" <addr>` and the recipient validator only accepts bare addresses | BUG | High | run `24298146`; fix: accept RFC 5322 `Name <addr>` in email.send and add `fromEmail`/`fromName` to the trigger input |
| 59 | Execution detail | Failed email step | Error names the field (`to`) and value | Generic "The email node configuration is invalid." | UX | Medium | same run |
| 60 | Executions | Gmail-triggered run | "Gmail" | Trigger label shows raw i18n key `runs.trigger_type.gmail` | BUG | Low | |
| 61 | Workflows list | Telegram and Gmail workflows in the list | Trigger column "Telegram" / "Gmail" | All show "Thủ công" (the mandatory manual trigger wins); 4 rows named "Untitled Automation Pipeline" (rename bug #45) | BUG | Medium | `/workflows` |
| 62 | Real-time | Any run | Live status (WebSocket/SSE) | `services/api-gateway/src/websocket` is empty and the web app has no socket client; pages update only on refetch | MISSING | Medium | static |
| 39 | Navigation | Sidebar | Links to all pages | No link to `/telegram` or `/notifications` page (bell only) or executions overview | UX | Low | |

### 4.1 Static builder vs schema audit (Explore agent, read-only; "runtime" = confirmed in the browser)

| # | Node | Issue | Severity | Status |
| --- | --- | --- | --- | --- |
| S1 | trigger.webhook | Default config `{method:'POST'}` rejected (`UNKNOWN_CONFIG_FIELD`) | High | runtime = #23 |
| S2 | google.sheets | Default `connectionId:''` -> `INVALID_CONNECTION_ID` on draft save until a connection is picked (`nodeCatalog.ts:71`, `DefinitionValidator:178`) | High | static |
| S3 | ocr.extract | Inspector always writes both `artifactId` and `fileUrl` -> `OCR_SOURCE_CONFLICT`; FE also hard-blocks OCR publish; no `language`/`detectTables` | High | static (OCR off) |
| S4 | ai.classify / ai.summarize | No input for required `content` / `inputText`; summarize `maxLength` uses `Number()` (template impossible, empty -> 0) | High | runtime = #24 (classify) |
| S5 | http.request | No `headers`, `query`, `connectionId` inputs (authenticated APIs impossible); method list lacks PATCH/HEAD/OPTIONS; literal URL not checked (`INVALID_URL` at publish) | High | static |
| S6 | nodeCatalog outputs | Wrong output names shown to users: sheets/drive/calendar `result` (real keys are top-level), data.set `fields` (real: the fields themselves), ai.extract `extractedJson` (real: schema keys), OCR keys; missing for telegram trigger, condition, switch | High | static |
| S7 | ai.extract | Schema `instructions` has no input | Medium | static |
| S8 | publish blockers | `getPublishBlockers` ignores ai.extract/classify/summarize and graph rules (one manual trigger, cycles, ports, edges into triggers, upstream-only mappings) -> server 400 without UI hint | Medium | static |
| S9 | logic.condition | `gt/gte/lt/lte` with non-numeric literal passes the UI, server `NUMERIC_OPERAND_REQUIRED` | Medium | static |
| S10 | google.drive | Upload with neither content nor file: UI allows blank `name`, executor requires it; object `file` renders "[object Object]" | Low | static |
| S11 | google.sheets | Values editor edits only row 1 | Low | static |
| S12 | trigger.schedule | Only counts 6 fields; schema description shows a 5-field example | Low | static |
| S13 | email.send | All fields editable (OK); UI requires subject even with `replyToMessageId` | Low | static |

## 5. Not tested / blocked

- Webhook trigger end to end: blocked by #23 (cannot save a webhook workflow from the UI). Backend path covered by Week 4 API live tests.
- Schedule trigger firing, `logic.condition` / `logic.switch` branching, `ai.*` nodes at run time: not exercised in the browser this session (forms checked statically, S4/S9/S12); covered by Week 4 API live tests (`scripts/live-test-nodes.ps1 -Flow logic`). Re-check after the builder fixes.
- Google sign-in on the login page and "Liên kết Google" in Settings: K signed in with Google for the connections only; the identity Google login flow itself was not clicked through.
- Email verification OTP (Settings -> "Gửi mã"): not completed.
- Admin users page: does not exist in the web app (#38).
- Mobile app and OCR: out of scope (partner).

## 6. Summary

60 runtime findings + 13 static. By category: BUG 22, MISMATCH 4, UX 26, MISSING 8 (some rows carry two labels). High: #3, #15, #16, #17, #23, #24, #33, #35, #43, #58 and static S2, S3, S5, S6.

Working end to end: register/login/logout, change and reset password, workspace create/rename/members/permissions, connections (5 providers, OAuth + Telegram token), save/publish/pause/resume/duplicate/delete, manual runs with `[n]` templates, Sheets append/lookup, email.send with HTML/cc/URL attachment, Calendar create, Drive upload (content and from a Gmail attachment), Telegram trigger + reply, Gmail trigger with attachments, assistant chat, builder AI generator (needs_input), notifications.

Environment notes: this PC's clock is ~17 s behind real time (#21; Neon is correct). Compose reads `.env` when `up` starts: write `WORKFLOW_PUBLIC_BASE_URL` before `up`, or recreate workflow-service after changing it (#49).

## 7. Cleanup owed

- Accounts `+qa1`, `+qa2`, workspace "QA WS One", workflows `17b0cb79`, `8c4d3219`, `b5533f93`, `3820b388`, `e2a41382`, connections QA Gmail/Telegram/Sheets/Calendar/Drive (Neon `dev-k`).
- K's Google account: spreadsheet `1CLP...0EI` ("Untitled spreadsheet"), Drive files `weav-qa.txt` and `weav-qa.pdf`, calendar event "Weav QA (1 lookup rows)" on 2026-10-08 09:00, test emails with subjects "Weav QA email.send" and "weav-qa-trigger test 1".
- Telegram bot token was pasted in chat: rotate it in @BotFather after Week 5.
- Gmail trigger workflow `e2a41382` polls every minute: pause it when the stack stays up.
- Week 5 Phase 4 browser pass (2026-10-08) added: workflows `a03efe7b` (Gmail -> Drive -> reply template, PUBLISHED, polls `subject:weav-qa-w5 has:attachment` every minute: pause after the #58 live run), `f9ef4d1e` (AI-generated daily weather email, draft, do not publish), `cb5aad73` ("QA W5 webhook only", draft); run `717da4a6`.

## 8. Week 5 fix status (Phase 4, 2026-10-08)

All four lanes reviewed, committed and merged into `week5` (A 139f7d7, B 2e693c0, C 3a3443a, D ae16a17). Merged checks: web build + `tsc -p tsconfig.app.json` clean, 41/41 new Week 5 Playwright specs, workflow-service `mvnw verify` 836/836, ai-service 207, notification-service 102 + 19 e2e. "Live" = re-checked in the browser on merged `week5` against the real stack; "spec" = covered by stubbed Playwright / unit tests only.

| Lane | Fixed | Live | Spec only |
| --- | --- | --- | --- |
| W5-A builder | #16-#20, #23-#27, #42, #44-#46, #55-#57, S1-S11 | #16, #17 (picker lists trigger + upstream outputs incl. fromEmail/fromName), #20 (workspace name), #23 (webhook-only draft PUT 200), #25 (delete button), #26 (name prompt), S6 | the rest; S12 partial (6-field count only, Spring cron not mirrored) |
| W5-B honest pages | #1, #3, #4, #11 (partial, see N1), #15, #33-#37, #39 | #1/#33 (Telegram page lists QA bot, no /api/telegram), #4, #15 (template -> POST 201 + PUT draft 200, 3 steps, real ids), #34, #35/#36 (real generate, needs_input defaulted to the user's email, connection question, draft created), #39 | #3, #37 |
| W5-C account | #2, #5-#8, #11 part, #12-#14, #29-#31, #38, #40, #47, #48 | #2 (inline password rule, no request), #5 (real 404 USER_NOT_FOUND -> "Không có tài khoản nào với email này"), #6, #7, #8, #11 part, #12 (UI), #13, #38 (non-admin redirected), #48 | #14, #29-#31, #40, #47 |
| W5-D backend + runs | #21, #28, #32, #41, #43, #51, #52, #58, #59, #60, #61 (+ D1) | D1 (publish without manual trigger 200; "Chạy" on a Gmail-only workflow runs from the Gmail trigger, recorded "Thủ công"), #21 (4.8 s, not 0 ms), #41, #51 ("Không chạy"), #52 (run page updated without refresh), #59 (MAPPING_ERROR names `file`), #61 (list shows Gmail/Telegram) | #28 (live: row actions carry the workflow name), #32, #60. #58 live PASS 2026-10-08 15:18: run `c2287f98` (Gmail trigger -> Drive -> reply), trigger input has `fromEmail`, all 3 steps SUCCESS |

Still open: #9 invite by email (Week 7), #10 workspace delete/leave/transfer (not scheduled), #54 ~1 s idle between steps (not addressed), #62 WebSocket (stretch D4 b). Plan change 2026-10-08: shared user templates are the first item of W6-C.

New findings from the Phase 4 browser pass (small, fix before `week5` -> `dev`):

| # | Where | Issue |
| --- | --- | --- |
| N1 | `/workflows/new` | "8 hơn 30 mẫu" (old fake count next to the real one); "Mô tả nhanh" placeholder mentions Stripe/PostgreSQL/Slack; marketing chips ("Lược đồ đã xác minh", "hệ thống dữ liệu và kỹ thuật hiện đại", "tạo node, mã") |
| N2 | Template cards | Step labels in English in VI mode ("Send Telegram message", "New Gmail email"); "Dùng mẫu" is not a button in the accessibility tree |
| N3 | `/register` | Invented claims ("Thời gian hoạt động 99,9%", "Tốc độ gấp 10 lần", "React Flow 12"); submit button has no accessible name |
| N4 | Settings, Members | "Identity" jargon in subtitles ("Quản lý hồ sơ Identity", "người dùng Identity hiện có", ...) |
| N5 | Connections | Raw provider codes (`GOOGLE_SHEETS`, `GOOGLE_DRIVE`) as card labels |
| N6 | Run detail | Field label and message for MAPPING_ERROR / CONFIGURATION_ERROR shown raw in English ("file: The 'file' field refers to a value that is missing.") |
| N7 | AI generator | needs_input question labels are technical ("Thiếu một giá trị bắt buộc. (send_email.config.to)", "(Send email)") |
| N8 | AI generator | Generated workflow name and step labels in English for a Vietnamese prompt |
| N9 | Run history | Breadcrumb shows the workflow UUID until the name loads |

N1-N9 fixed in `feat/w5-polish` (merged f1830de; N8 step names still English: workflow-service derives them from node ids, follow-up).

Incident 2026-10-08: the first live #58 run (`eaf71fe7`, 11:28) failed because a SECOND workflow-service stack with pre-Week-5 code was connected to Neon `dev-k` and admitted/ran it (no `fromEmail`, old generic MAPPING_ERROR). Proof: with K's workflow-service stopped, the ACTIVE gmail trigger row kept updating; `production` had no workflow/identity/workspace sessions, so the partner's stack is not it; no local process or second Docker engine. Fix: `dev-k` `neondb_owner` password rotated (K approved), `.env` updated (backup `tmp/.env.backup-before-dev-k-rotate-2026-10-08`), stack recreated, K restarted the `dev-k` compute to drop the old sessions; the re-test `c2287f98` then passed. The origin of the second stack is still unknown. Regression tests added (`fix/w5-gmail-reply`, merged e28a5fa). Workflow `a03efe7b` paused after the test.

## 9. Week 6 batch 1 live check (2026-10-09, `week6` b552d7c, Neon `dev-k`)

Second-stack check first: with K's stack down, `dev-k` had only Neon `cloud_admin` sessions and no ACTIVE trigger had moved for ~15 h. Stack: 7 services (no OCR) + cloudflared quick tunnel; Flyway workflow V13 and workspace V7 applied on `dev-k`. `.env` backup: `tmp/.env.backup-before-week6-live-2026-10-09`; `.env` gained `OAUTH_MOBILE_RETURN_TARGET_URI=weav://auth/callback`.

| Lane | Live result |
| --- | --- |
| W6-D1 mobile Google sign-in | PASS without the phone: Playwright played the system browser, a script played the app (PKCE S256). Callback 303 -> `weav://auth/callback` with a handoff; exchange through the gateway 200 with `accessToken`/`refreshToken`/`user` in the body, no Set-Cookie, `Cache-Control: no-store`; wrong verifier 401; replayed handoff 401; refresh with the mobile refresh token 200; logout 204. (`/users/me` after logout 401 = expected, session revoked.) The in-app browser pane cannot open `weav://`, so it stays on Google's consent page: that is the hand-over point to the app. |
| W6-A monitoring | PASS: "Giám sát" page numbers consistent (8 runs, 50 %, avg 3.2 s, p95 9.5 s, zero-filled UTC trend, top failing, recent failures), status filter works, console clean. LONG_RUNNING rule (1 s) on test workflow `9d7e5347`: run `6e8913ab` (4.8 s) fired ONE alert via the sweep while still running (alert 18:14:50, run ended 18:14:52); run `ffb4eb93` inside the cooldown fired none (`alert_rule_firings` 1/0, outbox PUBLISHED). Alert visible in the notification center, link opens the run. Dashboard: 10 runs / 40 % failure rate / 4 published = summary. |
| W6-D2 workspace delete | PASS on throwaway workspace `409a2271` ("QA W6 delete test", member +qa2, HTTP connection with a fake API-key credential, published schedule + webhook workflows): danger zone dialog lists consequences, confirm disabled until the name is typed; DELETE 204; workspace DELETED (deleted_at/by set), both workflows PAUSED, both triggers DISABLED, credentials 1 -> 0, one `workspace.deleted` outbox row (for +qa2 only); GET 404, gone from the list, app switched to "QA WS One". |

Follow-ups (low): (1) the sweep-fired LONG_RUNNING message says "kéo dài 1 giây, vượt ngưỡng 1 giây" for a run still in progress; reword to "đã chạy hơn N giây". (2) Monitoring filter `<select>`s are wrapped in a `<label>`, so their accessible name includes every option text; bind label + id instead. (3) workflow-service answers 403 (not 404) for a deleted workspace's workflows (access cache DENIED); harmless, inconsistent with workspace-service. (4) notification-service `test/runtime.integration.cjs` v2 list does not include the two `monitoring.alert.*` types. (5) Flaky: web `workspace-connections.spec.ts:1581` (palette step), gateway e2e 1/130 once.

Left on `dev-k`: workflow `9d7e5347` "QA W6 monitoring alert" (PUBLISHED, manual trigger + httpbin call) and its alert rule `66a2e678`; deleted workspace `409a2271` (soft-deleted rows stay by design).

## 10. Week 6 batch 2 live check (2026-10-09, `week6` 3c74eba, Neon `dev-k`)

Second-stack check first: only Neon `cloud_admin` sessions on `dev-k`, last execution 2026-10-08 18:14Z (the section 9 check). Stack: 7 services (no OCR); Flyway workflow V14 + V15 applied on start. K signed in himself (main account, then the +qa2 account).

| Lane | Live result |
| --- | --- |
| W6-C1/C2 shared templates | PASS. Workflow `497fbbfc` "QA W6-C share test" (manual -> http.request with header + token-like URL -> email.send `to: [literal, mapping]`, `cc: mapping`). Preview/share dialog: removed `fetch.headers`, `send_email.to` (mixed list), variables blanked, `cc` kept; warnings TOKEN (url) + EMAIL (body); share disabled until the review box is ticked; author pre-filled. Shared UNLISTED -> code `ABHG1J5W`; `by-code/ abhg-1j5w ` 200. PRIVATE: by-code 404 (also for the owner), listed under team scope; PUBLIC: found by search, no `shareCode` in list items; UNLISTED: not listed. +qa2 account: "Nhập mã" `abhg-1j5w` -> preview (author, 3 steps, "Cần chọn lại 1 kết nối") -> "Dùng mẫu" -> draft `0b5f35e6` in its own workspace without `to`, `cc` kept, variables blank; `usageCount` 1; non-owner gets no share code. A literal `Authorization` header is already refused at draft save (`CREDENTIAL_FIELD_NOT_ALLOWED`). |
| W6-C3 stop run + run expressions | PASS. Workflow `276b5076` (manual -> data.set with `{{ run.id }}`, `{{ now }}`, `{{ workflow.name }}`, `{{ workflow.id }}` -> 3 x httpbin delay/8 -> data.set). Run `a0ad782f`: "Dừng" -> confirm text -> "Đang dừng…" badge -> running HTTP step finished, the other 3 steps "Không chạy", run "Đã dừng" (14.9 s); DB: status CANCELLED, error `CANCELLED_BY_USER`, `cancel_requested_at` set, 0 notification outbox rows (the successful run `3b6109f7` has its 1). Stop pressed after a run ended -> "Lượt chạy đã kết thúc, không thể dừng." (409). Expressions resolved: run id, ISO UTC time, workflow name and id. |
| Leftovers / follow-ups | ✨ panel pre-fills the signed-in e-mail for the recipient question (PASS). Monitoring filters: accessible names exactly "Khoảng thời gian", "Trạng thái", "Tên quy trình" (PASS). Console/network: only the coordinator's own deliberate test calls errored. |

Bug found (Medium, fixed in `fix/w6-ai-answer-drift`): the ✨ generator re-asked an answered question. The model renamed nodes between turns (`send_email` -> `gui_email`) and answers are keyed `<nodeId>.config.<field>`, so `IntentCompiler.fillAnswers` stopped matching. Two DeepSeek-backed generate calls were used. Fix merged (638d030: an answer whose node id is gone fills the only node with that field empty; the answers header asks the model to reuse ids; workflow-service 977 tests, 1 known env-only error). Re-checked live with the +qa2 account: turn 1 asked the recipient (pre-filled), turn 2 asked only for the Gmail connection (`{code: CONNECTION, field: email.send}`), no repeat. Two more DeepSeek calls (4 in total).

Left on `dev-k`: workflows `497fbbfc` (draft, shared as UNLISTED template `9fcc0b9f`), `276b5076` (published, manual only), `87d8bf8b` (empty draft) in K's workspace; drafts `0b5f35e6` and `a8199b42` in the +qa2 workspace.

## 11. Week 6 W6-B live check (2026-10-10, `week6` d079b3c, Neon branch `dev-k-live-2026-10-10`)

Second-stack check FAILED on `dev-k`: JDBC/pgbouncer sessions to all four databases from another stack (newest ~03:29Z) and runs while this laptop's stack was down (manual 2026-10-09 18:29Z/18:41Z by an unknown user in workspace `af71aa56…`; scheduled "GitHub Zen" workflows at 2026-10-10 01:00Z, workspace `49a2a8ba…`). This laptop's `.env` was confirmed to point every DB host at `dev-k` (not production). K chose a throwaway branch: `dev-k-live-2026-10-10` (br-aged-dawn-b3ric9v3) created from `dev-k`, `.env` hosts repointed for the check only, then restored from `tmp/.env.backup-before-live-branch-2026-10-10`. `.env` also gained `WORKFLOW_WEB_BASE_URL=http://localhost:5173` (`.env.example` already has it empty). Stack: 7 services + cloudflared quick tunnel. Workspace `336d4ae8` (owner QA One; QA Two member). K signed in himself.

| Item | Result |
| --- | --- |
| DISCORD connection | PASS. K pasted a real webhook in the Connections form; ACTIVE after Test; the webhook URL appears in no API response (list, detail) and not on the page. |
| Templates | PASS. The three new built-in templates create correct drafts (email alert without `to`, no connection ids; bot with `sender` and no allow-list). Publishing the bot without `allowedSenders` -> 400 "At least one allowed sender is required for chat commands." |
| Telegram control bot | PASS. `/status QA W6-B nguồn lỗi` (status, last failed run, 7-day rate), `/failures` (5 recent failures, this workspace only), `/run QA W6-B nguồn lỗi` (queued run `26d2831c`, key `wfctl-…`, unmarked), `/help`. With K's id removed from `allowedSenders` the bot answered "Bạn không có quyền điều khiển quy trình."; id restored. |
| Failure alerts (email + Discord) | FAIL, then PASS after a fix. First run: listeners found but every admission failed `InvalidDataAccessApiUsageException` (the finished listener runs in afterCommit; the admission joined the committed transaction and its pessimistic locks failed). Fixed in `fix/w6-b-workflow-event-tx` (merge d079b3c: REQUIRES_NEW per listener admission + afterCommit integration test; workflow-service 1036 tests, 1 known env-only error). Re-run: source `ff8f7aa5` FAILED 04:36:56Z -> "Cảnh báo lỗi qua Discord" `9ba33092` and "Cảnh báo lỗi qua email" `89772033` both WORKFLOW_EVENT, key `wfevent:ff8f7aa5…`, SUCCESS; K received the e-mail (QA One inbox) and the Discord message. |

Notes: QA Two (MEMBER) cannot attach connections created by QA One (existing rule: creator or admin attaches); the check ran as QA One. The workflow "Untitled Automation Pipeline" (`b5533f93`) held the QA Telegram bot and was paused on the throwaway branch only. Known limit: Discord 429 uses the runner's fixed retry schedule.

Left on `dev-k-live-2026-10-10` (throwaway; delete when K agrees): workflows `f66ac254` (source), `c2dba5c5`, `801e7d12`, `d8c56d91`, connection "Test Discord". The QA Telegram bot's webhook still points at the stopped tunnel; republish the bot's workflow on the branch you use next to re-register it.
