# Nhật ký 2026-09-17 — API Gateway

## Metadata và phạm vi

- Múi giờ Asia/Saigon; nhánh codex/api-gateway-v1, baseline 00cc5f8.
- Worktree D:/End/Weav-worktrees/api-gateway-v1; không sửa checkout gốc đang có thay đổi của người dùng.
- Luna max triển khai/test; controller review và kiểm tra độc lập theo yêu cầu người dùng.
- Nối tiếp docs/work_logs/2026-09-16-api-gateway-implementation.md và plan/spec cùng ngày 16.

## Trạng thái đầu session

- Task 0–2 hoàn tất review, chưa commit. Bằng chứng ngày 16: 45 unit tests, 17 Fastify HTTP-fixture E2E, build và diff check pass.
- Task 3 dừng do worker hết hạn mức, không phải lỗi source. Người dùng yêu cầu tiếp tục ngày 17; kiểm tra mới cho phép sử dụng bình thường. Không sử dụng reset credit.
- Đã resume đúng worker Lagrange, không tạo worker ghi code trùng phạm vi.
- JWT mới có route-policy matrix và impact trong task-3-report.md; chưa có triển khai/test JWT được nghiệm thu.

## Quyết định và ảnh hưởng

- Giữ các route auth public/optional/required theo matrix đã đối chiếu Identity; default bảo vệ route, OCR chỉ có ngoại lệ development đã duyệt.
- Impact file-scoped AppController/AppModule và controller Identity/Notification/OCR: LOW; caller qua module/bootstrap. Kết quả name-only UNKNOWN đã được phân giải bằng file, không coi UNKNOWN là an toàn.
- Không đổi database, migration, upstream business authorization, hay client trong task JWT.

## Kiểm tra, rủi ro và bàn giao

- Chưa chạy verification mới cho JWT; số test phía trên thuộc milestone transport đã hoàn tất.
- Raw multipart OCR chưa có cap mới; giữ tương thích và ghi rủi ro riêng.
- Chưa có upstream thật/tài khoản thử nghiệm nên chưa tuyên bố luồng authenticated UI hoặc real-service pass.
- GitNexus baseline chưa chứa file mới; phải cập nhật index và chạy complete detect_changes sau khi stage đúng file, trước commit.
- Tiếp theo: Luna hoàn tất Task 3, controller review/fix loop, sau đó Task 4 Workspace và Task 5 health/rate limits.
- Chưa commit, merge hoặc push.
