# WEAV OCR Service — đề xuất thiết kế production

Ngày: 2026-09-06. Trạng thái: **đề xuất để review, chưa triển khai**. Baseline: `58c52f5`, nhánh `feature/workflow-industrial-motion`, worktree có thay đổi sẵn của người dùng.

## 1. Kết luận và phạm vi

Giữ `ocr.extract` trong Workflow Builder. OCR chỉ chuyển ảnh/PDF thành văn bản, vị trí và cấu trúc bảng; không suy luận số hóa đơn, nhà cung cấp, tổng tiền hay trường nghiệp vụ. Các trường đó thuộc `AI Structured Extract`.

Đề xuất OCR Service stateless, API đồng bộ có deadline cứng; Workflow Service sở hữu execution bền vững, artifact, retry và lưu output. Inspector gọi cùng pipeline thông qua Gateway. Không thêm database hoặc hệ thống job thứ hai vào OCR ở phiên bản đầu.

```text
Inspector upload ── Gateway (auth + workspace permission) ─┐
                                                        ├─ OCR API ─ worker cô lập ─ kết quả
Trigger → file artifact → Workflow worker ────────────────┘
                              │
                              └─ lưu node output → AI Structured Extract → destination
```

Ba lựa chọn đã cân nhắc:

| Phương án | Đánh đổi | Quyết định |
| --- | --- | --- |
| OCR đồng bộ có giới hạn + workflow orchestration | Ít thành phần; cần deadline/proxy đủ dài và load shedding | Chọn cho tài liệu tối đa 10 trang |
| OCR trả 202 + job store/broker/polling riêng | Hợp tài liệu lớn, nhưng thêm lifecycle và hai nơi quản lý trạng thái | Hoãn; xem lại nếu benchmark không đạt deadline hoặc sản phẩm cần file lớn |
| OCR chạy ngay trong Gateway/Workflow process | Gắn ML runtime vào service khác, khó cô lập CPU/native crash | Không chọn |

Các con số dưới đây là **ngân sách ban đầu cần benchmark**, không phải hiệu năng đã đo hoặc cam kết SLA.

## 2. Hiện trạng đã đối chiếu source

| Nguồn | Bằng chứng | Ý nghĩa |
| --- | --- | --- |
| `apps/web/src/api/ocr.api.ts` | Delay 850 ms, confidence 98.4, dữ liệu hóa đơn cố định, giới hạn client 10 MiB | Mock, chưa gọi BE; kiểm MIME/extension không chứng minh file hợp lệ |
| `apps/web/src/pages/WorkflowBuilderPage.tsx` | Có OCR trong thư viện node riêng; `handleRunOcr` dùng mock, thời gian/log cố định; Inspector hiện `detectedFields` | Cần sửa đúng cả thư viện node cục bộ và catalog; bỏ trường nghiệp vụ khỏi OCR |
| `apps/web/src/lib/constants/nodeCatalog.ts` | `ocr.extract`, input `fileUrl`, output `rawText/pages/confidence`, default `vi+en`, bảng bật | Giữ ID và mappings cũ; bổ sung artifact/result version có kiểm soát |
| `apps/web/src/types/workflow.types.ts` | Config generic, model execution riêng | Không lưu browser File hoặc preview output vào config workflow |
| `apps/web/e2e/workflow-ui.spec.ts` | Fixture tên PNG nhưng bytes là chuỗi mock; assert 98.4%; đã assert không có Dashboard OCR action | Tách test mock và test live dùng file thật |
| `services/ocr-service/pyproject.toml`, `uv.lock` | Python 3.12, PaddleOCR 3.7.0 trong lock, PaddlePaddle 3.3.0; OpenCV headless và contrib cùng xuất hiện | Có dependencies, chưa chứng minh compatibility runtime; kiểm collision namespace `cv2` |
| `services/ocr-service/src`, `Dockerfile.dev` | Scaffold chưa có Python implementation; CMD uvicorn đang comment | Chưa có API/health/pipeline để nghiệm thu |
| `compose.dev.yml` | Gateway có `OCR_SERVICE_URL`; OCR publish 8000, chỉ có `APP_ENV` | Có service discovery config, không chứng minh gateway proxy hoạt động |
| Gateway `src/app.module.ts`, `app.controller.ts`, `main.ts` | NestJS Fastify, module skeleton và Hello route | Cần route, multipart streaming, authn/authz, service credentials |
| Workflow `application/usecase/TriggerExecutionUseCase.java` | File rỗng | Chưa có luồng execution hoàn chỉnh để cắm OCR rồi tuyên bố chạy thật |
| Workflow `domain/model/aggregate/workflow/WorkflowFile.java`, JPA entity, migration V1 | Có `workspaceId/storageKey/sizeBytes/expiresAt/deletedAt` | Tái sử dụng quyền sở hữu artifact; không để OCR đọc bảng `files` |
| Workflow `domain/model/aggregate/execution/NodeExecution.java` | Có pending/start/complete | Cần lifecycle failure/cancel/retry và persistence đồng bộ trước mốc chạy thật |
| Workflow `infrastructure/security/SecurityConfig.java` | Đang cấu hình HTTP Basic, chưa là luồng service JWT đề xuất | Auth liên service là prerequisite, không chỉ thêm một header |

`docs/development/SETUP.md` mới hướng dẫn cài/import OCR; không phải bằng chứng inference. Progress 2026-09-04 ghi nhận UI mock. Phase 8 của clean-architecture plan 2026-09-02 là hướng phân lớp phù hợp nhưng còn thiếu ingress security, PDF, tables, isolation, Gateway và execution.

### GitNexus và giới hạn bằng chứng

- Đã đọc `AGENTS.md`; `gitnexus status` báo index/current đều `58c52f5`, up-to-date. Không cần chạy `analyze --index-only .`.
- Đã query bốn nhóm: `ocr extractText`, `WorkflowBuilderPage handleOcrUpload nodeCatalog`, `api gateway request proxy`, `TriggerExecutionUseCase WorkflowFile execution` với `--repo Weav --limit 3`.
- Query báo `FTS indexes missing — keyword search degraded`, trả processes rỗng. Không diễn giải thành không có dependency; không ép rebuild index trong phiên lập kế hoạch.
- Context theo UID tìm được `handleRunOcr` → `updateSelectedNodeConfig`; context `AppController` tìm imports từ AppModule/test; `WorkflowFile` và `NodeExecution` tìm được model/methods. Các context này không trả execution processes; `TriggerExecutionUseCase` không tìm thấy, phù hợp file rỗng.
- Sau graph query đã đọc source và targeted search để bù hạn chế. CLI GitNexus global dùng được; `.gitnexus/run.cjs` và `.claude/skills/gitnexus-*` không có. Không tuyên bố graph đã bao phủ toàn bộ.
- Chưa sửa symbol nên chưa chạy upstream impact cho thay đổi code. Khi triển khai phải chạy lại impact, xử lý UNKNOWN và cảnh báo HIGH/CRITICAL theo AGENTS.

## 3. Contract HTTP đề xuất v1

### Route và hai kiểu request

Public: `POST /api/v1/workspaces/{workspaceId}/ocr/extractions` qua Gateway.

Private: `POST /v1/extractions` tại OCR, chỉ Gateway/Workflow được truy cập. Workspace lấy từ service token, không từ field tùy ý. Không expose private port ra Internet trong production.

Một request chỉ có một nguồn; route chọn decoder theo Content-Type:

| Content-Type | Nguồn | Options |
| --- | --- | --- |
| `multipart/form-data` | Chính xác một part `file` | `language`: `vi`, `en`, `vi+en`; `detectTables`: chuỗi `true` hoặc `false` |
| `application/json` | `source.type=artifact` + `artifactId`, hoặc `source.type=url` + `fileUrl` | `language` enum tương tự, `detectTables` boolean |

Default: `language="vi+en"`, `detectTables=true`, phù hợp node hiện tại. Client không được nâng giới hạn server hoặc chọn model/path/tùy chọn shell. Reject field không thuộc schema, nhiều file, nguồn trộn và options sai kiểu. Multipart không kèm JSON request body thứ hai; cài dependency trực tiếp `python-multipart`, giới hạn parser trước khi spool. [FastAPI request files](https://fastapi.tiangolo.com/tutorial/request-files/).

Ví dụ JSON artifact:

```json
{
  "source": {"type": "artifact", "artifactId": "8eae413e-b229-490f-927a-3e2ee793d029"},
  "language": "vi+en",
  "detectTables": true
}
```

Ví dụ JSON URL (minh họa; host phải có allowlist thực tế):

```json
{
  "source": {"type": "url", "fileUrl": "https://files.example.invalid/approved/report.pdf"},
  "language": "en",
  "detectTables": false
}
```

Inspector mặc định multipart, có thể chọn artifact thuộc workspace. Workflow dùng artifact ưu tiên hoặc URL từ node trước; public URL mode chỉ bật cho nguồn đã được workspace policy chấp nhận, không phải proxy tải URL bất kỳ.

### Authentication, authorization và IDs

- Public dùng `Authorization: Bearer <access-token>` theo Identity contract hiện có. Gateway validate signature/algorithm allowlist, issuer, audience, exp/nbf; xác minh quyền `workflow:execute` trong workspace qua API của service sở hữu membership. Permission name này là đề xuất, phải thống nhất với Workspace. Nếu dùng cookie sau này phải thêm CSRF; không mặc định cookie cho contract này.
- Access JWT hiện có chưa chứng minh workspace membership. Không tin `X-Workspace-ID`, `X-Execution-ID`, role hoặc user ID do browser tự gửi.
- Đề xuất Gateway/Workflow ký service JWT ngắn hạn bằng khóa bất đối xứng riêng từng issuer; OCR allowlist issuer/JWKS và `aud=weav-ocr`, `scope=ocr:extract`, `workspace_id`, subject, mode `preview|execution`. Execution mode bắt buộc claims `execution_id`, `node_execution_id`; artifact mode bind đúng `artifact_id`. TTL 120 giây, kiểm tra tại admission; khóa rotate qua secret manager, không chia sẻ khóa ký access-token của Identity cho OCR.
- OCR kiểm lại service claims và quyền artifact; JWT hợp lệ không cho phép đọc file workspace khác. Không truy cập DB của Identity/Workspace/Workflow trực tiếp.
- `X-Request-ID` UUID do Gateway tạo hoặc chuẩn hóa, echo trong response; `traceparent` W3C đã validate. Execution IDs server thiết lập và bind token; headers chỉ là transport/tracing, không là bằng chứng quyền.
- Gateway rate limit theo user/workspace ở shared limiter; browser retry thủ công, không tự retry POST khi timeout. Private network allowlist không thay authentication.

### Response 200

Ví dụ hình một trang, không phát hiện bảng; các giá trị chỉ minh họa:

```json
{
  "schemaVersion": "1.0",
  "requestId": "eeb24fb2-df80-4dcb-b22d-3a4884799c73",
  "document": {
    "fileName": "meeting-notes.png",
    "mimeType": "image/png",
    "pages": 1,
    "pageInfo": [{"page": 1, "width": 1200, "height": 1600, "dpi": null}]
  },
  "text": {"rawText": "Biên bản họp / Meeting notes"},
  "confidence": 0.984,
  "blocks": [{
    "id": "p1-b1",
    "order": 0,
    "text": "Biên bản họp / Meeting notes",
    "confidence": 0.984,
    "page": 1,
    "boundingBox": {"x": 100, "y": 200, "width": 700, "height": 32},
    "polygon": [[100, 200], [800, 200], [800, 232], [100, 232]]
  }],
  "tables": [],
  "metadata": {
    "language": "vi+en",
    "resolvedLanguage": "latin-multilingual",
    "processingTimeMs": 850,
    "engine": "paddleocr",
    "engineVersion": "3.7.0",
    "modelRevision": "approved-model-manifest-id",
    "tableDetection": "completed",
    "quality": "OK",
    "preprocessing": [{"page": 1, "steps": ["grayscale", "contrast"]}],
    "warnings": []
  }
}
```

Schema semantics:

- Các field trong ví dụ bắt buộc, trừ `polygon` có thể bỏ. `schemaVersion` là literal `1.0`; filename chỉ basename đã sanitize, tối đa 255 ký tự, không dùng làm temp path. MIME canonical do decoder xác thực: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`.
- `document.pages`: integer 1–10, bằng số phần tử pageInfo. Image một frame là một trang; v1 reject WEBP động thay vì bỏ frame âm thầm. PDF xử lý đủ tất cả trang hoặc trả lỗi; không báo thành công phần đầu rồi giấu phần còn lại.
- `page`: 1-based. `order`: 0-based thứ tự đọc toàn tài liệu. Raw text Unicode NFC, line separator `\n`, page separator `\n\f\n`; không sửa nội dung theo suy đoán nghiệp vụ.
- Box/polygon dùng pixel trên canonical page: ảnh sau EXIF orientation hoặc PDF sau page rotation/raster; gốc trên trái, x sang phải, y xuống dưới. `width/height` dương và nằm trong pageInfo. PDF ghi DPI render thực tế; ảnh `dpi=null`. Inverse transform trả tọa độ từ resize/deskew về canonical page, không trả box trên ảnh đã tiền xử lý mà thiếu quy ước.
- Block confidence float hữu hạn 0–1. Document confidence là trung bình có trọng số số Unicode code point không trắng của các block có text; bảng không được tính trùng. Không phải xác suất đúng hay accuracy đã đo. Không text: `confidence=null`, rawText rỗng, blocks rỗng.
- `quality`: `OK|LOW_CONFIDENCE|EMPTY`. Ngưỡng đề xuất document confidence <0.70; warning block confidence thấp có thể kèm blockId. Trả 200 cùng warning có cấu trúc `{code,message,page?,blockId?}` để người dùng/nhánh workflow quyết định; không retry vì confidence thấp. Trang trắng trong PDF được ghi warning riêng.
- `tableDetection`: `not_requested|completed`; detectTables=false thì tables rỗng và không load/chạy table inference cho request đó. Bật mà không có bảng: completed + rỗng. Model thiếu hoặc table pipeline hỏng: lỗi rõ, không giả kết quả rỗng thành thành công.
- `processingTimeMs`: thời gian service từ admission tới chuẩn bị response, gồm fetch/queue/decode/inference; không gồm thời gian Gateway nhận upload trước khi forward. Gateway có metric duration riêng. Timings chi tiết ghi metrics, không thêm thông tin hạ tầng nhạy cảm vào response.

Schema phần tử `tables`:

```json
{
  "id": "p1-t1",
  "page": 1,
  "boundingBox": {"x": 100, "y": 300, "width": 900, "height": 200},
  "rowCount": 2,
  "columnCount": 2,
  "confidence": null,
  "cells": [{
    "row": 0, "column": 0, "rowSpan": 1, "columnSpan": 1,
    "text": "Nội dung", "confidence": 0.96,
    "boundingBox": {"x": 100, "y": 300, "width": 450, "height": 100},
    "sourceBlockIds": ["p1-b2"]
  }]
}
```

Ví dụ chỉ minh họa một cell. Row/column 0-based; span >=1; cells không overlap ngoài merged span hợp lệ, không vượt rowCount/columnCount. Mọi cell có cả cell rỗng; cell box nullable nếu model không cung cấp tọa độ đáng tin. Table/cell confidence nullable nếu engine không có score phù hợp, không tự bịa score cấu trúc. Văn bản trong bảng vẫn có thể xuất hiện trong rawText/blocks theo thứ tự đọc, không append lại toàn bộ bảng vào rawText. Không trả/rendere HTML từ engine; FE render text escaped.

### Lỗi thống nhất

```json
{
  "error": {
    "code": "OCR_TIMEOUT",
    "message": "Document processing exceeded the allowed time.",
    "retryable": false,
    "details": {"limitSeconds": 60}
  },
  "requestId": "eeb24fb2-df80-4dcb-b22d-3a4884799c73"
}
```

| HTTP | Code | Hành vi |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Nhiều nguồn/file, multipart hỏng, URL syntax sai |
| 401 / 403 | UNAUTHENTICATED / FORBIDDEN | Không/không đủ quyền; không lộ artifact người khác |
| 404 | ARTIFACT_NOT_FOUND | Gộp không tồn tại, hết hạn, đã xóa, không thuộc quyền đọc |
| 413 | FILE_TOO_LARGE / DOCUMENT_LIMIT_EXCEEDED | Vượt bytes, pages, dimensions, pixels |
| 415 | UNSUPPORTED_MEDIA_TYPE | SVG/GIF/TIFF, content không khớp định dạng được hỗ trợ |
| 422 | INVALID_OPTIONS / CORRUPT_FILE / ENCRYPTED_PDF / ANIMATED_IMAGE_UNSUPPORTED | Không retry |
| 422 | SOURCE_URL_NOT_ALLOWED / SOURCE_UNAVAILABLE / OUTPUT_LIMIT_EXCEEDED | URL policy, nguồn 4xx, hoặc output vượt cap; không trả dữ liệu bị cắt âm thầm |
| 429 | RATE_LIMITED | Retry-After; quota user/workspace |
| 502 | SOURCE_FETCH_FAILED / TABLE_EXTRACTION_FAILED | Retryable chỉ nếu lỗi tạm thời đã phân loại; lỗi deterministic không retry |
| 503 | OCR_BUSY / MODEL_NOT_READY | Retry-After; reject sớm, không queue vô hạn |
| 504 | SOURCE_TIMEOUT / OCR_TIMEOUT / REQUEST_TIMEOUT | Không retry mặc định; tránh nhân đôi chi phí cho tài liệu quá chậm |
| 500 | INTERNAL_ERROR | Message an toàn, không stack trace/path/text/fileUrl |

Normalize cả validation exception FastAPI và lỗi Gateway về envelope này; không echo invalid input có thể chứa URL ký/token. Lỗi upload quá chậm: Gateway 408 `UPLOAD_TIMEOUT` cùng envelope nếu còn khả năng trả response.

## 4. File ingestion, SSRF và artifact ownership

### Giới hạn v1

| Tài nguyên | Cap đề xuất |
| --- | --- |
| File bytes (multipart hoặc fetch) | 10 MiB = 10,485,760; stream đếm bytes kể cả thiếu/giả Content-Length |
| Request multipart toàn bộ | 11 MiB; một file, tối đa 2 options, giới hạn header/field riêng |
| JSON body / URL | 16 KiB / 4096 ký tự |
| Trang / ảnh | 10 trang; 20 megapixel/trang, cạnh <=10,000 px; tổng 100 megapixel/tài liệu |
| PDF render | 200 DPI mặc định; điều chỉnh xuống trong cap, không nâng quá 300 DPI; kiểm kích thước trước cấp bitmap |
| Output | JSON UTF-8 <=5 MiB, rawText <=1 MiB, <=20,000 blocks, <=100 tables và <=10,000 cells tổng |
| Thời gian | Gateway nhận upload <=30 s; service deadline tổng 90 s; native processing <=60 s tổng, <=20 s/trang |
| Download | Connect <=3 s, read-idle <=5 s, tổng <=15 s; cả stream chịu byte cap |
| Admission | 1 native job chạy/replica, tối đa 2 chờ và chờ <=2 s; vượt trả 503 |

Các budget con cùng bị chặn bởi deadline tổng, không cộng rồi tự gia hạn. Gateway upstream timeout 100 s sau khi forward; client timeout 140 s gồm upload và upstream. Mỗi request workflow cũng có execution deadline còn lại, lấy min với service budget. Chọn route timeout của ingress/LB tương ứng; nếu nền tảng không cho phép, chuyển thiết kế async trước khi rollout chứ không tăng timeout một lớp riêng lẻ.

Streaming bounded ở ingress/Gateway/ASGI trước multipart parser; `UploadFile` spooling không thay thế giới hạn file. Kiểm magic bytes + decoder, MIME canonical, extension phù hợp; không tin filename/MIME client. Kiểm ảnh nén bom trước decode, PDF page count/dimensions trước raster; decode từng trang, đóng page/bitmap/document ngay sau dùng. Từ chối PDF mã hóa; không thực thi JS/embedded attachment, không mở external resource trong PDF. Native parser chạy trong isolation cùng resource limits.

### fileUrl không được thành SSRF proxy

Chỉ HTTPS port 443, host/provider và path prefix đã cho phép theo workspace; mặc định deny. Artifact dùng descriptor do Workflow cấp, vẫn qua fetcher an toàn. Không coi toàn bộ shared S3 domain là cùng quyền sở hữu.

Canonicalize URL/IDNA; reject userinfo, fragment, scheme khác HTTPS, IP dạng literal/encoded bất thường. Kiểm tất cả A/AAAA, chặn loopback, private, link-local, metadata, multicast, reserved và IPv4-mapped IPv6 tương ứng. Không follow redirect. Resolve-và-connect phải dùng cùng địa chỉ đã kiểm tra, giữ TLS hostname/SNI validation; chỉ DNS check trước một lần rồi để HTTP client resolve lại là chưa đủ. Egress proxy/firewall deny mạng nội bộ làm lớp bảo vệ thứ hai. Không dùng ambient proxy config, cookies hay forward bearer credential tới source. URL signed query luôn redact, không log cả URL. [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

Artifact URL hết hạn: Workflow cấp lại descriptor sau khi reauthorize; không fallback sang URL tùy ý. Nếu cần private storage endpoint nội bộ, dùng connector egress riêng cố định do operator cấu hình và chỉ descriptor hợp lệ truy cập, không mở lại RFC1918 cho user URL.

### Prerequisite file contract (Workflow sở hữu)

Các route sau **chưa phải API hiện có**, là đề xuất cần team Workflow/Workspace thống nhất:

- `POST /api/v1/workspaces/{workspaceId}/files`: upload authenticated, kiểm quyền/bytes, lưu object private, tạo WorkflowFile; trả 201 `{artifactId,fileName,mimeType,sizeBytes,expiresAt}` chỉ khi object và metadata đã sẵn sàng. Dùng storage port; xử lý orphan object khi DB commit lỗi. Webhook/Email/Upload producer gọi cùng application use case, không insert bảng lẫn nhau.
- `POST /internal/v1/workspaces/{workspaceId}/files/{artifactId}/download-descriptor`: service auth có scope artifact-read và ràng buộc execution/workspace; trả `{downloadUrl,expiresAt,fileName,mimeType,sizeBytes,sha256}`. Signed URL TTL đề xuất 120 s. Recheck expiry/deletedAt/ownership tại resolve; descriptor không trả ra log hoặc node output.
- Không dùng original URL làm định danh bền vững. Workflow config giữ artifactId hoặc binding tới output node trước, không giữ signed URL sẽ hết hạn, File object hay blob URL.
- SHA-256/checksum cần được lưu qua additive migration nếu schema hiện tại thiếu; không sửa migration V1 đã áp dụng. Retention artifact do Workspace policy quyết định; đề xuất mặc định 24 giờ cho artifact tạm và cho phép policy dài hơn lịch chạy. Hết hạn thì execution báo rõ, không tự kéo lại nguồn chưa được phép.
- OCR không cần Neon. DB connectivity của Workflow và việc bucket thật hoạt động phải được nghiệm thu trong lane artifact, chưa được kiểm chứng ở phiên này.

## 5. Pipeline OCR và vận hành

1. Auth/admission → bounded temp spool/fetch → validate/decode metadata.
2. Canonical orientation → render từng trang → chọn preprocessing → inference text/table → normalize result → enforce output cap → cleanup.
3. OpenCV có grayscale, denoise, contrast (ví dụ CLAHE), threshold (adaptive/Otsu) và deskew có ngưỡng. Không áp tất cả bước mù quáng: threshold có thể mất dấu tiếng Việt/nét mảnh. Ghi steps thực sự áp dụng; benchmark against original. Không chạy hai pipeline mỗi trang trừ khi có budget/tiêu chí rõ.
4. PaddleOCR adapter che SDK khỏi domain. `vi`, `en`, `vi+en` là API WEAV, không truyền nguyên `vi+en` vào `lang`. Thử Latin multilingual recognizer cho vi/mixed; English model cho en nếu kết quả tốt hơn. Bảng model chính thức có Vietnamese `vi`, nhưng mixed-language quality trên dữ liệu WEAV phải đo. Pin SDK + model names/checksums đã kiểm chứng. [PaddleOCR multilingual](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.md).
5. Table detection và structure recognition là pipeline riêng qua adapter; chọn các module cần thiết của PP-StructureV3, tránh bật formula/chart/AI không liên quan. Ghép cell text bằng recognizer hỗ trợ vi/en; không giả định table default model giữ đúng dấu Việt. [PaddleOCR PP-StructureV3](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html).
6. Chọn `pypdfium2` làm ứng viên render PDF, pin sau spike compatibility/license/CVE. Không dùng PDFium đồng thời nhiều thread; xử lý trong supervised process. [pypdfium2 threading constraints](https://pypdfium2.readthedocs.io/en/stable/python_api.html#incompatibility-with-threading).

Process model: một ASGI supervisor và một native child đã warm model/replica; preload model trước readiness, không download theo request. Native child chỉ nhận local path đã validate + typed options; không nhận URL để Paddle tự tải. Timeout/cancel kill process group, reap, xóa temp, replace/warm child rồi mới nhận job tiếp; `asyncio.wait_for` hoặc cancel thread một mình không dừng được native inference. Khi client disconnect cũng cancel job preview; workflow persistence quyết định retry nếu mất kết nối.

Temp root riêng, directory UUID mỗi request, non-root, quota đĩa đề xuất 512 MiB/replica; parent cleanup `finally` trên success/error/timeout và sweeper orphan khi restart theo lease/age, không xóa thư mục active hay path từ filename. Dùng encrypted ephemeral storage, close handles trước xóa. Không lưu OCR text/file mặc định trong logs/cache; output bền vững do Workflow quản lý access/retention.

Production image: uv locked, một OpenCV distribution tương thích PaddleX, SBOM/license/CVE scan, model artifacts hash-verified và read-only, không reload/root/debug. Initial benchmark envelope 2 vCPU/4 GiB RAM; nếu table models không đủ RAM thì đo và tăng resource/chọn model, không tuyên bố envelope đã đủ. OCR compute không có egress ngoài fetcher được kiểm soát. SIGTERM ngừng admission, drain trong deadline hoặc hủy có cleanup.

Health: `GET /health/live` kiểm supervisor; `GET /health/ready` chỉ ready khi worker/models/temp sẵn sàng; private metrics. Metrics: request count by status/error, bytes/pages, stage durations, queue/admission rejects, worker RSS/restarts/timeouts, cleanup failures, low-confidence rate. Không dùng executionId/filename làm metric label; dùng requestId/traceId trong structured logs không chứa OCR content. Alert khi readiness fail, timeout/error tăng, cleanup failure, disk/RSS gần cap; ngưỡng chốt sau load test.

## 6. Kết nối Builder và workflow

### Inspector

- Thay mock `ocrApi.extractText` bằng multipart authenticated qua Gateway, thêm AbortSignal; mock chỉ ở test/dev mock mode rõ ràng, không fallback khi API lỗi.
- Capture nodeId + revision options khi request bắt đầu; response chỉ apply nếu request vẫn là mới nhất của đúng node. Abort/ignore khi switch node, xóa node, đổi file/options hoặc unmount. Loading/error/warnings/result thuộc preview state, không đánh dấu execution thật SUCCESS.
- Dùng thời gian từ response, timestamp hiện tại; confidence null hiển thị chưa có text, 0.984 hiển thị 98.4%. Bỏ detectedFields/invoice samples; thêm blocks/page/table preview với lazy render và accessible error/loading states. Render OCR text như text, không HTML.
- Giữ node `ocr.extract`, input `fileUrl`, output `rawText/pages/confidence`; bổ sung input artifact và outputs blocks/tables/document/metadata bằng additive catalog change. Executor map `response.text.rawText` → output `rawText` rõ ràng.
- API mới dùng 0–1, mock cũ 0–100: version config/contract mới và adapter đọc legacy được test. Không âm thầm nhân/chia saved output hoặc đổi ý nghĩa confidence của workflow đã lưu; inventory persisted definitions, xác nhận migration nếu có consumer threshold thang 100. Preview cache có thể invalidate, execution history phải giữ version.
- Không thêm Dashboard OCR action. Mobile có thể tái sử dụng API contract nhưng không xây màn hình mobile mới trong phạm vi này.

### Workflow execution

- Node executor resolve đúng một input artifactId hoặc fileUrl từ upstream; validate options, workspace và execution lease; gọi OCR bằng service identity. OCR không tự trigger AI hoặc destination.
- Workflow ghi PENDING → RUNNING → SUCCESS/FAILED/CANCELLED cùng attempt records; lưu output/error đã normalize, schema/model version, requestId trước khi acknowledge queue. Với output lớn dùng artifact output reference và typed projection, không vượt JSON/DB policy.
- Idempotency do Workflow sở hữu: key từ workspace + execution + node + input hash + options + model version; atomic claim/lease + compare-and-set completion. Retry không đổi model giữa cùng logical node run. Mất response có thể OCR lại (at-least-once compute), nhưng chỉ một kết quả hoàn tất/destination scheduling; không hứa exactly-once network calls.
- Max 2 retries (3 attempts) chỉ cho transient 429/502/503/network errors đã phân loại, exponential backoff+jitter, tôn trọng Retry-After và execution deadline. Không retry corrupt/unsupported/low-confidence/timeouts mặc định. Không retry vô hạn hoặc acknowledge trước persistence.
- Workflow crash sau OCR/before save, expired lease, duplicate delivery và cancellation đều cần integration test. Không xây lại toàn workflow engine trong ticket OCR: lane nền execution/file/auth phải hoàn thành trước mốc workflow-live.

## 7. Điều kiện cần chốt trước production

1. Model/CPU image tương thích thực tế, một cv2 distribution; model table có giữ dấu Việt và đạt ngân sách không.
2. Hạ tầng gateway/LB hỗ trợ synchronous request budget; nếu không, thiết kế 202/job lifecycle riêng trước rollout.
3. Team Workflow/Workspace nhận ownership artifact + authorization + execution foundations; object store/provider allowlist và retention được duyệt.
4. Corpus test hợp pháp, không chứa PII; accuracy thresholds và tải mục tiêu chốt trước benchmark, không dùng confidence 98.4 làm accuracy.
5. Consumer legacy confidence được inventory và có chiến lược tương thích; rollout feature flag không silent fallback mock.

Implementation checklist, file ownership, tests và rollout: [kế hoạch triển khai](../plans/2026-09-06-ocr-service-production.md).
