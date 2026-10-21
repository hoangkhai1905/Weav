# AI nodes: chọn nhà cung cấp AI bằng key riêng (BYO key)

| Trường | Giá trị |
| --- | --- |
| Cập nhật | 2026-10-21 (Asia/Saigon) |
| Nhánh | `feature/ai-provider-byok` từ `dev` @ `0ffc7247` |
| Spec / plan | `docs/superpowers/specs/2026-10-20-ai-provider-byo-key-design.md`, `docs/superpowers/plans/2026-10-20-ai-provider-byo-key.md` |
| Cách làm | Subagent-driven: Sonnet code, Opus review từng task + review toàn nhánh |
| Trạng thái | Đã merge vào `dev` (`ef05f106`, local, chưa push) sau khi test thật với Gemini |

## Kết quả

- 4 node AI (`ai.summarize`, `ai.classify`, `ai.extract`, `ai.generate`) có ô "AI dùng cho bước này": AI mặc định của Weav (DeepSeek) hoặc một kết nối ChatGPT (OpenAI) / Claude (Anthropic) / Gemini (Google); "Tên model" trong "Thêm tùy chọn".
- Kết nối mới `OPENAI` / `ANTHROPIC` / `GEMINI` (authType `TOKEN`, key 1..512 ký tự ASCII nhìn thấy được), key được kiểm tra bằng `GET models` khi lưu.
- workflow-service gửi `llm {provider, apiKey, model?}` tới ai-service; ai-service tạo adapter theo request (OpenAI-compatible cho OpenAI/Gemini/DeepSeek, Anthropic Messages), không qua circuit breaker, và bỏ `llm` trước khi dựng prompt.
- Lỗi thân thiện: key sai → "Kết nối lại"; model sai → "Mở quy trình"; hết hạn mức/tín dụng → "limit".
- Mobile đọc được 3 provider mới (trước đó danh sách kết nối sẽ lỗi toàn bộ).

## Quyết định

- Không viết node riêng cho từng hãng; giữ node theo việc, thêm nhà cung cấp.
- Key đi workflow-service → ai-service trong request nội bộ có service JWT; base URL của hãng là hằng số (không SSRF).
- Lỗi 400 của key riêng: chỉ coi là "model không tồn tại" khi body nói rõ; "credit balance" → hạn mức; key sai (Gemini trả 400) → xác thực.
- Chạy bằng key riêng vẫn tính vào hạn mức AI hằng ngày của Weav (giới hạn chi phí ai-service).
- Template chia sẻ bỏ `connectionId` thì bỏ luôn `model` của node AI.
- Mọi quyết định khác và các finding nhỏ để sau: ledger SDD (bản sao) trong thư mục ghi chú session `ai-provider-byok-sdd-ledger.md`.

## File chính

- Contracts/schema: `packages/workflow-schema/nodes/ai.*.json`, `packages/contracts/http/workflow/definition.schema.json`, `packages/contracts/http/ai/openapi.yaml`, `packages/contracts/http/workspace/openapi.yaml`.
- ai-service: `src/infrastructure/llm/{openai-compatible-provider,anthropic-provider,provider-http,provider-for}.ts`, `src/presentation/http/{envelopes,ai.controller}.ts`, `src/domain/errors.ts`, `src/config/ai-config.ts`.
- workspace-service: `ConnectionProvider`, `ConnectionProviderPolicy`, `CredentialPayloadCodec`, `ResolvedConnectionCredential`, `infrastructure/provider/llm/LlmKeyConnectionProvider.java`, `WorkspaceApplicationConfig`.
- api-gateway: `src/workspace/workspace.controller.ts` (allow-list provider).
- workflow-service: `infrastructure/ai/{AiNodeExecutor,AiClient,AiClientConfiguration}.java`, `WorkspaceClient`, `DefinitionValidator`, `RetryPolicy`, `ClasspathNodeSchemaSource`, `WorkflowGenerationService`, `TemplateSanitizer`.
- web: `lib/aiProviders.ts`, `components/builder/AiConnectionField.tsx`, `pages/ConnectionsPage.tsx`, `pages/WorkflowBuilderPage.tsx`, `components/connections/ConnectionGuide.tsx`, `lib/executions/friendlyError.ts`, `lib/publishErrors.ts`, i18n.
- mobile: `connection.types.ts`, `connection.mapper.ts`, `ConnectionCard`, i18n.
- `compose.dev.yml`, `.env.example`: `AI_OPENAI_DEFAULT_MODEL`, `AI_ANTHROPIC_DEFAULT_MODEL`, `AI_GEMINI_DEFAULT_MODEL` (mặc định `gpt-5-mini`, `claude-haiku-5-5`, `gemini-2.5-flash`).

## Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| ai-service `test` / `test:e2e` / `build` / eslint | 300 / 95 pass, build + lint sạch |
| workflow-service `./mvnw verify` (JDK 21, `-Djava.version=21`) | 1190 test, chỉ 3 lỗi môi trường đã biết |
| workspace-service test mới (`AiCredentialTest`, `LlmKeyConnectionProviderTest`) | pass; `verify` đầy đủ có 3 lỗi `WorkspaceNotificationRuntimeIntegrationTest` (thiếu `notification-service/dist`), coi là lỗi môi trường, chưa đối chiếu `dev` |
| api-gateway `test` / `test:e2e` | 192 / 163 pass |
| mobile `npx tsc --noEmit -p .` | sạch |
| web `tsc` / `build` | sạch; `lint` còn 3 lỗi có sẵn ở file không sửa |
| Playwright `ai-provider-step.spec.ts` + các spec builder | pass; `workspace-connections.spec.ts` "OCR picks the photo…" và "simple crons round-trip…" cũng fail trên `dev` (lỗi có sẵn) |
| GitNexus `detect-changes --scope compare` | **không chạy được**: segfault (exit 139) sau khi index lại; bù bằng tìm caller bằng text ở từng task + review toàn nhánh |

### Kiểm tra thật (stack dev, Gemini, 2026-10-21)

- Kết nối "Gemini (Google)" tạo trên giao diện, trạng thái Đang hoạt động, xác minh thành công (key do người dùng tự nhập).
- Workflow "Test Gemini BYOK" (Chạy thủ công → Tóm tắt bằng AI, chọn kết nối Gemini): lượt `876ca975` Thành công, bước AI 3.6 s, trả về `summary` tiếng Việt; log ai-service `llmProvider: GEMINI`, `outcome: OK`.
- Tên model sai `gemini-khong-ton-tai`: lượt `51e0e213` Lỗi, "Bước này thiếu hoặc sai phần thiết lập", trường lỗi `model`, nút "Mở quy trình"; log ai-service `AI_MODEL_NOT_FOUND`.
- Log 4 service (ai, workflow, workspace, gateway) không có chuỗi nào giống key Gemini (đếm `AIza` = 0).
- Không thử OpenAI/Anthropic (không có key), chưa thử key sai thật và hết tín dụng thật (đã có test tự động).
- Dữ liệu test còn lại trong workspace "test 1" (Neon dùng chung): kết nối "test gehihi (Gemini)" (`8b3b27b7-…`) và workflow "Test Gemini BYOK" (`818db416-…`, bản mới nhất đã chuyển về AI mặc định của Weav). Không xóa được kết nối vì các phiên bản đã xuất bản cũ vẫn tham chiếu nó (`ConnectionReferenceAdapter.inUse`, `version_id is not null`); code trước merge này không đọc được provider `GEMINI` nên phải dùng code từ `ef05f106` trở đi.

## Sửa thêm trong lúc test

- `fix(web): keep the connection row menu visible on the last row` (`72342ec2`): menu "..." ở hàng cuối trang Kết nối bị cắt do `overflow-hidden` của thẻ; lỗi có sẵn từ `d57ffae8`. Đã kiểm tra trong Browser pane: menu hiện đủ 3 mục, console không lỗi.

## Rủi ro / việc tiếp theo

- Chưa kiểm tra thật OpenAI (tham số `max_completion_tokens`, không gửi `temperature`) và Anthropic (tool use ép JSON).
- `GET /models` của OpenAI có thể vượt giới hạn body 64 KiB với tổ chức có nhiều model → báo lỗi phụ thuộc khi kiểm tra key.
- Thứ tự lỗi khi không có `llm` và DeepSeek chưa cấu hình: `INVALID_REQUEST`/`FORBIDDEN` đến trước `AI_NOT_CONFIGURED`.
- Gộp `resolveConnection` dùng chung cho các executor (bản sao thứ 4) để sau.
- Đã merge vào `dev`; người dùng push khi sẵn sàng. Ai chạy stack phải build lại ai-service, workspace-service, workflow-service, api-gateway và web.
- Kết nối đã từng dùng trong một phiên bản xuất bản thì không xóa được qua giao diện (theo thiết kế); cân nhắc thông báo rõ hơn "đang được sử dụng bởi lịch sử xuất bản".
