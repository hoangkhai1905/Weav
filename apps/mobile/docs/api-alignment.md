# Báo cáo đối chiếu API: mobile Weav ↔ API Gateway

Phạm vi: bước 1 mục 8 của `weav-mobile-agent-prompt.md` (chỉ báo cáo, chưa sửa code). Nguồn sự thật theo thứ tự: controller gateway > DTO Java/TS > OpenAPI. Tham chiếu `file:dòng` tính từ gốc repo. Chỗ chưa kiểm chứng được ghi "chưa xác minh".

## 0. Gateway expose route như thế nào

Gateway **không proxy wildcard**. Mỗi route là một handler tường minh, validate bằng zod (strict, UUID, page/size), rồi `fetch` sang service và bỏ tiền tố `/api/v1`.

| Nhóm | File gateway | Cách đi |
|---|---|---|
| auth, users | `services/api-gateway/src/identity/identity.module.ts:348,497` | proxy tường minh sang identity |
| workspace, members, **connections** | `services/api-gateway/src/workspace/workspace.controller.ts:137` (connections ở dòng 259-440) | sang workspace-service (connections thuộc workspace-service, không phải workflow-service) |
| workflows, executions, generate | `services/api-gateway/src/workflow/workflow.module.ts:285-512` | `WorkflowProxyService.forward` sang `/workspaces/{id}/workflows/...` của workflow-service |
| notifications v2 | `services/api-gateway/src/notifications/notifications.module.ts:91` | sang notification-service (còn route legacy dòng 47) |
| assistant | `services/api-gateway/src/assistant/assistant.module.ts:127` | chat là **SSE**, 3 route còn lại là JSON |
| webhooks (public) | `workflow.module.ts:517,563` | không dùng cho mobile |

Hệ quả: `packages/contracts/http/gateway/openapi.yaml` chỉ mô tả workspace/connections (có test e2e ghim 20 operation, `gateway/README.md`) và `assistant.openapi.yaml`. **Workflow/execution không có OpenAPI cấp gateway**; `workflow/openapi.yaml` ghi path nội bộ không có `/api/v1` (`workflow/openapi.yaml:6-8`).

## 1. Endpoint mobile đang gọi ↔ gateway

Trạng thái: OK / SAI PATH / THIẾU (không có route trên gateway) / CHƯA DÙNG.

### 1.1 Đã khớp

| Mobile gọi (file) | Route gateway | Trạng thái |
|---|---|---|
| `POST /api/auth/login, register, logout, refresh` (`http-auth.repository.ts:202-240`) | `identity.module.ts:353-383` | OK |
| `GET/PATCH /api/auth/me` (`profile.http.contract.ts:3`) | `identity.module.ts:393,400` | OK |
| `change-password`, `forgot-password`, `otp/verify`, `reset-password` (`password*.contract.ts`) | `identity.module.ts:411-456` | OK |
| `GET/DELETE /api/auth/sessions[/:id]` (`session.http.contract.ts:7`) | `identity.module.ts:466-481` | OK |
| `POST /api/auth/otp/request` | `identity.module.ts:422` | chưa xác minh mobile có gọi (grep chỉ thấy `otp/verify`) |
| `GET /api/users/me/oauth-accounts`, `GET/PUT/DELETE /api/users/me/avatar` | `identity.module.ts:551-581` | CHƯA DÙNG |
| Workspace CRUD + members (`workspace.http.contract.ts:79-147`, `http-workspace.repository.ts:111-154`) | `workspace.controller.ts:142-250` | OK |
| `GET /api/v2/notifications`, `unread-count`, `PATCH :id/read`, `POST read-all` (`notification.http.contract.ts:8`) | `notifications.module.ts:99-146` | OK |

### 1.2 Sai hoặc thiếu (sửa ở bước 4)

| Mobile gọi hiện tại | Route thật | DTO thật | Trạng thái |
|---|---|---|---|
| `GET /api/workflows` (`http-workflow.repository.ts:7`) | `GET /api/v1/workspaces/{ws}/workflows?page&size` (`workflow.module.ts:331`) | `{items: Summary[], page, size, totalElements}` (không `hasNext`, không `totalPages`) | SAI PATH |
| `GET /api/workflows/:id` (`:16`) | `GET .../workflows/{wf}` (`:348`) | `WorkflowResponse` (`WorkflowResponse.java:15-29`) | SAI PATH |
| `POST /api/workflows/:id/run` (`:25`, body `{inputPayload}`) | `POST .../workflows/{wf}/executions`, body `{input: {}}` bắt buộc (`:452`, schema `workflow.module.ts:83`) | 202 `{executionId, workflowId, workflowVersionId, status:"QUEUED"}` (`ExecutionResponse.java:23`) | SAI PATH và SAI BODY (zod `.strict()`, thiếu `input` là 400) |
| `POST /api/workflows/:id/pause`, `/resume` (`:34,43`) | `POST .../{wf}/pause`, `/resume` (`:418,435`) | 200 `WorkflowResponse`, nhưng `triggers` luôn `[]` (5.5) | SAI PATH |
| `GET /api/executions` (`http-execution.repository.ts:7`) | không có endpoint toàn workspace | n/a | THIẾU |
| `GET /api/executions/:id` (`:16`) | `GET .../workflows/{wf}/executions/{ex}?logPage&logSize` (`:490`) | `ExecutionResponse.Detail` (`ExecutionResponse.java:48-58`) | SAI PATH, cần thêm `workflowId` |
| `POST /api/executions/:id/retry` (`:25`) | không có | n/a | THIẾU |
| `GET /api/connections`, `/:id` (`http-connection.repository.ts:7,16`) | `GET /api/v1/workspaces/{ws}/connections[/{id}]` (`workspace.controller.ts:268,279`) | list là **mảng** `ConnectionResponse[]` (`ConnectionController.java`, method `list`) | SAI PATH |
| `POST /api/connections/:id/test` (`:25`) | `POST .../connections/{id}/test` (`workspace.controller.ts:343`) | `{outcome: VERIFIED \| AUTH_INVALID \| DEPENDENCY_FAILURE}` (5.3) | SAI PATH và SAI SHAPE (mobile mong `{success,message,latencyMs}`) |
| (chưa có) disable connection | `POST .../connections/{id}/disable` (`:359`) | `ConnectionResponse` | CHƯA DÙNG |
| `POST /api/ai/generate-workflow` (`http-ai.repository.ts:7`) | `POST /api/v1/workspaces/{ws}/workflows/generate` (`workflow.module.ts:310`) | 200, union 3 dạng (mục 2 dòng 15) | SAI PATH; mobile mong `{reasoning, workflowPreview, validation}` không tồn tại |
| `GET /api/telegram/status`, `POST link-code`, `POST unlink` (`http-telegram.repository.ts`) | không có. Gateway chỉ có webhook công khai `api/v1/webhooks/telegram/:key` (`workflow.module.ts:563`) | n/a | THIẾU. `services/bot-service`, `bot-notification-service` chỉ còn thư mục rỗng/`node_modules` (không file git). Telegram nay là provider của Connection (`TELEGRAM`) và trigger `trigger.telegram` |
| (chưa có) `POST /api/v1/assistant/chat` | `assistant.module.ts:134` | **SSE** (5.1) | CHƯA DÙNG |
| (chưa có) `GET /api/v1/assistant/conversations?workspaceId&limit&before` | `:215` | `{items:[{conversationId,title,createdAt,updatedAt}]}` (`ai/openapi.yaml:285`) | CHƯA DÙNG |
| (chưa có) `GET .../conversations/{id}/messages` | `:234` | `{conversationId, workspaceId, title, messages:[{role:user\|assistant, content, createdAt}]}` tối đa 100 (`assistant.openapi.yaml:88-110`) | CHƯA DÙNG |
| (chưa có) `DELETE .../conversations/{id}` | `:248` | 204 | CHƯA DÙNG |
| (chưa có) `POST .../workflows`, `PUT .../{wf}/draft`, `POST .../{wf}/publish`, `DELETE .../{wf}` | `workflow.module.ts:290,365,384,401` | create 201 `{workflowId,status}`; draft 200 `WorkflowResponse`; publish 200 `Publication`; delete 204 | CHƯA DÙNG (cần cho AI Generator "Lưu nháp"/Publish và Xóa) |

## 2. Đối chiếu khẳng định của brief (mục 2-3)

| # | Khẳng định brief | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Path thật `/api/v1/workspaces/{ws}/workflows...` | XÁC NHẬN | `workflow.module.ts:285` |
| 2 | List `{items,page,size,totalElements}`, không `hasNext`, size ≤ 100, mặc định 20 | XÁC NHẬN | `WorkflowResponse.java` record `Page`; gateway size 1-100 (`workflow.module.ts:53`); Java default 20 (`WorkflowController.java`, method `list`) |
| 3 | Không search/filter server-side | XÁC NHẬN | `pageQuerySchema` chỉ `page,size`, `.strict()` (`workflow.module.ts:49-55`) |
| 4 | Fields của `WorkflowSummary` | XÁC NHẬN | `WorkflowResponse.java` record `Summary` |
| 5 | `WorkflowResponse = Summary + {definition, editorState, revision, triggers}` | XÁC NHẬN, nhưng `definition` là bản **draft** (`getDraftDefinition()`), không phải bản đang chạy | `WorkflowResponse.java:37-43` |
| 6 | Trigger `{triggerId,type,status,reasonCode,nextRunAt,lastTriggeredAt}` và 9 reasonCode | XÁC NHẬN (type/status là String ở Java; enum ở OpenAPI) | `WorkflowResponse.java` record `TriggerRegistration`; `workflow/openapi.yaml:615` |
| 7 | `definition = {schemaVersion,name,nodes:[{id,type,version,config,connectionId?}],edges:[{id,sourceNodeId,sourcePort,targetNodeId,targetPort}]}` | **MÂU THUẪN** (5.2) | `definition.schema.json:7-86,933-963`; `DefinitionJsonCodec.java:89-124` |
| 8 | `POST` tạo `{name}` → `{workflowId,status}` | XÁC NHẬN; HTTP **201**; body có thêm `description?` | `WorkflowController.java` `create`; `workflow.module.ts:57-62` |
| 9 | `PUT draft` 409 `DRAFT_REVISION_CONFLICT` | XÁC NHẬN; `details:[{field:"revision", message:"<revision hiện tại>"}]` | `WorkflowController.java` `handleDraftRevisionConflict` |
| 10 | publish trả `webhooks[].secret` một lần | XÁC NHẬN; 200; republish bản y hệt trả `webhooks: []`; thêm lỗi 409 `DRAFT_CHANGED`, 409 `TELEGRAM_BOT_IN_USE`, 502 `TELEGRAM_WEBHOOK_REGISTRATION_FAILED` | `workflow/openapi.yaml:162-211` |
| 11 | pause/resume sai trạng thái → 422 `StateConflict` | **MỘT PHẦN SAI** (5.4) | `InvalidStateException.java:6`; `Workflow.java:122-139` |
| 12 | `DELETE` → 204 | XÁC NHẬN; cần quyền `WORKFLOW_MANAGE_STATE` (brief không nhắc) | `WorkflowPublicationService.java:234-235` |
| 13 | generate body `{prompt ≤4000, timezone?, connections?, answers?}` | XÁC NHẬN ở Java. **Gateway cho tới 16.000 ký tự** (5.6) | `GenerateWorkflowRequest.java`; `workflow.module.ts:112` |
| 14 | Path generate | Brief **tự mâu thuẫn**: mục 2 ghi `/workflows/generate` (đúng), mục 3 ghi `POST /{id}/generate` (sai) | `workflow.module.ts:310` |
| 15 | generate 3 dạng ready / needs_input / unsupported | XÁC NHẬN nhưng **thiếu biến thể** và **sai format `field`** (5.7) | `WorkflowGenerationService.java:79-82,115` |
| 16 | generate có thể 429/502/503/504 | XÁC NHẬN; mã cụ thể ở 5.7 | `GlobalExceptionHandler.java:250-255` |
| 17 | `POST executions` 202, `Idempotency-Key` 8-128 `[A-Za-z0-9._:-]` | XÁC NHẬN; header **tùy chọn** (`required=false`); gateway âm thầm bỏ key sai pattern (5.10) | `WorkflowExecutionController.java:49`; `request-context.ts:130,149-151` |
| 18 | Cùng key → cùng `executionId` | XÁC NHẬN, phạm vi theo workflow; replay trả nguyên văn 202 `QUEUED`; cùng key khác `input` → **422 `IDEMPOTENCY_KEY_REUSED`** (brief không nhắc) | `WorkflowExecutionRepositoryAdapter.java:208-230` |
| 19 | 504 thì retry cùng key | XÁC NHẬN; 504 `UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN` chỉ cho ghi (POST/PUT/DELETE), đọc timeout trả 503 | `request-context.ts:193-198`; `workflow.module.ts` (`isWriteTimeout`) |
| 20 | Chưa publish / đang pause → 422 | XÁC NHẬN (`INVALID_STATE`) | `WorkflowExecutionRepositoryAdapter.java:299,311` |
| 21 | Execution list có `hasNext` | XÁC NHẬN (`(page+1)*size < total`) | `ExecutionResponse.java` record `Page` |
| 22 | `ExecutionSummary` không tên workflow, không error | XÁC NHẬN | `ExecutionResponse.java` record `Summary` |
| 23 | Detail `?logPage&logSize`, logs có `hasNext` | XÁC NHẬN; mặc định `logSize=20`, tối đa 100 | `WorkflowExecutionController.java:68-74` |
| 24 | `NodeState`, `LogEntry` | XÁC NHẬN field; `output`/`error` là `Object` (không schema cố định); enum `LogLevel` Java chưa đọc (chưa xác minh), OpenAPI nói DEBUG/INFO/WARN/ERROR | `ExecutionResponse.java:61-90` |
| 25 | Tên node lấy từ `definition.nodes` | **MÂU THUẪN**: `definition.nodes[]` không có `name`. Nhãn do web ghi ở `editorState.nodes[nodeId].name` (kèm `position`) | `apps/web/src/api/workflow-v1.api.ts:342-343,358` |
| 26 | Connection list là mảng + fields | XÁC NHẬN | `ConnectionResponse.java:19-34` |
| 27 | test → `{outcome: VERIFIED\|AUTH_INVALID}` | **THIẾU** `DEPENDENCY_FAILURE` (5.3) | `ConnectionTestResult.java:26-30` |
| 28 | Workspace list có `totalPages` | XÁC NHẬN (workspace và members có, workflows không) | `PageResult.java:10-11` |
| 29 | `POST workspaces` header `Idempotency-Key` | XÁC NHẬN, tùy chọn | `WorkspaceController.java:53` |
| 30 | Notification `EXECUTION` có `workspaceId`+`executionId`, không `workflowId` | XÁC NHẬN | `notification-catalog.ts:10`; `inbox.persistence.ts:94` |
| 31 | Error envelope gateway và service "cùng dạng" | **MÂU THUẪN** (5.8) | 3 dạng |
| 32 | Telegram backend đã gỡ | XÁC NHẬN cho route app-facing | `workflow.module.ts:563` |
| 33 | Assistant 4 route | XÁC NHẬN, nhưng chat là **SSE** (5.1) | `assistant.openapi.yaml:18-47` |

## 3. Lệch domain type mobile (`apps/mobile/src/domain/**`) so với DTO

### 3.1 Workflow (`workflow.types.ts`)

| Mobile | DTO thật |
|---|---|
| `id` | `workflowId` |
| `version: number` | không có; có `schemaVersion: string`, `currentVersionId: uuid\|null`, `revision: number` (chỉ detail) |
| `triggerType: string` | không có trên workflow; trigger ở `triggers[]` (chỉ detail, rỗng sau pause/resume) |
| `ownerName` | không có (web gán `''`, `workflow-v1.api.ts:337`) |
| `lastRunAt` | không có |
| `workspaceId` | không có trong response, lấy từ route |
| `description?` | `description: string\|null` |
| thiếu | `publishedAt\|null`, `definition`, `editorState`, `triggers` |
| `WorkflowNode.{name,position}` | `nodes[].{id,type,config}`; name/position ở `editorState.nodes[id]` |
| `WorkflowEdge.{source,target}` | thật `{id,source,target,sourcePort?}` (**đúng** với schema; brief sai) |
| `getWorkflows(): Workflow[]` | trang `{items,page,size,totalElements}`: cần infinite query |
| `runWorkflow(id, input?)` | cần `workspaceId`, `{input:{}}`, `Idempotency-Key`; trả `{executionId, workflowId, workflowVersionId, status}` |

### 3.2 Execution (`execution.types.ts`)

| Mobile | DTO thật |
|---|---|
| `id` | `executionId` |
| `workflowName` | không có (chỉ `workflowId`, phải join client) |
| `ExecutionStatus` thiếu `WAITING` | `QUEUED, RUNNING, WAITING, SUCCESS, FAILED, CANCELLED` |
| `triggerType: string` | enum `MANUAL, SCHEDULE, WEBHOOK, TELEGRAM, GMAIL` |
| `startedAt` bắt buộc | `startedAt\|null`; thêm `createdAt` bắt buộc, `workflowVersionId` |
| `completedAt`, `durationMs` | `finishedAt\|null`; `durationMs` tự tính |
| `error?: string` | không có ở cấp execution; lỗi ở `nodes[].error` / `attempts[].error` (`Object`) |
| `nodeResults: Record<id,...>` | `nodes: NodeState[]` (mảng) |
| `NodeExecutionStatus` 4 giá trị | `PENDING, READY, RUNNING, WAITING, SUCCESS, FAILED, SKIPPED, CANCELLED` |
| `NodeExecutionResult.{nodeName, durationMs, retryCount, completedAt, input, error:string}` | `{nodeExecutionId, nodeId, nodeType, status, attemptCount, startedAt, finishedAt, output, error, attempts[{attemptId, attemptNumber, status, startedAt, finishedAt, output, error}]}`; không có `input`, không có tên |
| `ExecutionLogItem.timestamp` | `createdAt` |
| `level` có `SUCCESS` | không tồn tại; thật `DEBUG, INFO, WARN, ERROR` |
| `ExecutionLogItem.{nodeId,nodeName}` | `nodeExecutionId\|null`, `attemptId\|null`; thêm `eventType`, `message\|null`, `metadata` |
| `logs?: Item[]` | `logs: {items,page,size,totalElements,hasNext}` |
| `retryExecution` | xóa (không có endpoint) |
| `getExecution(id)` | cần `(workflowId, executionId)` |

### 3.3 Connection (`connection.types.ts`)

| Mobile | DTO thật |
|---|---|
| `provider: gmail\|sheets\|telegram\|http` | `GMAIL, GOOGLE_SHEETS, GOOGLE_CALENDAR, GOOGLE_DRIVE, TELEGRAM, HTTP` |
| `status: CONNECTED\|EXPIRED\|DISCONNECTED` | `ACTIVE, INVALID, DISABLED` |
| `createdBy: string` (tên) | `createdBy: uuid` |
| `lastRunAt` | không có; có `lastVerifiedAt\|null`, `credentialExpiresAt\|null` |
| thiếu | `workspaceId`, `authType (NONE,TOKEN,API_KEY,BASIC,OAUTH2)`, `config\|null`, `hasCredential`, `canManage`, `canAttach`, `updatedAt` |
| `testConnection → {success,message,latencyMs}` | `{outcome}`; không có latency/message |

### 3.4 AI (`ai.types.ts`)

Mobile mong `{prompt, reasoning, workflowPreview: Workflow, validation}`. Thật là union theo `status`: `ready {name, definition, layout:{[nodeId]:{x,y}}}`, `needs_input {questions:[{code,field}]}`, `unsupported {reasons:[{code}]}`. Request thêm `timezone?`, `connections?`, `answers?`. Không có `reasoning`/`validation`; `ready.definition` chưa phải `Workflow`, muốn lưu phải `POST` tạo rồi `PUT draft`.

### 3.5 Telegram (`telegram.types.ts`)

Không còn contract tương ứng. Type, repository, mock, hook `features/telegram/hooks/useTelegram.ts` và màn `src/app/(app)/telegram/index.tsx` là code chết cần gỡ.

### 3.6 ApiError (`error.types.ts`)

`ApiErrorCode` thiếu mã thật: `INVALID_STATE`, `IDEMPOTENCY_KEY_REUSED`, `DRAFT_REVISION_CONFLICT`, `DRAFT_CHANGED`, `AI_QUOTA_EXCEEDED`, `AI_UNAVAILABLE`, `AI_TIMEOUT`, `GENERATION_RATE_LIMITED`, `UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN`, `DEPENDENCY_UNAVAILABLE`, `VALIDATION_ERROR`. Kiểu `code: ApiErrorCode | string` đã chứa được; cần bổ sung union và i18n. `normalizeApiError` (`http-client.ts:67-99`) đã đọc `error.code/message/details` và `requestId` (body hoặc header); `codeForStatus` (`:55-65`) thiếu 422/504, chỉ dùng khi body không có code.

## 4. Gap (mục 4 brief) đã kiểm chứng

| Gap | Không tồn tại? | Bằng chứng | Xử lý mobile |
|---|---|---|---|
| Lịch sử execution toàn workspace | Đúng | chỉ có `GET .../workflows/{wf}/executions` (`workflow.module.ts:471`); workflow-service chỉ có `WorkflowExecutionController` | gộp client trong **một** hàm `listRecentWorkspaceExecutions()`. Cần `WORKFLOW_MONITOR` (`ExecutionQueryService.java:13`); workflow nào 403 thì bỏ qua |
| Dashboard stats | Đúng | gateway không có route stats | tính client, nhãn "trong N lượt gần nhất" |
| Retry / re-run | Đúng | grep `retry\|cancel` trong `workflow-service/.../presentation`: 0 kết quả | bỏ Retry; "Chạy lại workflow" khi `PUBLISHED` |
| Cancel/stop | Đúng | như trên (`CANCELLED` chỉ là giá trị enum) | không có nút Stop |
| Search/filter workflow server | Đúng | `.strict()` ở `workflow.module.ts:49-55` | lọc client trên trang đã tải |
| `lastRunAt`/`triggerType` ở list | Đúng | record `Summary` | chỉ hiển thị ở detail |
| Telegram link | Đúng | mục 1.2 | gỡ màn/hook/repo/mock/type khỏi factory |
| Expo push token | Không thấy endpoint | grep `push-token`/đăng ký thiết bị ở gateway và notification-service không có route (các kết quả khớp từ khóa chỉ là `retry`/`expiry` ở chỗ khác); chưa duyệt từng file | polling như hiện tại |
| Duplicate / version history | Đúng | không có route | không làm |

Gap brief chưa nêu: (a) không lấy được 1 execution nếu thiếu `workflowId` (5.9); (b) trigger chỉ có ở detail, nên mục "Cần chú ý: trigger DISABLED" phải gọi detail từng workflow (N+1), nên giới hạn số workflow.

## 5. Mâu thuẫn contract

### 5.1 Assistant chat là SSE
`assistant.openapi.yaml:21-47`, `assistant.module.ts:134-213`: phản hồi `text/event-stream` gồm `conversation`, `delta`, `tool_call`, `tool_result`, `draft`, kết thúc bằng `done` hoặc `error`. Axios trên React Native không stream; cần `fetch` streaming (chưa xác minh `expo/fetch` trong docs SDK 57) hoặc XHR `onprogress`. Giới hạn: body 256 KiB, deadline 75 s, `message` 1-4000; `draft` chỉ là đề xuất. Ảnh hưởng thẳng đến phương án fake gateway (mục 6). Brief không nhắc SSE.

### 5.2 Hình dạng `definition` trong brief sai
Brief dòng 78 khác thực tế (`definition.schema.json:7-86,933-963`; `DefinitionJsonCodec.java:89-124`; `examples/manual-http-condition.json`): thật là `{schemaVersion:"1.0", nodes:[{id,type,config}], edges:[{id,source,target,sourcePort?}], variables?}`. Không có `name` ở definition, không `version` ở node, `connectionId` nằm **trong `config`** (`definition.schema.json:169`), không `targetPort`. `type` dạng `trigger.manual`, `http.request`, `google.sheets`... (19 giá trị, `definition.schema.json:57-77`). `generate.ready.definition` cùng dạng (`WorkflowGenerationService.java:101`). Fixture phải theo dạng thật.

### 5.3 Test connection có 3 outcome
`ConnectionTestResult.java:26-30`: `VERIFIED, AUTH_INVALID, DEPENDENCY_FAILURE`. Brief chỉ nêu hai. `oauth/complete` cũng trả `ConnectionTestResult` (`ConnectionController.java`, `completeGoogle`).

### 5.4 State machine, mã 422, quyền
- Mã lỗi là `INVALID_STATE` (`InvalidStateException.java:6`). `StateConflict` chỉ là tên component OpenAPI (`workflow/openapi.yaml:811`).
- `pause()` khi đã PAUSED và `resume()` khi đã PUBLISHED là no-op trả **200** (`Workflow.java:122-139`). 422 chỉ khi DRAFT/đã xóa/chưa có version.
- `publish` khi đang PAUSED giữ nguyên PAUSED (`Workflow.java:105-107`).
- Quyền: pause/resume/**delete** cần `WORKFLOW_MANAGE_STATE` (`WorkflowPublicationService.java:235,257`); publish cần `WORKFLOW_PUBLISH` (`:149`); list/detail cần `WORKSPACE_VIEW` (`WorkflowDraftService.java:141,147`); run cần `WORKFLOW_RUN`; xem execution cần `WORKFLOW_MONITOR`. Member mặc định có CREATE/EDIT/RUN/MONITOR (`WorkspaceAuthorizationPolicy.java:17-20`); chỉ PUBLISH và MANAGE_STATE phụ thuộc cờ `canPublishWorkflow`/`canManageWorkflowState`.
- Hệ quả UI: nút Xóa phải ẩn theo `canManageWorkflowState` (brief chỉ nói pause/resume/publish).
- Quyền của chính mình: lấy từ bản ghi của mình trong `GET members` (có `role`, `canPublishWorkflow`, `canManageWorkflowState`). Chưa xác minh `WorkspaceResponse` có trả quyền caller (`createdBy` thì có).

### 5.5 Pause/resume trả `triggers: []`
`WorkflowController.java` `pause/resume` dùng `WorkflowResponse.from(workflow)` (registrations rỗng) trong khi `GET` dùng `currentTriggers(...)`. Không dùng response pause/resume để cập nhật Triggers; phải invalidate query detail. Mock phải y hệt.

### 5.6 Giới hạn prompt generate: gateway 16.000, service 4.000
`workflow.module.ts:112` so với `GenerateWorkflowRequest.java` và `workflow/openapi.yaml:536`. Server thật vẫn 400 từ 4001. Mobile validate 4000. Body tối đa 32 KiB (`workflow.module.ts:103`). Ngoài ra `prompt + answers` ≤ 3900 ký tự, `answers` ≤ 10, nên vòng `needs_input` có thể 400 nếu prompt dài.

### 5.7 Generate: biến thể ngoài brief
- `questions[].code` có thêm **`CONNECTION`**, `field` = node type (ví dụ `email.send`); trả lời bằng `connections: {nodeType: connectionUuid}`, không phải `answers` (`WorkflowGenerationService.java:79-80`).
- `reasons[].code` có thêm **`INVALID_INTENT`** (`:115`), cũng dùng khi model trả output hỏng `AI_OUTPUT_INVALID` (`:73`).
- `field` của `VALUE` là `"<nodeType>.<field>"` (ví dụ `email.send.body`, `:82`; OpenAPI `workflow/openapi.yaml:545`). Brief dòng 84 ghi `<nodeId>.config.<field>` là **sai**.
- Mã lỗi: 429 `AI_QUOTA_EXCEEDED` (hạn mức ngày) khác 429 `GENERATION_RATE_LIMITED` (theo phút); 503 `AI_UNAVAILABLE`; 504 `AI_TIMEOUT` hoặc `UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN` (`GlobalExceptionHandler.java:250-255`).
- `httpClient` mobile timeout 10 s (`http-client.ts:8`) nhỏ hơn deadline gateway 80 s (`workflow.module.ts:104`); cần timeout riêng cho route này (đề xuất ≥ 85 s).

### 5.8 Error envelope có 3 dạng
| Nguồn | Dạng | File |
|---|---|---|
| Java service (gateway pass-through) | `{error:{code,message,details:[{field,message}]}, timestamp, status, path}` | `ApiErrorResponse.java` |
| Gateway tự sinh (filter) | `{error:{code,message,details}, requestId}`, không `status/timestamp/path` | `gateway-exception.filter.ts:132-135` |
| `WorkflowProxyService.fail()` | `{error:{...}, status, requestId}` | `workflow.module.ts:187-191` |

Brief nói "cùng dạng". `normalizeApiError` chịu được cả ba (status từ `response.status`, requestId từ body hoặc header). Fake gateway nên phát đúng dạng theo nguồn lỗi. `details` do gateway sinh có thể là mảng chuỗi (`gateway-exception.filter.ts:112-113`), nên `details[].field` chỉ chắc chắn với lỗi từ Java.

### 5.9 Execution detail cần `workflowId`, notification không mang
Xác nhận brief mục 5.6. Dò qua `GET .../workflows/{wf}/executions/{ex}` trên từng workflow (tuple sai trả 404, `workflow/openapi.yaml:802`): tốn N request. Nhắc: `notification.target.ts:30-33` hiện điều hướng `/(app)/executions/${executionId}` và `notification.target.test.cjs` kiểm tra điều này; đổi route sẽ phải sửa test.

### 5.10 Idempotency-Key sai pattern bị bỏ im lặng
Java trả 400 nếu key sai (`ExecutionAdmissionService.java:88-95`) nhưng gateway lọc trước, chỉ forward key hợp lệ (`request-context.ts:149-151`). Key sai pattern thì lệnh chạy **không idempotent** mà không báo lỗi. Mobile phải tự validate và sinh key đúng pattern (ví dụ `run:<uuid>`).

### 5.11 Điểm nhỏ
- Workflow list không có `hasNext`: client tự suy `(page+1)*size < totalElements`.
- Brief ghi poll 2 s; hook hiện poll 1,5 s và chỉ dừng khi không còn `QUEUED/RUNNING`, **thiếu `WAITING`** (`useExecutionDetail.ts:10`).
- `GET workflow` trả `definition` là draft: với workflow PUBLISHED đã sửa draft, sơ đồ có thể khác bản đang chạy (chưa có endpoint đọc version đã publish; chưa xác minh).
- `trigger.manual` không có trigger registration; execution `triggerType` vẫn có `MANUAL`.
- `POST /api/v1/workspaces` chấp nhận `name` null (`workspace.controller.ts:62-65`).
- `listConversations` phân trang bằng `before` = `updatedAt` ISO có offset (`assistant.module.ts:48-52`).

## 6. Đề xuất triển khai: fake gateway hay `Mock*Repository`

Hiện trạng (`apps/mobile/src/infrastructure/mock/`): 9 file, 976 dòng. `mock-data.ts` (279 dòng) ở dạng view model sai contract. Chỉ `mock-notification.repository` có test (`mock-notification.repository.test.cjs`, kiểm tra cô lập theo tài khoản). `repository-factory.ts` chọn repo khi import theo `EXPO_PUBLIC_API_MODE`; test `run-workflow.session.test.cjs` import `workflowRepository` từ factory và ghi đè `runWorkflow`.

**Khuyến nghị: fake gateway ở tầng transport (axios adapter), giữ `Http*Repository` làm đường duy nhất cho workflow/execution/connection/ai.** Lý do:
1. Mục tiêu "đổi sang `http` là chạy backend thật không sửa UI": adapter giữ nguyên path builder, mapper, `normalizeApiError`, Idempotency-Key, polling; chỉ khác transport. Mock repo buộc bảo trì hai đường song song và dễ trôi lệch.
2. Các mock repo workflow/execution/connection/ai/telegram hiện không tái dùng được (sai shape, không test): xóa.
3. State machine, 403/422, phân trang, idempotency, trễ, lỗi ép (401/503/504/offline) là hành vi "server", gom vào một module `fake-gateway` có test `.test.cjs` gọi thẳng handler.
4. Một lớp fixture DTO thô phục vụ cả fake gateway lẫn mapper test.
5. Giữ nguyên mock auth/notification/workspace đã có (và test của chúng) ở giai đoạn đầu, theo gợi ý brief mục 5.2.

Rủi ro cần xử lý:
- **Assistant SSE** (5.1): adapter axios không mô phỏng stream. Giữ `MockAssistantRepository` riêng cho chat (hoặc fake stream), dùng fake gateway cho 3 route JSON.
- Adapter phải nằm **sau** interceptor token để `http-client.auth.test.cjs` vẫn đúng; bật qua `httpClient.defaults.adapter` khi `API_MODE==='mock'` trước khi repo gọi.
- Test cũ bị ảnh hưởng khi đổi chữ ký repo/route: `run-workflow.session.test.cjs` (đọc text của `workflows.tsx`, `workflows/[id].tsx` để kiểm tra điều hướng `/(app)/executions/${res.executionId}`) và `notification.target.test.cjs`.

## 7. Cần bạn quyết định

1. Fake gateway (axios adapter) và giữ mock auth/notification/workspace hiện có; Assistant chat dùng mock riêng. Đồng ý?
2. Dùng các điều chỉnh sau làm chuẩn thay cho brief: 5.2 (`definition`), 5.4 (state machine, quyền xóa), 5.7 (`CONNECTION`, `INVALID_INTENT`, format `field`), 5.3 (`DEPENDENCY_FAILURE`).
3. Nhãn node lấy từ `editorState.nodes[id].name`, fallback `nodeType` đã dịch (workflow do AI sinh có thể thiếu `editorState`).
4. Route `executions/[workflowId]/[executionId]`; từ notification dò qua tối đa N workflow và ghi rõ giới hạn trong UI.
5. Cơ chế stream cho chat trên Expo SDK 57 (chưa xác minh `expo/fetch`); phương án giảm cấp là chờ `done` rồi hiển thị, vẫn phải parse SSE từ text.
6. Timeout riêng cho generate (≥ 85 s) và chat (≥ 80 s) thay vì 10 s mặc định.
