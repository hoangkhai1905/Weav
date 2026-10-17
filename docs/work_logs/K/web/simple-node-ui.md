# Simple node UI (settings and data passing)

| Field | Value |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-10-17-simple-node-ui-design.md` |
| Plan | `docs/superpowers/plans/2026-10-17-simple-node-ui.md` (11 tasks, 4 batches) |
| Branch | `feature/simple-node-ui` from `dev` (not merged, not pushed) |
| Status | Batch 1 done and reviewed (2026-10-17); Batches 2-4 and Task 11 not started |

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
- Left on dev-k: draft workflow "Live check Batch 1" (`beb3ab7c-…`) in the test account's workspace `adaea5f1-…` (delete when convenient).
- Findings for later batches: palette wording ("Lịch / Cron", "biểu thức cron", "JSON có cấu trúc", Gmail send "Gửi thông báo đến các kênh"), "ID lịch", "Nội dung (body)", publish blocker text "Node HTTP request cần URL" (Batch 3); the old "Chèn biến" bar (Batch 2); delete button accessible name "Xóa bước calendar_1" exposes the raw id; email body shows `*` although a blank body publishes.

Deferred minors listed in the ledger (formatter pass on `handField` wrappers, stricter Task 1 test messages, checkbox `aria-required`, a test for "a later value reopens a closed section").

## Next

Batch 2 (Tasks 5-7: data menu, one data path everywhere, output labels), then Batch 3 wording, then Task 11 (journey test, stale specs, live check). Merge into `dev` only on K's go-ahead.
