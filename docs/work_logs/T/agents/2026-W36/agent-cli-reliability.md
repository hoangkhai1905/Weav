# Nhật ký làm việc - 2026-09-06

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-06` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `main` / chưa xác định trong session |
| Người thực hiện | AI agent |
| Người review / nhận bàn giao | Người dùng / AI agent tiếp theo |
| Trạng thái cuối ngày | `Hoàn thành` |
| Phạm vi session | Chuẩn hoá việc điều khiển OpenCode CLI và Antigravity CLI |
| Liên kết liên quan | `docs/agent-cli-operations.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Đã chốt thiết kế launcher chung, chỉ nhận workspace canonical `T:\Weav`.
- Đã thêm launcher có preflight, timeout cứng, mode an toàn và exit code ổn định.
- Đã áp dụng cleanup global config: tắt OpenCode `claude-mem` lỗi export bằng rename có thể khôi phục và loại alias `T:\Weav_Alias` khỏi trusted workspace.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `Không áp dụng` | Không thay đổi code ứng dụng |
| Unit / integration test | `PASS` | Parse, preflight, smoke và timeout path của launcher |
| Migration / database | `Chưa áp dụng` | Ngoài phạm vi |
| Health check | `Chưa kiểm tra` | Không có service endpoint liên quan |
| Review thay đổi | `Đã kiểm tra` | Diff/whitespace kiểm tra; giữ nguyên thay đổi identity planning có sẵn |
| Commit / PR | `Chưa tạo` | Người dùng chưa yêu cầu commit |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `scripts/agent-cli.ps1`.
- `docs/agent-cli-operations.md`.
- Spec/plan liên quan trong `docs/superpowers/`.
- Global OpenCode auto-discovered plugin entry và Antigravity trusted-workspace alias đã được người dùng cho phép chỉnh.

### Ngoài phạm vi

- Không sửa code nghiệp vụ, dependency, database, migration hoặc test ứng dụng.
- Không khôi phục/cập nhật AgentRouter.
- Không xoá file plugin `claude-mem.js` hay dữ liệu CLI.
- Không commit.

## 4. Bối cảnh và bằng chứng đầu session

- `opencode --version` trả `1.18.21`; `agy --version` trả `1.1.27`.
- Antigravity smoke trực tiếp với prompt không chứa nội dung repo trả `AGY_SMOKE_OK` trong giới hạn 30 giây.
- OpenCode `opencode models` không còn provider AgentRouter nhưng có model built-in `opencode/big-pickle`.
- OpenCode smoke với `--pure -m opencode/big-pickle` trả `OC_SMOKE_OK`.
- Log cũ ghi nhận `Plugin export is not a function`, thiếu account, policy rejection và concurrency limit; các lỗi này được coi là integration/provider signals, không phải lỗi source.
- Workspace canonical đã xác nhận là `T:\Weav`; `E:\WeavSub` từng là junction lịch sử và `T:\Weav_Alias` không còn tồn tại.

## 5. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng launcher PowerShell chung | Hai CLI đều có entrypoint Windows ổn định; cần timeout và exit code mà CLI không cung cấp đồng nhất | Gọi trực tiếp hoặc luôn dùng subagent | Gọi qua `powershell.exe -File`; không tự retry request đã start |
| Chỉ dùng `T:\Weav` | Người dùng xác nhận alias/junction chỉ là workaround cho runner cũ | Giữ fallback qua alias | Launcher từ chối path canonical khác |
| Tắt OpenCode claude-mem | Log lặp lại lỗi export; `--pure` smoke đã chứng minh OpenCode model vẫn chạy | Sửa plugin ngay | Giữ file dưới `claude-mem.js.disabled` để config lại sau |
| Dùng `opencode/big-pickle` mặc định | Model xuất hiện trong catalog và smoke thực tế thành công | AgentRouter đã bị xoá; không dùng model cũ | Preflight kiểm tra catalog trước khi chạy |

## 6. Thay đổi đã thực hiện

- Đã thêm spec `docs/superpowers/specs/2026-09-06-agent-cli-reliability-design.md`.
- Đã thêm plan `docs/superpowers/plans/2026-09-06-agent-cli-reliability.md`.
- Đã thêm launcher `scripts/agent-cli.ps1` với `Check`/`Run`, `Auto`, `Plan`/`AcceptEdits`, `-AllowRepoContext`, Windows-safe argument quoting, timeout và exit code `0/10/20/30/40`.
- Đã thêm hướng dẫn vận hành `docs/agent-cli-operations.md`.
- Đã thêm quy tắc launcher vào `AGENTS.md`.
- Đã bỏ khóa plugin trong global `opencode.json`; file auto-discovered được đổi tên thành `claude-mem.js.disabled`.
- Đã giữ `T:\Weav` và loại `T:\Weav_Alias` khỏi global Antigravity trusted-workspace settings.

## 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| CLI discovery | `Get-Command opencode`, `Get-Command agy` | PASS | Cài đặt trên máy hiện tại |
| Version | `opencode --version`; `agy --version` | PASS: `1.18.21`; `1.1.27` | Không chứng minh provider quota |
| Antigravity smoke | `agy --print ... --print-timeout 30s --mode plan --sandbox` | PASS: `AGY_SMOKE_OK` | Prompt không đọc/sửa repo |
| OpenCode catalog | `opencode models` | PASS: catalog có `opencode/big-pickle`; AgentRouter không có | Catalog không thay thế full task test |
| OpenCode smoke | `opencode run --pure --dir T:\Weav -m opencode/big-pickle ...` | PASS: `OC_SMOKE_OK` | Prompt không đọc/sửa repo |
| Script syntax | Windows PowerShell parser | PASS: `PARSE_OK` | Đúng shell hiện có trên máy |
| Launcher preflight | `powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Auto` | PASS: cả Antigravity và OpenCode ready | OpenCode dùng `opencode/big-pickle` |
| Antigravity launcher smoke | `... -Action Run -Tool Antigravity -TimeoutSec 60 ...` | PASS: `AGENT_BRIDGE_SMOKE_OK_AFTER_CLEANUP` | Prompt không đọc/sửa repo |
| OpenCode launcher smoke | `... -Action Run -Tool OpenCode -TimeoutSec 60 ...` | PASS: `OPEN_CODE_BRIDGE_SMOKE_OK_AFTER_CLEANUP` | Prompt không đọc/sửa repo |
| Removed AgentRouter guard | `... -Action Check -Tool OpenCode -Model agentrouter/removed-model` | PASS: emitted code `10`, no child request | AgentRouter không được dùng |
| Timeout path | `... -Action Run -Tool OpenCode -TimeoutSec 5 ...` | PASS: emitted code `30`, hard-timeout diagnostic; managed runner reported generic exit `1` | Không retry request |
| Resolved global config | `opencode debug config`; `agy --version`; settings JSON | PASS: plugin `[]`, MCP GitNexus còn, agy `1.1.27`, trust `T:\Weav` | Plugin file preserved as `.disabled` |
| Post-cleanup plugin log | Filter `Plugin export is not a function` in OpenCode log | PASS: last matching entry trước cleanup; không có entry mới sau cleanup | Log cũ được giữ nguyên |
| Static diff | `git diff --check` | PASS | Không ảnh hưởng `.env.example`/identity planning files có sẵn |

## 8. Rủi ro và việc tiếp theo

- OpenCode provider/account configuration có thể thay đổi; preflight phải được chạy trước mỗi task.
- Không tự động retry một task đã bắt đầu để tránh duplicate edits.
- Global config đã xác nhận sau cleanup; log không có lỗi claude-mem export mới.
- `git diff --check` đã chạy; các file identity planning có sẵn được giữ nguyên và không được stage/commit.

## 9. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Khi cần gọi agent CLI, chạy `Check` rồi `Run` theo `docs/agent-cli-operations.md`.
2. Khi muốn bật lại claude-mem cho OpenCode, đổi tên `claude-mem.js.disabled` về `.js` chỉ sau khi có cấu hình plugin tương thích mới.

### Hướng dẫn cho AI agent tiếp theo

- Dùng `T:\Weav` duy nhất.
- Đọc `docs/agent-cli-operations.md` trước khi gọi CLI.
- Không dùng `--dangerously-skip-permissions`, OpenCode `--auto`, AgentRouter hoặc alias lịch sử.
- Không commit nếu chưa có yêu cầu riêng.
- Không đưa secret, token, cookie, raw `.env` hoặc raw CLI logs vào log/chat.
