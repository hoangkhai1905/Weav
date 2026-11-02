# Nhật ký: workspace-service - sửa finding High (X-2, WS-2, WS-3)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-01 (Asia/Saigon) |
| Nhánh | `refactor/optimize-backend` (chưa commit) |
| Người thực hiện | AI agent (Claude) |
| Trạng thái | Hoàn thành code + test; chưa commit |
| Nguồn | `docs/reviews/2026-10-01-backend-review.md` WS-2, WS-3, §5.1 X-2 |

## 2. Kết quả

- WS-2: `TestConnectionUseCase` không còn gọi `provider.test` trong transaction/giữ khóa workspace và 1/3 Hikari connection.
- WS-3: `AddMemberUseCase` và `ListMembersUseCase` gọi Identity ngoài transaction.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| TestConnection 3 pha: read tx -> provider (không tx) -> `reauthorizeAndMutate` | Theo mẫu `ConnectionUsageProtection`/`CompleteConnectionOAuthUseCase` | Giữ nguyên mapping outcome, notification/outbox, `markInvalid`, `requireUnused` |
| Marker lỗi thời = authType + config + credential id + credential `updatedAt` | Chỉ những gì provider call phụ thuộc. Không dùng `updatedAt`/status của connection vì các lần test đồng thời tự đổi chúng (test `concurrentRepeatedConnectionMutationsWriteOnlyOneEventPerRealTransition` yêu cầu cả hai áp dụng) | Đổi config/credential giữa chừng => `ConflictException` (409), không ghi gì; người dùng test lại |
| AddMember: pre-check owner (tx ngắn, không khóa) -> Identity -> tx khóa + re-check owner + insert | Không để non-owner dò email qua Identity; lỗi UserNotFound/Inactive/AlreadyMember/Forbidden giữ nguyên; unique constraint vẫn là backstop | Thêm 1 tx đọc ngắn |
| ListMembers: tx đọc (auth + candidates) -> Identity -> tx ngắn cho page | Không giữ DB connection khi chờ Identity | `findCandidates` vẫn tải không giới hạn (Identity cần danh sách id để lọc/sắp xếp; giới hạn ở DB sẽ đổi kết quả) - để lại, ghi `ponytail:` |

## 8. File ảnh hưởng

| Loại | Đường dẫn |
| --- | --- |
| Sửa | `services/workspace-service/.../application/usecase/TestConnectionUseCase.java` |
| Sửa | `.../usecase/AddMemberUseCase.java`, `.../usecase/ListMembersUseCase.java` |
| Sửa | `src/test/.../usecase/TestConnectionUseCaseTest.java` (+3 test: không có tx/khóa khi gọi provider, connection đổi, credential thay) |
| Sửa | `src/test/.../usecase/MembershipUseCasesTest.java` (+1 test: Identity gọi trước tx/khóa) |
| Sửa | `docs/specs/services/workspace-service.md` (ghi chú transaction boundary) |

## 9. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (workspace-service) | PASS: 368 test, 0 fail, 0 error, 0 skip |
| `git diff --check` | sạch (chỉ cảnh báo CRLF của file workflow-service ngoài phạm vi) |

Chưa kiểm tra: không chạy với Identity/provider thật qua Gateway; không đo áp lực Hikari.

## 10. Rủi ro / bước tiếp theo

- Hai lần test connection đồng thời vẫn chạy provider song song (không còn khóa); kết quả cuối là lần ghi sau cùng.
- Giữa pha 1 và 3 provider thấy snapshot cũ; chủ ý, được bảo vệ bởi marker.
- Next: cân nhắc phân trang DB cho candidates của ListMembers nếu workspace rất lớn; chạy `detect_changes` trước commit.
