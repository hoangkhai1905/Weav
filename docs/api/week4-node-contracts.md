# Week 4 node contracts (frontend handover)

Source of truth: `packages/workflow-schema/nodes/*.json`, `docs/work_logs/K/workflow/attachments.md` and `node-polish.md`, spec `docs/superpowers/specs/2026-10-06-email-attachments-design.md`. All changes are additive: every old config stays valid.

## Rules that apply to every node below

- `required` in the JSON schemas was loosened for `logic.condition` and `google.calendar`. The server validator (`DefinitionValidator`) enforces requiredness per form or operation, so the UI must apply the same conditional rules (listed per node).
- Fields marked "template" accept `{{ ... }}` mappings. Numeric/boolean template fields are `oneOf [typed value, string]`: a literal string is checked at draft save (`INVALID_FIELD_TYPE`), a template at run time.
- Templates resolve dotted paths. A list item is picked with `[n]` or `.n` (n = 0..9999, no leading zero; `{{ trigger.input.attachments[0].fileId }}`, `{{ nodes.x.output.rows[2].values[0] }}`); an out-of-range index is a run-time mapping error. A whole expression (`"{{ trigger.input.attachments[0] }}"`) keeps the native type: the item itself (here the file reference), or the whole list without an index. `[n]` must follow a property name (`output[0]` directly after the node's `output` is not supported).
- File features need the file store (`WORKFLOW_FILES_S3_*` configured on workflow-service). Without it the nodes fail with `DEPENDENCY_NOT_CONFIGURED` (trigger: attachment `skipped: "not_stored"`).

## File reference

`{fileId, filename, mimeType, size}`, produced by `trigger.gmail` (one per stored attachment) and consumed by `email.send` `attachments` (`{fileId, filename?}`) and `google.drive` `file`. Files are workspace-scoped (another workspace's id behaves as unknown), kept 7 days, and never contain bytes in the run data.

| Limit | Value |
| --- | --- |
| Attachments per email | 5 usable (100 listed items scanned) |
| Size per attachment | 10 MiB |
| Total per email | 20 MiB |
| Drive upload from a file | 5 MiB |
| Drive upload with `content` | 512 KiB |
| Retention | 7 days |

## email.send

| Field | Type | Notes |
| --- | --- | --- |
| `to` (required), `subject` (required), `body` (required), `connectionId` (required) | as before | unchanged |
| `cc`, `bcc`, `replyTo` | string or string[] (template) | optional; to+cc+bcc share the existing maximum recipient count |
| `bodyType` | `text` (default) or `html` | |
| `senderName` | string, max 100 (template) | display name in From; address stays the connected account |
| `replyToMessageId` | string (template) | Gmail message id; email joins that thread. A blank `subject` becomes `Re: <original subject>` |
| `attachments` | list of `{url, filename?}` or `{fileId, filename?}`, max 5; or a template resolving to such a list | `url` must be a public http(s) file (no redirects, no private hosts). Items with neither `fileId` nor `url` are skipped and counted |

Output: `{messageId, threadId?, status: "SENT"}` plus `attachmentCount` (when attachments are configured) and `skippedAttachments` (when > 0).
New error codes (non-retryable): `ATTACHMENT_LIMIT_EXCEEDED`, `ATTACHMENT_TOO_LARGE`, `REPLY_MESSAGE_NOT_FOUND`; also `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `DEPENDENCY_NOT_CONFIGURED`; `FILE_STORE_UNAVAILABLE` is retryable.

## trigger.gmail

Config unchanged (`connectionId` required, `query` max 500, `pollIntervalMinutes` 1-1440 default 5). Run input (`{{ trigger.input.<field> }}`): `messageId`, `threadId`, `from`, `to`, `cc`, `subject`, `date`, `snippet`, `body`, `bodyTruncated`, `bodyOmitted`, `labelIds`, and new `attachments`: `[{filename, mimeType, size, fileId?, skipped?}]` (always present, possibly empty). `skipped` is `limit` | `too_large` | `not_stored` | `error`; a skipped item has no `fileId`. Needs a connection with read access (reconnect older ones: `CONNECTION_RECONNECT_REQUIRED`).

## google.drive

| Field | Type | Notes |
| --- | --- | --- |
| `operation` | `upload` or `list` | required |
| `file` | file reference object or template (new) | upload only; use instead of `content`. `name` and `mimeType` default to the file's own |
| `content` | string, max 512 KiB | upload; give `content` or `file`, not both (`CONFIGURATION_ERROR`) |
| `name` | string | required for upload with `content`; optional with `file` |
| `mimeType`, `folderId`, `nameContains`, `pageSize` | as before | `pageSize` at most 100 |

Neither `content` nor `file` still uploads an empty file (backward compatible). Errors: `FILE_TOO_LARGE`, `FILE_NOT_FOUND`, `DEPENDENCY_NOT_CONFIGURED`. Example: `file: "{{ trigger.input.attachments[0] }}"` uploads the first email attachment.

## google.sheets

| Field | Type | Notes |
| --- | --- | --- |
| `operation` | `read`, `append`, `update`, `lookup` (new) | required |
| `spreadsheetId`, `range` | string (template) | required |
| `values` | rows | required for append and update |
| `valueInputOption` | `RAW` (default) or `USER_ENTERED` | append and update |
| `lookupColumn` | column letters `A`-`ZZZ` (template) | lookup, required; must lie inside `range` |
| `lookupValue` | string, number or boolean (template) | lookup, required; exact match on displayed text, booleans case-insensitive |
| `limit` | integer 1-100 (or template), default 10 | lookup |

Lookup output: `{range, rows: [{row, values}], count, truncated}` (`row` is the 1-based sheet row). Errors: `INVALID_LOOKUP_COLUMN`, `INVALID_ENUM_VALUE` (draft validation codes).

## google.calendar

| Field | Type | Notes |
| --- | --- | --- |
| `operation` | `create` (default) or `list` (new) | |
| `connectionId` | required | create additionally requires `summary`, `start`, `end` |
| `calendarId` | string, default primary | both operations |
| `timeMin` | RFC 3339 date-time with offset, or date | list; default now; a date means midnight UTC |
| `timeMax` | same format, after `timeMin` | list; optional |
| `maxResults` | integer 1-50 (or template), default 10 | list |
| `query` | string | list; matches title, description, location |

List output: `{events: [{id, summary, start, end, location, htmlLink, status}], count, truncated}`; `start`/`end` carry `dateTime`, `date`, `timeZone`. No attendees or description.

## telegram.send_message

| Field | Type | Notes |
| --- | --- | --- |
| `parseMode` | `none` (default), `HTML`, `MarkdownV2` | a bad entity with a parse mode gives `CONFIGURATION_ERROR` (non-retryable) |
| `disableNotification` | boolean or `"true"`/`"false"` (template), default false | silent message |
| `replyToMessageId` | positive integer or template | same chat; a missing original does not fail the send |

`connectionId`, `chatId`, `text` stay required.

## logic.condition

Two mutually exclusive forms (mixing gives `CONDITION_FORM_CONFLICT`):

| Form | Config | Required |
| --- | --- | --- |
| Single | `left`, `operator` (`eq ne gt gte lt lte`), `right` | all three |
| Multi (new) | `combinator` (`and` / `or`), `conditions`: 1-10 objects `{left, operator, right}` | both; each condition needs all three (`INVALID_CONDITIONS`, `INVALID_CONDITION_COMBINATOR`, paths like `config.conditions[0].operator`) |

Ports stay `true` / `false`; output `{value}`; evaluation short-circuits. Ordering operators need numbers.
