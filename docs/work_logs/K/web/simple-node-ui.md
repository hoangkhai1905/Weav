# Simple node UI (settings and data passing)

| Field | Value |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-10-17-simple-node-ui-design.md` |
| Plan | `docs/superpowers/plans/2026-10-17-simple-node-ui.md` (11 tasks, 4 batches) |
| Branch | `feature/simple-node-ui` from `dev` (not merged, not pushed) |
| Status | Tasks 1-9 and 11 done, reviewed and live-checked (2026-10-18); whole-branch review clean; ready to merge into `dev` on K's go-ahead. Task 10 (sample values, optional) not started |

## Batch 1 — Foundation (2026-10-17)

Executed subagent-driven: a fresh Sonnet implementer per task, a different Sonnet reviewer per task, then one whole-batch review and one fix wave. Ledger with every ruling: `.superpowers/sdd/2026-10-17-simple-node-ui/progress.md` (git-ignored).

| Task | Commits | Result |
| --- | --- | --- |
| 1 `x-weav-ui.advanced` schema keyword (backend accepts/validates/ignores; never on a required field; `isAdvanced()` in web) | `020a3995` | review clean; workflow-service `mvnw verify` 1167/0 |
| 2 `fieldCopy`, `hasValueOrError`, `FieldShell`, `AdvancedSection`; schema forms; calendar `location` advanced | `bbfafcf4` | review clean |
| 3 hand-written step forms through `FieldShell`; email/telegram/http "Thêm tùy chọn"; node id in "Chi tiết kỹ thuật" | `85617b65`, `9501e975` | 1 fix round (OCR + Google forms, tests) |
| 4 plain-language publish errors and readiness ("Bước '…': cần điền '…'", "Cần điền: …"); publish errors open their advanced section; one label per field | `4a620dd6`, `b500b97b`, `12c4d55f`, `48808898` | 3 fix rounds (label source, email reply subject, variant labels, Telegram duplicate label) |
| Batch review fixes: advanced section stays open after clearing, Gmail recipient label, hints only from `_hint` keys (no English schema text in vi), unnamed steps use the step type name | `7a19aacc` | re-review: all addressed |

Decisions worth knowing:
- Labels and hints come from i18n `builder.field.<type>.<name>` / `_hint`; schema titles stay English for developers and the AI generator. Until Batch 3 adds `_hint` keys, fields without one show no hint (never an English one).
- Readiness: required fields = schema `required` ∪ conditional rules, but fields a conditional rule owns (email subject on reply, drive/calendar/format conditional fields) follow the rule only, so readiness is never stricter than the server.
- Telegram/Gmail: when the reply-target select is shown, the free-text field is labelled "Cuộc trò chuyện khác" / "Địa chỉ người nhận"; errors keep "Gửi tới".

Checks: `apps/web/e2e/simple-node-ui.spec.ts` 18/18; builder specs (`workflow-ui` http mode, `builder-correctness`, `ocr-builder`, `w7-nodes`) have identical failing test names before and after every task (39 pre-existing on `dev`: workflow-ui 25, builder-correctness 1, ocr-builder 13); `tsc -p tsconfig.app.json` clean; web build OK; eslint only the pre-existing set-state-in-effect error in `WorkflowBuilderPage.tsx` (~692).

Live check (2026-10-17, in-app browser, dev stack on Neon dev-k, 7 services without OCR, workflow-service rebuilt; local live-test account from `tmp/live-test-account.txt`): PASS.
- Calendar step: "Thêm tùy chọn (1)" and "Chi tiết kỹ thuật" collapsed; "Địa điểm" stays open after typing and clearing; readiness "Cần điền: Tiêu đề, Bắt đầu, Kết thúc"; node id only in the footer.
- HTTP step: "Phương thức*", "URL*", per-field "Chèn dữ liệu", "Thêm tùy chọn (3)", readiness "Cần điền: URL", no English hints.
- Gmail trigger -> email: target select "Gửi tới*", custom field "Địa chỉ người nhận"; readiness "Cần điền: Gửi tới, Tiêu đề".
- English: "More options (3)", "Technical details", "Fill in: Send to, Subject", "Recipient address"; no `builder.` keys leaked.
- Console errors: none; API calls all 200/204.
- Not reachable live: a server-side publish error (the client blocks publish first); covered by the stubbed Playwright cases.
- Left on dev-k: draft workflow "Live check Batch 1" (`beb3ab7c-…`) in the test account's workspace `adaea5f1-…` — soft-deleted 2026-10-17 via `DELETE /workflows/{id}` (204).
- Findings for later batches: palette wording ("Lịch / Cron", "biểu thức cron", "JSON có cấu trúc", Gmail send "Gửi thông báo đến các kênh"), "ID lịch", "Nội dung (body)", publish blocker text "Node HTTP request cần URL" (Batch 3); the old "Chèn biến" bar (Batch 2); delete button accessible name "Xóa bước calendar_1" exposes the raw id; email body shows `*` although a blank body publishes.

Deferred minors listed in the ledger (formatter pass on `handField` wrappers, stricter Task 1 test messages, checkbox `aria-required`, a test for "a later value reopens a closed section").

## Batch 2 — Data passing (2026-10-17)

Same process as Batch 1 (Sonnet implementer per task, a different Sonnet reviewer, scoped re-reviews, one Sonnet whole-batch review, one fix wave). Rulings are in the ledger and in the session report.

| Task | Commits | Result |
| --- | --- | --- |
| 5 `DataMenu`: nearest upstream step first (BFS over predecessors), search when > 8 items (diacritic-insensitive), "Khác" run values, named input for manual/webhook triggers, chip "<bước> › <dữ liệu>", amber orphan chip that keeps the saved value | `15a5e54e`, `8a24349e`, `43330417` | 1 fix round (connections-spec chip text, edge-removal orphan test, unnamed steps show their type instead of their id) |
| 6 every `x-weav-template` field gets its own "Chèn dữ liệu"; "Insert variable" bar, `VariablePicker`, `useFieldTarget` removed; number fields get "Dùng dữ liệu từ bước trước"; hand-written fields pass `required={isMarkedRequired(...)}` | `39da6f57`, `b09deff0` | 1 fix round (number data mode over a typed number) |
| 7 `builder.var.path.<type>.<path>` vi+en for every catalog and per-operation output (89 added, 29 reworded); tests for banned words and leaked `builder.` keys | `f9e17714`, `77fd7c90`, `90afbc53`, `924025fb` | 3 fix rounds (Telegram hint, "Transaction ID", leak-test strength, `tsc -b` on e2e) |
| Batch review fixes: deeper paths under a listed output are not "gone", ticking data mode clears a typed number, data mode survives removing the chip, button name "Chèn dữ liệu vào <nhãn>", named-input hint, "no match" line, `weav.workflow` fields in ControlBotInspectors get data; Batch 2 regressions in `workspace-connections.spec` (cc saved shape restored to pre-batch, reworded label assertions) | `782ebec6`, `67b3a9e5` | re-review: all 10 addressed |

Decisions worth knowing:
- OCR inline inputs and Google Docs inputs keep their own pickers (not `x-weav-template`); boolean/enum fields still have no data switch.
- A string-or-list field saves a list only when the schema type is array or the stored value is already a list (pre-batch behaviour; `workspace-connections` 1873 proves it).
- The builder has no in-page language control; the leak test switches language through the stored setting plus a reload.

Checks: `simple-node-ui.spec.ts` 36 tests pass at `67b3a9e5` (33 checked by the controller at `924025fb`); `workspace-connections`, `control-bot`, `w7-nodes` show only pre-existing failures (workspace-connections 463, 576, 1200, 1687; 1581 flaky); `tsc -p tsconfig.app.json` clean; `pnpm --dir apps/web build` OK; eslint only the pre-existing set-state-in-effect error; GitNexus index refreshed, `detect-changes` risk "critical" is name matching on common identifiers (`paths`, `config`).

Live check (2026-10-17, in-app browser, dev stack on Neon dev-k, 7 services without OCR; local live-test account): PASS.
- Manual trigger -> "Tóm tắt bằng AI" -> "Gửi tin nhắn Telegram" (workflow "Live check Batch 2", `5347c47e-…`).
- AI step: each field has its own "Chèn dữ liệu" (accessible name "Chèn dữ liệu vào Văn bản cần tóm tắt*"); "Độ dài tối đa" switch "Dùng dữ liệu từ bước trước" turns it into a data field and back.
- Named input: "ten khach" shows the hint and keeps "Chèn trường" disabled; "ten_khach" inserts chip "Dữ liệu kích hoạt › Ten khach", saved as `{{ trigger.input.ten_khach }}`.
- Telegram message menu: "Tóm tắt bằng AI" group first, then "Dữ liệu kích hoạt", then "Khác"; "Chèn nhanh: + Bản tóm tắt"; chip "Tóm tắt bằng AI › Bản tóm tắt".
- Removing the AI -> Telegram link: chip turns amber "Dữ liệu này không còn — chọn lại"; saved draft has no such edge and keeps `{{ nodes.summarize_1.output.summary }}`; reconnecting turns the chip back to normal.
- English: "Insert data", "Fill in: Send to", chip "Tóm tắt bằng AI › Summary", menu "Trigger data / Incoming data / Other"; no `builder.` keys. Console errors none; API calls all 200/204.
- Not checked live: search (needs a trigger with > 8 outputs connected; covered by Playwright).
- Left on dev-k: draft workflow "Live check Batch 2" (`5347c47e-…`) in workspace `adaea5f1-…` — soft-deleted 2026-10-17 via `DELETE /workflows/{id}` (204).
- Findings for Batch 3 wording: EN "Run id" / "Workflow id" and "Current time (UTC, ISO 8601)" in the "Khác/Other" group (banned "id", jargon); `builder.cfg.tg_target_custom` "chat ID"; publish banner "Bước summarize_1: AI Summarize cần …" shows a raw step id and English node name; the data menu near the bottom of the inspector is partly hidden behind the footer; the button's accessible name includes the `*` marker.

Deferred minors (ledger): `role="menu"` holds inputs; group headings have no step icon; `fileSources` now nearest-first (OCR auto-pick); test hygiene (xpath `../..`, leak test opens the builder twice, orphan edge-click flake).

## Batch 3 - Task 8: triggers, messaging and HTTP wording (2026-10-18)

- Plain names and one-sentence descriptions for the 13 nodes (manual, schedule, webhook, Telegram/Gmail/workflow triggers, email, Telegram, Discord, Slack, Teams, HTTP, control workflows); every field of those nodes has a label (4 words or fewer, no ID/JSON/cron/payload/node/config), a hint and a realistic example (`builder.field.<type>.<name>[_hint|_example]`, vi + en).
- Schema `x-weav-ui.advanced` added: email (cc, bcc, replyTo, senderName, replyToMessageId, attachments), Telegram (parseMode, disableNotification, replyToMessageId), Gmail trigger (query, pollIntervalMinutes), HTTP (connectionId, headers, query), Discord username, Teams title. Hand-written lists equal the flags (EMAIL_ADVANCED gained cc, bcc, attachments; the attachments editor now sits under Thêm tùy chọn).
- Hand-written text fields take their placeholder from the same `_example` key as SchemaField (one copy source); old `builder.cfg.*_placeholder` keys stay in the file.
- Fixed live-check findings: Gmail send description, manual trigger description, "Nội dung (body)", "chat ID", blockers that started with "Node", output labels (scheduledAt, durationMs, weav.workflow items[0].finishedAt).
- Tests: `wording: triggers and messaging` and `flagged fields of triggers and messaging sit under Thêm tùy chọn` in simple-node-ui.spec.ts; `inspectFields` / `expectPlainWording` are reusable for Task 9.

## Batch 3 - Task 9: Google, logic, data, format, AI and OCR wording (2026-10-18)

- Plain names/descriptions for the 13 nodes (e.g. ai.extract -> Lấy thông tin bằng AI, switch -> Chia nhánh theo giá trị, ocr -> Đọc chữ từ tệp) and label/hint/example (vi + en) for every field; blockers, messages and help-page names without Node/ID/JSON/prompt.
- Schema x-weav-ui.advanced: sheets limit, valueInputOption; drive mimeType, folderId, pageSize; calendar calendarId, description, timeZone, attendees, sendInvitations, maxResults, query (+ location); format.datetime locale; format.text separator, decimals, locale; ai.extract/generate instructions; ai.summarize/generate maxLength; ocr language, detectTables. format.datetime timezone stays visible (convert needs it). Calendar create shows 4 fields before Thêm tùy chọn.
- Hand-written blocks fold with sheets-advanced, ai-advanced, ocr-advanced; CommaListInput now uses FieldShell (hint + example); collectWordingProblems (renamed from expectPlainWording) checks a per-step minimum field count.
- Tests: wording: google, logic, ai, ocr; Calendar create at most four fields; flagged fields test. Existing specs updated for reworded EN names (OCR step is now Read text from a file) and folded fields.
- control-bot.spec 137 (Discord username folded) and 149 (reworded input-format error) were Task 8 regressions; fixed in the Task 9 fix round (`c3764a4e`).

## Batch 3 — review, fix wave, gate, live check (2026-10-18)

Same process as Batches 1-2 (Sonnet implementer per task, a different Sonnet reviewer, scoped re-reviews, one Sonnet whole-batch review, one fix wave). Rulings are in the ledger and in the session report.

| Task | Commits | Result |
| --- | --- | --- |
| 8 triggers, messaging, HTTP, control workflows | `64020bc1` | review clean |
| 9 Google, logic, data, format, AI, OCR | `4939d9d8`, `c3764a4e` | 1 fix round (4-word check typo `/s+/`, 5-word labels, `{{ }}` in OCR hint/placeholder, control-bot regressions) |
| Batch review fixes: hints name the real "Chèn dữ liệu" button; error texts match the new names (switch, condition, custom schedule, set data); no `{{ }}` in placeholders/blockers/errors; palette search matches name, description and node type ("http", "ocr", "switch" find the renamed steps); copy minors (Thao tác, Ai được ra lệnh, help-page names); advanced-section counts from named constants; Playwright scan of `builder.node/blocker/err/cfg.msg_*` in vi+en for `{{` and banned words (allowlist empty) | `c93037c5` | re-review: all 7 addressed |

Checks: `simple-node-ui.spec.ts` 43 pass, `control-bot` 10/10, `w7-nodes` 8/8; localization 6, workspace-connections 5 (463, 576, 1200, 1581, 1687), builder-correctness 1 (63), ocr-builder 13 and workspace-read-switch 6 fail with the same names as before the batch (workspace-read-switch asserts workspace copy the batch never touched). workflow-service `mvnw verify` OK at `c3764a4e` (fix wave touched no schema); `pnpm --dir apps/web build` OK at `c93037c5`; `git diff --check 751cd971..HEAD` clean.

Live check (2026-10-18, in-app browser, dev stack, 7 services without OCR, local live-test account): PASS.
- Palette (vi): 26 plain names + descriptions; search "http" -> Gọi dịch vụ web, "ocr" -> Đọc chữ từ tệp, "switch" -> Chia nhánh theo giá trị, "lịch" -> Chạy theo lịch. Template cards use the new names.
- Draft from template "Báo cáo định kỳ qua Telegram": Telegram step shows Kết nối bot Telegram / Gửi tới / Nội dung tin nhắn with hints and "Ví dụ:" placeholders; Thêm tùy chọn (3) holds Kiểu định dạng, Gửi im lặng, Trả lời tin nhắn. HTTP step: Phương thức, URL (địa chỉ web), Nội dung visible; Thêm tùy chọn (3) holds Thông tin gửi kèm, Tham số trên địa chỉ, Kết nối HTTP. Schedule step: Lặp lại, Tự nhập lịch (nâng cao), Giờ chạy, Múi giờ — no "cron" label.
- Google Calendar step added from the palette: create shows Thao tác, Tiêu đề, Bắt đầu, Kết thúc before Thêm tùy chọn (6).
- English (stored language + reload): "More options (3)", "Insert data", "e.g. …" placeholders, palette "Call a web service", "Read text from a file", "Branch by value", "Pull details with AI". No `builder.` keys; console errors none.
- Draft `d65af5f1-…` in workspace `adaea5f1-…` deleted through the app (DELETE 204, GET 404). Containers stopped, Vite stopped.
- Seen, not fixed (polish): Calendar node name "Tạo hoặc xem sự kiện Google Calendar" is long for a step title; HTTP headers/query editors have no hint line (composite editors, per ruling).

Deferred minors (ledger): `telegram_trigger_hint` shows the env-var name (reword before deploy); hex/UUID example values; wording test is vi-only (en length unchecked); `msg_ocr`/`retry_ocr` say "OCR"; `hp.help.trigger.schedule.text` explains cron syntax (custom mode only).

## Task 11 — journey, stale specs, whole-branch review, live check (2026-10-18)

Same process (Sonnet implementer, a different Sonnet reviewer, scoped re-reviews, one Sonnet whole-branch review of `cf7f7578..HEAD`, one fix wave). Rulings are in the ledger and the session report.

| Work | Commits | Result |
| --- | --- | --- |
| Live-check polish: publish blockers name the step by its display name (`stepName` in `nodeLabels.ts`, shared with the builder's step label; `{id}` kept and quoted); "+ Dữ liệu" button name without the `*` marker; data menu scrolls into view above the inspector footer; plain `telegram_trigger_hint` (no env-var name); calendar step "Quản lý lịch Google" / "Manage Google Calendar" | `52ea4e30` | review: spec ✅ |
| Journey test `first-time user: new Gmail -> Telegram without typing {{`; stale specs moved to the redesign copy (localization 5 cases, dashboard quick links, builder-correctness card, workspace-connections provider) | `2a53ac6b`, `756887cb` | — |
| Fix round 1: journey asserts both mappings on the draft that publish sends (publish has no body) and polls; data-menu test shown RED without the fix; dashboard test rewritten to the v2 dashboard (counts, recent runs, no demo data), manual-run-failure test deleted (v2 dashboard has no run action) | `0bc97251` | re-review: all 3 addressed |
| Whole-branch review (`cf7f7578..0bc97251`): ready to merge, 0 Critical, 0 Important, 8 Minor. Fix wave: `$`-safe replacers for step names, no raw id when a step is not on the canvas (`builder.err.unknown_step`), plain labels (no ID/ISO 8601/node in `builder.var.*`, Google Docs, OCR errors, `no_logs`), wording test scans `builder.var.*`, test polish | `21911a77` | re-review: all 5 addressed |
| Live-fix: "Thêm tùy chọn" opened by itself on a brand-new step because the builder seeds defaults (Gmail check interval 5, AI summary length 200, OCR language/tables). `hasValueOrError` now ignores a value equal to the seeded or schema default; a user-set value or an error still opens it | `1a229c2e` | review: Approved |

Checks:
- Full web Playwright suite (`--project=chromium`), compared by test title with a `dev` baseline run (`cf7f7578`, throwaway detached worktree): `dev` 281 passed / 84 failed; branch at `0bc97251` 337 passed / 74 failed, 0 new failures, 10 `dev` failures fixed. Final run at `1a229c2e`: 339 passed, 2 skipped, 75 failed = the same 74 `dev` failures + "no builder. keys leak in either language" (240 s timeout under full-suite load; passes alone, 2/2 in 28 s).
- The 74 remaining failures all fail on `dev` with the same title and are not caused by this branch: workflow-ui 25 (shell/topbar/list/builder selectors removed by dev's v2 redesign `d57ffae8`), ocr-builder 13, workflow-catalog-v1 7, ai-builder 2 (pre-redesign builder selectors), password-recovery 8 (v2 auth screens), workspace-read-switch 6, workspace-connections 4, workspace-members 1 (workspace copy/ids), executions-live 3, workflow-api-v1 1, request-budget 1 (run history/detail copy), localization 1 (mock workflow id in http mode), notification-integration 1, notification-task10-live 1 (needs a live Identity URL).
- workflow-service `mvnw verify` exit 0 (Task 11 touches no backend); `tsc -p tsconfig.app.json` OK; `pnpm --dir apps/web build` OK (chunk-size warning only); `git diff --check cf7f7578..HEAD` clean; eslint on the branch's changed files: one pre-existing error (`WorkflowBuilderPage.tsx:702` set-state-in-effect, same line on `dev`).

Live check (2026-10-18, in-app browser, dev stack 7 services without OCR, local live-test account): PASS.
- Journey by hand (vi): blank draft, "Nhận email Gmail mới" and "Gửi tin Telegram" from the palette, the account's existing Gmail and Telegram connections picked (none created here), a literal chat number typed, "Tiêu đề thư" and "Người gửi" inserted from "Chèn dữ liệu". Chips read "Dữ liệu kích hoạt › Tiêu đề thư". The saved draft (PUT `/draft` 200) holds `{{ trigger.input.subject }}{{ trigger.input.from }}` and the Gmail → Telegram edge; both steps "Sẵn sàng"; "Xuất bản" enabled with no blockers. Publish was not clicked: it would start a live Gmail poller that sends real Telegram messages (left to K).
- Data menu opens fully above the inspector footer; data button names "Insert data into Send to" / "… Message" (no `*`).
- English (stored language + reload): "Telegram bot connection", "Send to", "Message", "Insert data", "More options (3)", chips "Trigger data › Subject"; no raw paths in the inspector outside "Technical details".
- Unconfigured "Summarize with AI": banner "Step 'Summarize with AI': the Summarize with AI step needs text to summarize" (no step id).
- After the live-fix: a fresh Gmail step shows "Thêm tùy chọn (2)" closed.
- Network: API calls 200/204; one 403 console line from an earlier page load, none after builder reloads.
- Draft `304b033d-…` deleted through the API (DELETE 204, GET 404); Vite and containers stopped.
- Seen, not this feature: a blank draft starts with a manual trigger; adding the Gmail trigger leaves it on the canvas, unconnected.

Deferred / parked (ledger): DataMenu `role="menu"` keyboard pattern; long e2e timeouts (one "no builder. keys leak" timeout under load, passes alone); `handField` indentation; calendar `timeZone` stays advanced; no test for "error on a default-valued field still opens"; two steps with the same display name give the same blocker text.

## Feature summary (for the thesis report)

Goal: a person who has never used an automation tool opens a step in the builder and knows what to fill in and how to use data from earlier steps, without docs and without the `{{ }}` syntax. Same power, clearer: no node removed, no config field renamed, saved workflows and templates load and publish unchanged.

What changed (38 commits, 51 files, `cf7f7578..1a229c2e`):
1. **Schema hints (`x-weav-ui`)**: node schemas in `packages/workflow-schema` mark optional fields a first-time user can skip as `advanced`; workflow-service accepts and ignores the keyword (additive, tested in `NodeConfigSchemasTest`); a required field is never advanced.
2. **One field shell**: every field shows a plain label (4 words or fewer, no ID/JSON/cron/payload/node/config), a one-sentence hint and a realistic "Ví dụ:" placeholder, all from `builder.field.<type>.<name>` keys in vi and en. Advanced fields sit in one collapsed "Thêm tùy chọn (N)" section that opens by itself only when it holds a user value or an error.
3. **Data without syntax**: each text field has a "Chèn dữ liệu" button that opens a searchable menu of earlier steps' outputs with plain names ("Tiêu đề thư", "Người gửi"); picking one inserts a chip. Chips pointing at a deleted or no-longer-earlier step turn amber ("Dữ liệu này không còn — chọn lại") and the saved value is kept.
4. **Plain errors and readiness**: publish errors and blockers name the step by its display name and the field by its label, in the current language; required markers follow the same readiness rules as the "Cần điền" list.
5. **Plain wording for all 26 nodes**: names as verb + object ("Gửi tin Telegram", "Lấy thông tin bằng AI"), one-sentence descriptions, palette search by name, description or technical type.

Quality process: per task a Sonnet implementer, a different Sonnet reviewer, scoped re-reviews of each fix round, one whole-batch review per batch and a final whole-branch review, then a live check in the running app per batch. Every decision taken without the user is a "Ruling:" line in the ledger and in the session reports.

Evidence: `simple-node-ui.spec.ts` (journey, wording scans in vi and en, Review Focus 1-5: advanced values not hidden, amber chips for deleted steps, mappings in number fields round-trip, unknown-field errors fall back to readable names, language switch leaks no `builder.` keys); workflow-service `NodeConfigSchemasTest`; live checks after Batches 1, 2, 3 and Task 11.

## Next

- K: decide the merge into `dev` (`git merge --no-ff feature/simple-node-ui`); optionally publish the journey workflow once with real accounts.
- Follow-up: repair the ~70 Playwright specs that fail on `dev` since the v2 UI redesign (separate test-maintenance task).
- Optional Task 10 (sample values from the latest run).
