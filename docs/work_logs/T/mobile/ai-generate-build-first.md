# Nhật ký: Mobile - AI tạo workflow "build trước, hỏi sau" (phase 1)

> Cập nhật tại chỗ cho tính năng này. Spec: `docs/superpowers/specs/2026-11-09-mobile-ai-generate-build-first-design.md`. Plan: `docs/superpowers/plans/2026-11-09-mobile-ai-generate-build-first.md`.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-11-09 |
| Nhánh | `feat/mobile-ai-generate-build-first` (rẽ từ `dev`, chưa merge, chưa push) |
| Người thực hiện | AI agent (theo yêu cầu của T) |
| Trạng thái | Code xong và đã kiểm tra tự động; kiểm tra trên thiết bị Android là việc bàn giao cho người dùng |

## 2. Mục tiêu

- Mobile: "Tạo bằng AI" sinh workflow và lưu nháp ngay, không còn form câu hỏi dài.
- Màn workflow đánh dấu đỏ các bước chưa thiết lập xong và có thẻ "Còn N bước cần thiết lập".
- Bấm bước đỏ mở sheet, từ đó mở đúng bước đó trên web builder để hoàn tất.
- Backend: thêm endpoint đọc-only báo workflow đã sẵn sàng publish chưa.

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Build trước, hoàn thiện sau | Người dùng không phải trả lời câu hỏi trước khi thấy kết quả | Có thể để lại nháp chưa hoàn chỉnh (xem rủi ro) |
| Server là nguồn sự thật cho readiness (endpoint đọc-only trong workflow-service, qua gateway) | Mobile không tự suy ra được từ graph; tránh lệch với backend | Chỉ mang tính tư vấn: Publish còn kiểm tra thêm giới hạn Telegram, workflow được theo dõi, reference projection |
| Quy tắc auto-pick kết nối/tham số (loại trừ `http.request` và `ai.*`) | Chỉ tự chọn khi chắc chắn; không tự gán kết nối cho bước có thể gửi dữ liệu ra ngoài hoặc tốn chi phí AI | Các bước bị loại trừ vẫn đỏ để người dùng tự chọn |
| Chỉ tô đỏ và khóa Publish với workflow `DRAFT` | Mobile chỉ có nút Publish cho `DRAFT` | Workflow đã publish không bị đổi giao diện |
| Mở web qua `EXPO_PUBLIC_WEB_URL` | Mobile chưa sửa bước tại chỗ (phase 2) | Cần đặt biến này trong env của app mobile, nếu không nút mở web không dùng được |

## 4. Commit (`git log --oneline dev..HEAD`)

```text
131c9027 feat(mobile): mark unfinished steps and finish them on the web
ce57e19f fix(mobile): reset a half-saved AI draft and tidy the generator
353e4f26 feat(mobile): AI generator builds the draft right away
2c73fe02 feat(mobile): load workflow readiness
4bee696d fix(mobile): readiness reasons use existing provider labels
7186c715 feat(mobile): auto-pick and readiness helpers
7c8b44a4 feat(gateway): expose workflow readiness
adacfa51 docs(workflow): state what readiness checks
959486fa feat(workflow): read-only readiness check for a workflow draft
635eb438 docs(plan): mobile AI generation builds first (phase 1)
1d9d2963 docs(spec): mobile AI generation builds first (phase 1)
```

## 5. Vùng thay đổi

- `services/workflow-service`: `WorkflowPublicationService`, `WorkflowController`, `WorkflowReadinessResponse`; test `WorkflowPublicationTest`, `WorkflowReadinessHttpTest`.
- `services/api-gateway`: route readiness trong `src/workflow/workflow.module.ts`; `test/routes.e2e-spec.ts`.
- `packages/contracts/http/workflow/openapi.yaml`: thêm endpoint readiness (additive).
- `apps/mobile`: `features/ai` (auto-pick, generate-request, bỏ `QuestionsForm`, `ScheduleField`, `schedule`), `features/workflows` (`readiness.ts`, `SetupOnWebSheet`, `FlowCards`, `FlowList`, `useWorkflows`), `infrastructure/http` (DTO, mapper, repository), `stores/i18n.*`.

## 6. Lệnh đã chạy và kết quả

| Lệnh | Kết quả |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (workflow-service, JDK 25) | 1241 tests, 0 failure, 2 error đều là lỗi môi trường đã biết (`HttpTransportIntegrationTest` x2: thiếu TLS test certificate); `WorkflowReadinessHttpTest` 5/5 và `WorkflowPublicationTest` PASS; BUILD FAILURE chỉ vì 2 lỗi này |
| `pnpm --dir services/api-gateway test` | PASS: 13 suites, 194 tests |
| `pnpm --dir services/api-gateway test:e2e` | PASS: 11 suites, 165 tests |
| `pnpm --dir services/api-gateway build` | PASS (`nest build`) |
| `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"` | PASS, không cảnh báo |
| `node --test $(find src -name "*.test.cjs")` (apps/mobile) | PASS: 273 tests, 0 fail |
| `npx tsc --noEmit -p .` (apps/mobile) | PASS |
| `git diff --check dev...HEAD` | PASS |

## 7. Bằng chứng và giới hạn

- Readiness được phủ bởi test HTTP tích hợp của workflow-service (`WorkflowReadinessHttpTest`, đi qua JWT filter chain thật) và e2e của gateway (`routes.e2e-spec.ts`).
- Không chạy `curl` trên stack sống: không khởi động/dừng container trong lượt này và curl có xác thực cần đăng nhập thật. Chưa có bằng chứng runtime trên stack docker.
- Chưa chạy trên thiết bị/emulator Android.

## 8. Rủi ro

| Mức | Vấn đề | Xử lý |
| --- | --- | --- |
| Trung bình | Nháp bị bỏ lại nếu người dùng thoát giữa chừng | Đã có reset nháp lưu dở (`ce57e19f`); nháp hoàn chỉnh vẫn nằm trong danh sách |
| Trung bình | Readiness chỉ là tư vấn, Publish vẫn có thể bị từ chối vì giới hạn Telegram / workflow được theo dõi / reference projection | Mobile hiển thị lỗi của Publish như trước |
| Thấp | Bản sao `autoPick` của web và mobile có thể lệch nhau | Cần đồng bộ thủ công khi đổi quy tắc |
| Thấp | Không có test component React Native (không có script test UI) | Chỉ test logic thuần bằng `*.test.cjs`; cần kiểm tra thủ công trên thiết bị |

## 9. Bàn giao: kiểm tra trên thiết bị Android (việc của người dùng)

1. Đặt `EXPO_PUBLIC_WEB_URL` cho app mobile, chạy app trên thiết bị/emulator với stack dev (có thể dùng `compose.ai-local.yml`).
2. Mở "Tạo bằng AI", sinh từ một prompt mẫu.
3. Kỳ vọng: vào màn workflow ngay, có các bước đỏ và thẻ "Còn N bước cần thiết lập".
4. Bấm một bước đỏ, thấy sheet, bấm "Mở bước này trên web", trình duyệt mở builder đúng bước đó.
5. Kỳ vọng: nút Publish bị mờ cho đến khi hết bước đỏ.

## 10. Việc tiếp theo

- Phase 2: chỉnh sửa bước bằng bottom sheet ngay trên mobile.
- Các lỗi nhỏ chưa xử lý: gọi fetch hai lần ở lần focus đầu; thay đổi prop không dùng của `FlowList`; chưa có chú thích khi chỉ có lỗi graph chặn Publish.

## 11. Commit sửa sau review cuối nhánh

Commit `fix(mobile): keep FlowList as before and guard the generator`:

- `FlowList.tsx`: trả về đúng bản trên `dev` (bỏ `Pressable` và props `issuesByStep`/`onStepPress` không ai dùng) để trợ năng của chat trợ lý và chi tiết mẫu không bị đọc là "disabled".
- `ai/generator.tsx`: thêm ref `mounted`; nếu người dùng đã rời màn hình trong lúc tạo/lưu thì không `router.replace` và không toast (nháp đã lưu, hiện trong danh sách). Quyết định nằm ở `shouldOpenDraft` trong `generate-request.ts`, có test.
- `ai/generator.tsx`: ô nhập và các câu ví dụ cùng dùng `changePrompt`, nên sau lỗi lưu, bấm ví dụ cũng xoá nháp lưu dở.
- `workflows/[id].tsx` và `useWorkflowReadiness(workflowId, enabled)`: chỉ gọi readiness cho workflow DRAFT; kéo để làm mới cũng tải lại readiness.
- Chú thích dưới nút Publish hiện mỗi khi Publish bị chặn; chỉ có lỗi graph thì dùng câu "Quy trình còn lỗi cần sửa trên máy tính." (readiness chỉ mang tính tư vấn, server vẫn có thể từ chối Publish).

Kết quả: `node --test` 274 pass / 0 fail; `npx tsc --noEmit -p .` PASS; `expo lint` các file đổi không có lỗi; `git diff --check` sạch. Chưa kiểm tra trên thiết bị.

## 12. Kiểm tra trên stack local bằng Expo web (2026-11-09)

Môi trường: stack dev build lại từ nhánh này (gateway, workflow-service, workspace-service, identity-service, ai-service); app mobile chạy Expo web ở `localhost:5173` trong Browser pane, `apps/mobile/.env.local` (git-ignored) trỏ API về `http://localhost:3000` và `EXPO_PUBLIC_WEB_URL=http://localhost:5173`. Tài khoản thử chưa có workspace nên tạo workspace "My workspace 1".

| Bước | Kết quả |
| --- | --- |
| Gọi route readiness không đăng nhập | 401, tức gateway mới đã có route |
| Màn "Tạo quy trình bằng AI" | Chỉ còn ô mô tả, 3 gợi ý, nút "Tạo quy trình"; không còn câu hỏi |
| AI giả lập (`compose.ai-local.yml`) | ai-service trả `AI_OUTPUT_INVALID`: intent mẫu trong `services/ai-service/test/fixtures/fake-deepseek.mjs` đã cũ. Có từ trước, không do nhánh này |
| DeepSeek thật, gợi ý "Mỗi sáng 8 giờ, gửi email nhắc lịch họp..." | ai-service OK, workflow-service trả `unsupported` / `INVALID_INTENT`; màn hình hiện đúng "AI không dựng được quy trình này:" kèm gợi ý viết lại, giữ nguyên mô tả |
| DeepSeek thật, gợi ý "Khi có yêu cầu mới từ webhook, ghi thông tin vào Google Sheets" | Tạo nháp và tự chuyển sang `/workflows/21938c98-…`; thẻ "Còn 1 bước cần thiết lập"; bước Google Sheets đỏ, nhãn "Cần thiết lập", lý do "Chọn tài khoản Google Sheets"; Publish `disabled` với chú thích "Hoàn tất 1 bước đỏ để xuất bản quy trình." |
| `GET .../readiness` | 200 `{"ready":false,"issues":[connectionId, spreadsheetId, range của ghi_sheets, mã REQUIRED_FIELD_MISSING]}` |
| Chạm bước đỏ | Sheet "Google Sheets", "Bước này cần thiết lập trên máy tính.", "Còn thiếu": Chọn tài khoản Google Sheets / Thiếu: Mã bảng tính Google Sheets / Thiếu: range |
| "Mở bước này trên web" | Mở `http://localhost:5173/workflows/21938c98-…/builder?step=ghi_sheets` (đúng bước) |
| Console | Chỉ có 2 cảnh báo React có sẵn của bản web (`importantForAccessibility`, `accessibilityElementsHidden` từ `Logo.tsx`) và một 401 do phiên đăng nhập web mất sau khi tải lại trang |

Ghi nhận thêm:
- "Thiếu: range" vẫn hiện tên trường tiếng Anh vì chưa có nhãn `aig.field.range` (lỗi nhỏ đã biết).
- Readiness được tải lại mỗi lần cửa sổ lấy lại focus, cùng lúc với chi tiết workflow và lịch sử chạy (hành vi `refetchOnWindowFocus` có sẵn của react-query), không phải vòng lặp riêng.
- Workspace thử "My workspace 1" và nháp "Ghi yêu cầu từ webhook vào Google Sheets" còn lại trong database dùng chung; xoá khi không cần.
- Chưa kiểm tra trên điện thoại Android thật.
