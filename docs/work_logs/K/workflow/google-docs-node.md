# Nhật ký: node `google.docs` (tạo và thêm chữ vào Google Docs)

| Trường | Giá trị |
| --- | --- |
| Nhánh | `feature/google-docs-node` (từ `dev` `397443b2`) |
| Spec | `docs/superpowers/specs/2026-11-02-google-docs-node-design.md` |
| Người thực hiện | K (Claude, các task giao cho subagent Sonnet/Haiku, mỗi task có review riêng) |
| Trạng thái | Xong: review toàn nhánh + vòng sửa đã qua, live check đạt; chưa merge |

## Quyết định

- Chỉ ghi vào Doc do Weav tạo (Google `drive.file`), dùng lại kết nối Google Drive: không đổi consent screen, không đổi Workspace/Gateway.
- `create` = một lần upload Drive multipart với `mimeType: application/vnd.google-apps.document` (Google tự chuyển text thành Doc).
  `append` = Docs API `documents.batchUpdate` + `insertText` ở cuối, host mới `docs.googleapis.com` được pin trong `PinnedHttpTransport`.
- Thêm node sau mốc freeze 11-01, theo quyết định của K. Google Docs API đã được K bật trong Google Cloud project.
- OCR đang tắt trong demo (`WORKFLOW_OCR_ENABLED=false`), nên demo dùng text từ AI/trigger; OCR → Docs chạy được ở nơi có OCR service.

## Thay đổi (commit)

| Commit | Nội dung |
| --- | --- |
| `13d32134`, `ef14f401` | Spec |
| `3e67f1d2` | Transport: chỉ cho `POST https://docs.googleapis.com/v1/documents/{id}:batchUpdate` |
| `87840273` | Executor `GoogleDocsNodeExecutor`, `GoogleMultipart` (tách từ Drive), `GoogleApiClient.docsBatchUpdate`, schema node, contract, validator |
| `2967fc86` | ai-service: prompt biết output của `google.docs` |
| `c7f5d71f` | Web builder: palette, form theo schema, readiness, i18n vi/en; bỏ code W39 cũ |
| `5ccc4dd6` | Mobile/admin: tên, icon, i18n |
| `614fe6ba` | Docs: workflow spec, node contracts, README |

## Kiểm tra

- workflow-service `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`: 1223 test, 0 lỗi (Docker phải đang chạy).
- ai-service `pnpm test`: 303/303. Web: `tsc` sạch, `build` OK, Playwright `workflow-catalog-v1` + `localization` 21/21.
  `eslint .` có 4 lỗi nằm ngoài diff (có sẵn từ trước).
- Live (stack local, kết nối "QA Drive" của workspace QA WS One, 2026-11-02):
  - Lượt `39ab2fa3`: `trigger.manual → google.docs create` thành công (6.2 s), trả `documentId`, `title`, `url`.
  - Lượt `ed1aafc8`: create rồi append vào Doc vừa tạo qua `{{ nodes.docs_1.output.documentId }}`, `appendedCharacters: 28` (tiếng Việt + emoji).
  - Lượt `0df1af55` (sau bản sửa): append với link dán vào `https://docs.google.com/document/d/<id>/edit?usp=sharing` thành công;
    output `documentId`/`url` dùng ID trần. Review lại vòng sửa: cả 5 điểm đã xử lý, không có lỗi mới.
  - Log workflow-service 15 phút: 0 dòng chứa `Bearer`/`ya29.`.
- Môi trường: cổng 8081 bị container `orderworder-mongo-ui` của dự án khác chiếm, nên identity chạy ở cổng host 18081 bằng file override ngoài repo
  (Google sign-in local không dùng được trong lúc đó; đăng nhập bằng mật khẩu). Đã xóa network rỗng `weav-prod_edge` còn sót từ buổi tập prod
  (trùng subnet với dev stack).

## Rủi ro và việc tiếp

- Đã sửa (review cuối): ô "Tài liệu" ở append nhận cả ID lẫn link Doc (`docs.google.com/document/d/<id>/...`, kể cả `/u/0/`), executor rút ra ID; link khác host/http/sheets/ID ngắn vẫn là CONFIGURATION_ERROR. Gợi ý ô Thư mục nay nói dùng ID thư mục (không dán link); gợi ý chung chỉ hiện khi thao tác là append.
- Bản nháp lưu theo dạng W39 cũ (`contentVariable`) giờ không qua validate và phải cấu hình lại.
- Append retry sau timeout/5xx có thể thêm chữ hai lần (create thì tạo trùng Doc), giống Sheets append và Drive upload. `appendedCharacters` đếm UTF-16 code unit, không tính dấu xuống dòng đầu.
- Nội dung append gồm nhiều ký tự điều khiển có thể vượt giới hạn request 1 MiB sau khi JSON escape dù chưa tới 512 KiB; khi đó lỗi không phải CONFIGURATION_ERROR.
- Nội dung tối đa 512 KiB/lần; OCR dài hơn sẽ lỗi cấu hình. Chỉ Doc do Weav tạo mới append được.
- Dữ liệu test: workflow "Docs live test" (`78d4e3c4`) và 3 Doc "Weav docs live test" trong Drive của tài khoản QA, có thể xóa.
