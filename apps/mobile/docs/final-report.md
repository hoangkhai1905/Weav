# Báo cáo cuối: thiết kế lại app mobile Weav

Nhánh `feature/mobile`. App mobile là app đồng hành để giám sát và điều khiển (không có builder). Theo quyết định của người dùng: **không có lớp mock**, mọi màn gọi gateway thật (`EXPO_PUBLIC_API_MODE=mock` chỉ còn giả lập auth, workspace, notification cũ). Chi tiết đối chiếu contract: `api-alignment.md`; nhật ký từng làn: `docs/work_logs/K/mobile/mobile-ui.md`.

## 1. Endpoint đã nối (qua API Gateway)

| Nhóm | Route | Dùng ở |
| --- | --- | --- |
| Auth | `POST /api/auth/login, register, logout, refresh, change-password, forgot-password, otp/verify, reset-password`; `GET/PATCH /api/auth/me`; `GET/DELETE /api/auth/sessions`, `DELETE /api/auth/sessions/:id` | Đăng nhập/ký/quên mật khẩu, Cá nhân, Bảo mật |
| Tài khoản | `GET /api/users/me/oauth-accounts`; `GET, DELETE /api/users/me/avatar` | Bảo mật (Google đã liên kết), Cá nhân (ảnh đại diện) |
| Workspace | `GET/POST /api/v1/workspaces` (POST có `Idempotency-Key`), `GET/PATCH /:id`; members: `GET, POST /:id/members`, `PATCH /:id/members/:uid/permissions`, `DELETE /:id/members/:uid`, `DELETE /:id/members/me` | Không gian làm việc, quyền workflow |
| Connections | `GET /:ws/connections`, `POST /:ws/connections/:id/test`, `POST /:ws/connections/:id/disable` | Kết nối, Trang chủ, AI |
| Workflows | `GET/POST /:ws/workflows`, `GET/DELETE /:ws/workflows/:id`, `PUT .../draft`, `POST .../publish, pause, resume`, `POST /:ws/workflows/generate` | Quy trình, chi tiết, AI Generator |
| Executions | `POST /:ws/workflows/:id/executions` (202, `Idempotency-Key`), `GET .../executions`, `GET .../executions/:eid?logPage&logSize` | Chạy, Lịch sử, chi tiết lượt chạy |
| Notifications | `GET /api/v2/notifications`, `GET .../unread-count`, `PATCH .../:id/read`, `POST .../read-all` | Thông báo |
| Assistant | `POST /api/v1/assistant/chat` (SSE), `GET conversations`, `GET conversations/:id/messages`, `DELETE conversations/:id` | Trợ lý AI |

`:ws` = `/api/v1/workspaces/{workspaceId}`. Telegram link đã gỡ (backend không còn).

## 2. Cần backend bổ sung

- Lịch sử lượt chạy toàn workspace (hiện gộp phía client tối đa 20 workflow x 10 lượt, N+1 request).
- Thống kê dashboard (hiện tính trên mẫu đã tải, nhãn "trong N lượt chạy gần nhất").
- Chạy lại / hủy lượt chạy (hiện chỉ có "Chạy lại workflow" = lượt mới).
- Đăng ký push token (không có route; inbox dùng polling 10-30 s).
- Tìm kiếm/lọc workflow phía server; `lastRunAt`, `triggerType` trên danh sách workflow.
- Thông báo `EXECUTION` không mang `workflowId` nên phải dò tối đa 50 workflow (màn lookup).
- "Đăng xuất các thiết bị khác": backend chỉ có thu hồi một phiên hoặc tất cả (kể cả hiện tại); mobile tự liệt kê rồi thu hồi từng phiên.

Lỗi/chỗ lạ tìm thấy ở gateway:
- Gateway **âm thầm bỏ** `Idempotency-Key` sai định dạng (lệnh chạy khi đó không idempotent); app tự sinh key đúng `[A-Za-z0-9._:-]{8,128}`.
- POST không body nhưng có `content-type: application/json` bị 400 "Body cannot be empty" (app không gửi content-type khi không có body).
- `description: null` bị zod strict từ chối (phải là chuỗi hoặc vắng mặt); publish bắt buộc node `trigger.manual`.
- Ba dạng error envelope khác nhau; một số lỗi (ví dụ test connection HTTP cấu hình sai) trả `{code,message,requestId}` không bọc `error`.
- `definition` thật khác brief (`edges.source/target`, `connectionId` trong `config`, nhãn node ở `editorState`).
- Kết nối mới tạo ở trạng thái DISABLED; test đạt mới thành ACTIVE.
- Giờ thông báo lệch ~9 giờ (đã điều tra, không phải lỗi mã): xem mục "Giờ thông báo lệch ~9 giờ" trong `docs/work_logs/K/mobile/mobile-ui.md`. Nguyên nhân là đồng hồ của máy ảo Docker Desktop (WSL2) chạy chậm ~9 giờ so với máy thật (sau khi laptop ngủ); khởi động lại Docker thì hết. App và backend đã kiểm: giờ thông báo mới tạo hiển thị đúng giờ địa phương.

## 3. Quyết định thiết kế chính

- **Không mock**: một đường HTTP duy nhất, DTO thô (`*.dto.ts`) -> mapper -> domain; mapper và path builder có test `.test.cjs`.
- **Gộp phía client** gom trong `listRecentWorkspaceExecutions()` và `dashboard.stats.ts` để thay bằng endpoint thật sau này; mọi nhãn nói rõ giới hạn.
- **Nhãn node** lấy từ `editorState.nodes[id].name`, rồi `nodeType` đã dịch.
- **SSE của Assistant** qua `expo/fetch` (import động), có đường lùi đọc cả text; timeout riêng: generate 85 s, chat 80 s, route khác 10 s.
- **Idempotency**: key mới mỗi lần bấm chạy, thử lại đúng 1 lần cùng key khi 504/timeout; tạo workspace cũng gửi key.
- **Quyền**: lấy từ bản ghi thành viên của chính mình; ẩn hành động OWNER với MEMBER, Xóa/Tạm dừng theo `canManageWorkflowState`, Xuất bản theo `canPublishWorkflow`.
- **Giao diện cho người không rành kỹ thuật**: tiếng Việt thân thiện, mã enum thành nhãn dễ hiểu (trạng thái luôn có icon + chữ), lỗi theo `ApiError.code`, không hiện thông báo thô của backend; điều khiển có hướng dẫn (chọn lịch thay vì gõ cron).
- **Token thiết kế một nguồn** (`palette.ts` + `theme.ts`), sáng/tối/theo điện thoại; không gradient tím, không kính mờ; chạm >= 44 pt.
- Đổi workspace làm mới mọi query có `workspaceId`; query key luôn kèm `workspaceId`.

## 4. Bằng chứng kiểm tra

- `npx tsc --noEmit -p .` sạch; `node --test`: **171 pass** (từ 125 -> 136 -> 154 -> 171 qua các làn); `git diff --check` sạch.
- Chạy thật trên Docker stack (gateway `localhost:3000`) bằng Expo Web `:5173` + Playwright 390x844, sáng và tối, kiểm console và network (chỉ route gateway thật).
  - Làn A: danh sách phân trang, tìm/lọc, chi tiết, chạy ngay (202), poll 2 s tới trạng thái cuối, lượt chạy FAILED có attempts/log, tạm dừng/tiếp tục, xuất bản (secret webhook một lần), xóa, tab Lịch sử, 404, ngoại tuyến, MEMBER bị ẩn nút.
  - Làn B: Trang chủ (có dữ liệu, trống, đổi workspace, 403), AI Generator thật (needs_input, unsupported, ready, lưu nháp, xuất bản), Trợ lý (chat SSE, lịch sử, xóa).
  - Làn C: toàn bộ màn Không gian, Kết nối, Thông báo, Cá nhân, Bảo mật, Đăng nhập/ký/quên mật khẩu (xem nhật ký làn C).
- **Demo thật không mock**: đăng nhập -> đổi không gian -> chạy workflow đã xuất bản -> lượt chạy tới SUCCESS -> thông báo tới inbox -> mở lượt chạy từ thông báo -> tạm dừng workflow -> AI tạo (một vòng `needs_input`) -> Lưu bản nháp. Lượt chạy FAILED có node lỗi và nhiều attempt đã kiểm ở làn A.
- Ảnh chụp sáng + tối: `apps/mobile/docs/screens/`.

## 5. Giới hạn, chưa kiểm

- Chưa chạy trên thiết bị thật (iOS/Android), chưa kiểm Dynamic Type, kéo để làm mới bằng cử chỉ, push notification, stream SSE từng chunk trên native.
- Web không giữ phiên sau khi tải lại trang (SecureStore) nên mỗi lượt Playwright phải đăng nhập lại; trên thiết bị thật phiên được lưu.
- AI thật không ổn định: cùng một mô tả có lúc ra `unsupported`; các giai đoạn trên màn chờ AI chỉ là ước lượng theo giây; gọi generate chưa hủy được khi rời màn.
- Thanh tab dưới bị cắt nhãn ở 390 px trên web (có từ trước).
- Danh sách workflow/lượt chạy chỉ phản ánh dữ liệu đã tải (ghi chú trên màn).

## 6. Tài khoản / dữ liệu thử còn lại (chỉ email; không có API xóa tài khoản/workspace)

- Làn A: `mobile-ui-1791389491708@example.test` (chủ "Không gian thử Mobile"), `mobile-ui-member-1791390757989@example.test` (MEMBER hạn chế quyền).
- Làn B: `mobile-b-1791392546173@example.test` (chủ "Không gian thử B").
- Làn C: `mobile-c-owner-1791395438787@example.test` (chủ "Không gian Lane C" và "Không gian phụ", còn 3 kết nối thử với giá trị giả), `mobile-c-member-1791395597371@example.test`.
- Mọi quy trình, hội thoại thử đã xóa; mật khẩu không được lưu lại ở đâu.
