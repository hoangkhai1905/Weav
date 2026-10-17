# Simple node UI (settings and data passing)

| Field | Value |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-10-17-simple-node-ui-design.md` |
| Plan | `docs/superpowers/plans/2026-10-17-simple-node-ui.md` (11 tasks, 4 batches) |
| Branch | `feature/simple-node-ui` from `dev` (not merged, not pushed) |
| Status | Batches 1-2 done, reviewed and live-checked (2026-10-17); Batch 3-4 and Task 11 not started |

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

## Next

Batch 3 wording (Tasks 8-9; include the Batch 2 live-check wording findings above), then Task 11 (journey test, stale specs, live check). Merge into `dev` only on K's go-ahead.
