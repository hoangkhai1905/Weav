# Node polish: Sheets lookup, Calendar list, Telegram options, AND/OR condition (Week 4, lane F4)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-06 (Asia/Saigon) |
| Branch | `feat/wk4-f4-node-polish` (from `staging`), merged into `staging` after F1 |
| Owner | K / Sonnet worker, coordinator reviews and commits |
| Status | Done, reviewed (1 round), merged. Live test pending (lane F5 adds the flows to `scripts/live-test-nodes.ps1`) |
| Scope | `google.sheets`, `google.calendar`, `telegram.send_message`, `logic.condition` (workflow-service, `packages/workflow-schema`, `packages/contracts`). Spec: `docs/superpowers/specs/2026-10-06-email-attachments-design.md`, "Other node polish" |

## 2. Config contracts (all additive; every old config is valid and behaves as before)

- `google.sheets`: `operation` `read | append | update | lookup`. `valueInputOption` `RAW | USER_ENTERED` for append/update (absent = `RAW`, as before). Lookup: `lookupColumn` (letters `A`-`ZZZ`), `lookupValue` (string, number or boolean), `limit` (1-100, default 10). Output `{range, rows: [{row, values}], count, truncated}`; `row` is the 1-based sheet row. Exact text match; booleans match case-insensitively (checkbox cells show `TRUE`).
- `google.calendar`: `operation` `create | list` (absent = create). List: `calendarId` (default primary), `timeMin` (default now), `timeMax`, `maxResults` (1-50, default 10), `query`; a date without a time means midnight UTC. Output `{events: [{id, summary, start, end, location, htmlLink, status}], count, truncated}`; `start`/`end` carry `dateTime`, `date`, `timeZone`. No attendees or description.
- `telegram.send_message`: `parseMode` `none | HTML | MarkdownV2`, `disableNotification` (boolean or "true"/"false"), `replyToMessageId` (positive integer). Sent only when set; reply uses `reply_parameters` with `allow_sending_without_reply: true`.
- `logic.condition`: old `{left, operator, right}` or `{combinator: and|or, conditions: [{left, operator, right}] (1-10)}`; mixing is rejected. Ports `true`/`false`, output `{value}`; short-circuit evaluation.

## 3. Decisions

| Decision | Reason |
| --- | --- |
| Lookup addresses columns by letter, row numbers come from the range Sheets returns | `read` returns raw arrays without headers; works for `Sheet1!A2:C`, bare and quoted sheet names |
| Schema `required` loosened (`logic.condition` `[]`, `google.calendar` `["connectionId"]`); `DefinitionValidator` enforces the old requirements per form/operation with the same codes | JSON Schema loader has no conditional `required`. Nothing reads `required` today; FE handover must say requiredness depends on form/operation |
| Numeric template fields are `oneOf [integer with bounds, string]`; literal strings are checked at draft save (`INVALID_FIELD_TYPE`), templates at run time by the executors | Mapped values survive run-time re-validation |
| Blank `parseMode`, `valueInputOption`, calendar `operation` count as unset | Matches executor tolerance (review LOW) |
| New validator codes: `CONDITION_FORM_CONFLICT`, `INVALID_CONDITIONS`, `INVALID_CONDITION_COMBINATOR`, `INVALID_LOOKUP_COLUMN`, `INVALID_ENUM_VALUE` | Paths like `config.conditions[0].operator` |
| Telegram 400 "can't parse entities" with a `parse_mode` -> `CONFIGURATION_ERROR` (non-retryable, fixed message, no text echoed) | Without parse_mode the old classification stays |
| Calendar list over-fetches `maxResults + 1` to set `truncated` | One call |
| Calendar list needs GET on the events path in `PinnedHttpTransport` | Added by lane F1 (merged first) |

## 4. Checks

| Check | Result |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (lane worktree, before merging staging) | 715 tests, 0 failures, 1 error: known env-only notification-dist test |
| Review (java-reviewer) | No HIGH/CRITICAL. Confirmed backward compatibility on draft/publish/generation/runtime paths and nested template resolution (`MappingResolver` recurses). Fixed: end-to-end resolution test (`ExecutionRunnerTest`), blank enums, literal numeric/boolean checks, boolean lookup case, UTC wording |
| `git diff --check` | Clean |

Not tested yet: live calls (Sheets lookup, Calendar list, Telegram parse mode/reply) — lane F5 live-test flows.

## 5. Follow-ups

- Lane F5: `GENERATE_SYSTEM` and assistant help text (multi-condition form, new operations), live-test flows, FE handover of these contracts.
- Accepted LOWs: lookup reads the sheet before checking the column against the range start; a date-only `timeMin` is UTC midnight.
