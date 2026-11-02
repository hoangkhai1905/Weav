# Nhật ký: Builder correctness (W5-A, batch 1)

Nhánh `feat/w5-a-builder` (từ `week5` ef69d9a). Trạng thái: batch 1 xong, chờ coordinator review; batch 2 chưa bắt đầu.

## Quyết định

- Bước mới có id `<tiền_tố>_<n>` (`http_1`, `send_email_1`, `sheets_1`, `webhook_1`...), sinh bởi `nextNodeId` trong `nodeCatalog.ts`. Id cũ không bao giờ đổi. Server chỉ yêu cầu id không rỗng, còn `MappingResolver` chỉ cần id không gây nhập nhằng với `.output`.
- Id hiển thị trên thẻ node và trong inspector là chính `node.id` (cũng là id trong definition); bỏ `data.id` giả (`*_v1`). Inspector có nút sao chép id.
- Picker "Chèn biến" (`VariablePicker`, `lib/variablePaths.ts`): chỉ liệt kê trigger và các bước upstream (duyệt ngược theo edge). Chèn vào ô văn bản được focus gần nhất trong inspector (qua native setter + sự kiện `input`, nên mọi ô, kể cả ô viết tay, đều dùng được). Ô không phải template (tên case, khóa data.set, outputSchema, tên header) mang `data-notemplate`.
- Văn phạm xác nhận từ `MappingResolver`: `trigger.input[.path]`, `nodes.<id>.output[.path]`, `variables.x`; segment là chữ/số/`_`/`$`; `[n]` = chỉ số danh sách (0..9999, không số 0 đứng đầu).
- Output catalog lấy từ executor thật (không phải docs): xem `nodeOutputPaths`. Sheets/Drive/Calendar theo từng operation; data.set và ai.extract theo config; OCR là `text.rawText`, `document.pages`, `confidence`, `blocks`, `tables`; trigger.gmail thêm `fromEmail`, `fromName` (W5-D thêm vào trigger, giữ `from`).

## Đã sửa

- #16/#55 id thật; chữ "Sheets/Docs"; gợi ý `{{ id-buoc.output... }}` chuyển sang nút Chèn biến.
- #17 picker. S6 catalog outputs.
- #23/S1 webhook default `{}`; S2 sheets bỏ `connectionId: ''`; S3 OCR chỉ ghi một khóa nguồn (`undefined` cho khóa kia).
- #24/S4 ai.classify có `content`; S5 ai.summarize có `inputText`, `maxLength` dùng SchemaField (số, mapping giữ chuỗi, rỗng thì bỏ, không còn `0`); ai.extract có `instructions`; S7 http.request có headers/query (`KeyValueEditor`), connection HTTP tùy chọn, thêm PATCH/HEAD/OPTIONS.
- Rà default catalog với schema: các node còn lại khớp (ocr `language`/`detectTables` có trong schema).

## File

Mới: `apps/web/src/components/builder/VariablePicker.tsx`, `KeyValueEditor.tsx`, `apps/web/src/lib/variablePaths.ts`, `apps/web/e2e/builder-correctness.spec.ts`.
Sửa: `WorkflowBuilderPage.tsx`, `CustomWorkflowNode.tsx`, `SwitchEditor.tsx`, `DataSetEditor.tsx`, `OutputSchemaEditor.tsx`, `nodeCatalog.ts`, `translations.ts` (khóa `builder.var.*`, `builder.node_id*`, `builder.cfg.kv_*`, `builder.field.*`), `e2e/workflow-catalog-v1.spec.ts` (kỳ vọng default mới).

## Lệnh và kết quả

- Baseline trước khi sửa (5 spec cũ): 46 failed, 9 passed, 1 skipped (đã đỏ sẵn trên dev).
- Sau: 47 failed gồm 1 case do default đổi (đã cập nhật, pass); 2 spec mới pass. Không còn lỗi mới.
- `pnpm --dir apps/web exec tsc --noEmit` sạch; `pnpm --dir apps/web build` thành công; eslint file đã sửa: chỉ còn lỗi có sẵn `react-hooks/set-state-in-effect` (dòng ~509 của builder page); `git diff --check` sạch.

## Rủi ro / việc tiếp theo

- Batch 2: publish blocker khớp DefinitionValidator (S8, S9, S12, #57) và UX chỉnh sửa. Lưu ý: không thêm luật bắt buộc trigger manual (D1).
- Chưa có test cho nodeOutputPaths ngoài luồng picker; chưa kiểm tra thủ công trên stack thật.

## Batch 2 (publish rules, editing UX)

- `lib/publishBlockers.ts` mirrors DefinitionValidator publish rules: at least one trigger and at most one manual trigger (D1: a manual trigger is never required), no edges into triggers, port rules (condition true/false, switch case/default, others none), cycles, mappings (balanced braces, `trigger.input|variables|nodes.<id>.output` grammar, upstream-only), ordering operands numeric, required AI fields, absolute http(s) URL. Duplicate OCR blocker removed. Not mirrored: Spring cron validity (UI only checks 6 fields + timezone), per-field literal enums.
- email.send subject is optional when `replyToMessageId` is set (#57); the server side is W5-D's.
- Publish/save 400 `details[]` -> `lib/publishErrors.ts` -> Vietnamese per-step list in the error banner, first step selected and outlined (#18); unknown codes get a generic Vietnamese line.
- #44 no connection into a trigger (`isValidConnection` + guard in `onConnect`); #25 Delete key + delete button on the selected node; #27/#45 header name saved on blur/Enter via `renameWorkflow` (the service has no rename endpoint: it re-sends the last SAVED draft with the new name, so unsaved/invalid canvas cannot lose it); #26 blank workflow asks for a name (default "Quy trình mới"); #19 toasts offset below the header (`App.tsx` Toaster offset only); #46 one "no formatting" option; #56 datetime-local picker writes RFC 3339 with the browser offset (text input kept for templates); S10 drive name required unless `file` is mapped, object `file` shown as JSON; #20 email label, OCR tagged unavailable in the palette, workspace name instead of UUID; #42 header no longer overlaps at ~1190px (labels hidden below xl); S11 sheets values editor supports several rows.
- Checks: `pnpm --dir apps/web build` (tsc -b) ok; builder-correctness spec 9/9; 5 existing specs 46 failed / 9 passed / 1 skipped, same names as baseline; eslint: only the existing set-state-in-effect error; `git diff --check` clean.
