# Nhật ký làm việc - Mẫu chuẩn

> Mục tiêu: lưu lại đầy đủ bối cảnh, quyết định, thay đổi, bằng chứng kiểm tra và việc cần bàn giao của một ngày hoặc một session. File này là nguồn ngữ cảnh cho thành viên trong nhóm và AI agent tiếp nối công việc.

## Cách dùng

- Tạo một file mới trong `docs/work_logs/` cho mỗi ngày theo tên `YYYY-MM-DD.md`. Nếu một ngày có nhiều session, giữ chung một file và thêm một mục `Session` mới. Nếu việc nhiều thì có thể tạo file mới và thêm tóm tắt việc đã làm ở sau ngày.
- Ghi thông tin có thể kiểm chứng: file, endpoint, lệnh, kết quả, ticket/PR và quyết định. Phân biệt rõ `đã hoàn thành`, `đã kiểm tra`, `đang làm`, `chưa làm`.
- Không ghi mật khẩu, connection string có token, JWT secret, API key, cookie, dữ liệu cá nhân nhạy cảm hoặc nội dung `.env`. Chỉ ghi tên biến môi trường, loại cấu hình và nơi quản lý secret.
- Cập nhật log ngay sau một thay đổi đáng kể hoặc trước khi bàn giao. Người tiếp nhận phải đọc phần `Trạng thái bàn giao` và `Việc tiếp theo` trước khi sửa code.
- Không chép nguyên output quá dài. Giữ kết luận, lỗi tiêu biểu và lệnh tái lập; đính kèm đường dẫn log/CI nếu cần bằng chứng đầy đủ.

---

# Nhật ký ngày `YYYY-MM-DD`

## 1. Metadata

| Trường                       | Giá trị                                    |
| ---------------------------- | ------------------------------------------ |
| Ngày làm việc                | `YYYY-MM-DD`                               |
| Múi giờ ghi log              | `Asia/Saigon`                              |
| Dự án / repository           | `<tên dự án>`                              |
| Nhánh / commit đầu ngày      | `<branch>` / `<short SHA hoặc N/A>`        |
| Người thực hiện              | `<tên hoặc vai trò>`                       | 
| Người review / nhận bàn giao | `<tên hoặc vai trò>`                       |
| Trạng thái cuối ngày         | `Hoàn thành` / `Đang tiếp tục` / `Bị chặn` |
| Phạm vi session              | `<một câu mô tả>`                          |
| Liên kết liên quan           | `<issue, PR, Notion, ticket, ADR>`         |

## 2. Tóm tắt điều hành

### Kết quả chính

- `<Kết quả hoặc khả năng mới đã có; nêu giá trị cho hệ thống/người dùng.>`
- `<Kết quả thứ hai.>`
- `<Kết quả thứ ba.>`

### Tình trạng nhanh

| Hạng mục                | Trạng thái                       | Ghi chú ngắn                |
| ----------------------- | -------------------------------- | --------------------------- |
| Build / compile         | `PASS` / `FAIL` / `Chưa chạy`    | `<lệnh và phạm vi>`         |
| Unit / integration test | `PASS` / `FAIL` / `Chưa chạy`    | `<số test hoặc bằng chứng>` |
| Migration / database    | `PASS` / `FAIL` / `Chưa áp dụng` | `<schema/migration>`        |
| Health check            | `UP` / `DOWN` / `Chưa kiểm tra`  | `<endpoint>`                |
| Review thay đổi         | `Đã kiểm tra` / `Chưa kiểm tra`  | `<diff/check>`              |
| Commit / PR             | `<SHA, PR hoặc chưa tạo>`        | `<lý do nếu chưa tạo>`      |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. `<Mục tiêu 1>`
2. `<Mục tiêu 2>`
3. `<Mục tiêu 3>`

### Trong phạm vi

- `<Thành phần, service, tài liệu hoặc môi trường được phép sửa.>`

### Ngoài phạm vi / chủ động chưa làm

- `<Việc liên quan nhưng chưa được yêu cầu; nêu rõ để tránh hiểu nhầm là thiếu sót.>`

### Tiêu chí hoàn thành

- [ ] `<Tiêu chí chức năng>`
- [ ] `<Tiêu chí kiểm tra>`
- [ ] `<Tiêu chí bàn giao/tài liệu>`

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** `<Kiến trúc, service, luồng nghiệp vụ hoặc trạng thái trước khi bắt đầu.>`
- **Giả định đã dùng:** `<Giả định và lý do; đánh dấu điều cần xác nhận.>`
- **Ràng buộc:** `<Bảo mật, tương thích, thời gian, hạ tầng, quy ước nhóm.>`
- **Nguồn sự thật:** `<Liên kết Notion/ADR/schema/spec và phần nào của nguồn đó được áp dụng.>`

## 5. Nhật ký theo session / thời gian

### Session `<số>` - `<khung giờ hoặc mốc>`

| Thời điểm | Việc đã thực hiện    | Kết quả / bằng chứng                    | Trạng thái                      |
| --------- | -------------------- | --------------------------------------- | ------------------------------- |
| `<HH:mm>` | `<Hành động cụ thể>` | `<File, lệnh, endpoint hoặc nhận định>` | `Xong` / `Đang làm` / `Bị chặn` |
| `<HH:mm>` | `<Hành động cụ thể>` | `<Kết quả>`                             | `<Trạng thái>`                  |

### Diễn giải quan trọng

`<Ghi lại những bước có bối cảnh khó tóm tắt trong bảng: cách tái lập lỗi, thay đổi luồng, nguyên nhân, hoặc điều người sau cần biết.>`

## 6. Quyết định kỹ thuật

| Quyết định     | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| -------------- | ------------------ | --------------------- | ----------------------- |
| `<Quyết định>` | `<Tại sao chọn>`   | `<Các lựa chọn khác>` | `<Rủi ro/next step>`    |
| `<Quyết định>` | `<Tại sao chọn>`   | `<Các lựa chọn khác>` | `<Rủi ro/next step>`    |

Nếu quyết định ảnh hưởng lâu dài, tạo hoặc cập nhật ADR và liên kết tại đây.

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `<Service/module>: <thay đổi, hành vi trước/sau, giao diện hoặc contract bị ảnh hưởng.>`
- `<Service/module>: <thay đổi thứ hai.>`

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** `<tên DB/schema>`
- **Migration:** `<version/file; idempotency, rollback hoặc lưu ý triển khai>`
- **Dữ liệu seed/test:** `<số lượng, mục đích, cách nhận diện; không ghi dữ liệu nhạy cảm>`
- **Tính tương thích:** `<ảnh hưởng đến dữ liệu hiện có hoặc service khác>`

### 7.3. Cấu hình, hạ tầng và dependency

- `<Biến môi trường/cấu hình>`: `<ý nghĩa, default/an toàn, nơi set secret>`
- `<Docker/CI/service discovery/observability>`: `<thay đổi>`
- `<Dependency>`: `<phiên bản, mục đích, có/không có runtime integration>`

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** `<route, request/response, status code>`
- **Security:** `<public/protected route, authn/authz; nêu rõ skeleton nếu chưa hoàn chỉnh>`
- **Validation/error response:** `<convention và ví dụ lỗi>`
- **Health/metrics/logging:** `<endpoint và tình trạng>`

## 8. Danh sách file ảnh hưởng

| Loại                   | Đường dẫn         | Thay đổi chính | Lưu ý cho người tiếp nhận |
| ---------------------- | ----------------- | -------------- | ------------------------- |
| `Sửa` / `Thêm` / `Xóa` | `<relative/path>` | `<một câu>`    | `<rủi ro/cách dùng>`      |
| `Sửa` / `Thêm` / `Xóa` | `<relative/path>` | `<một câu>`    | `<rủi ro/cách dùng>`      |

Không liệt kê `.env`, secret hoặc file sinh tự động nếu chúng không cần review; thay vào đó mô tả tên cấu hình ở phần 7.3.

## 9. Kiểm tra và bằng chứng

| Hạng mục          | Lệnh / thao tác tái lập   | Kết quả thực tế         | Phạm vi và giới hạn      |
| ----------------- | ------------------------- | ----------------------- | ------------------------ |
| Compile/build     | `<command>`               | `PASS/FAIL`             | `<module, environment>`  |
| Test              | `<command>`               | `PASS/FAIL; số test`    | `<unit/integration/e2e>` |
| DB migration      | `<command/query an toàn>` | `PASS/FAIL`             | `<schema/version>`       |
| Endpoint          | `<curl/httpie/URL>`       | `<status/body an toàn>` | `<môi trường>`           |
| Static/diff check | `<command>`               | `PASS/FAIL`             | `<những gì đã kiểm>`     |

### Điều chưa được kiểm tra

- `<Luồng/chức năng chưa có bằng chứng; nêu lý do và mức độ rủi ro.>`

## 10. Sự cố, rủi ro và blocker

| Mức độ                        | Vấn đề     | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại  | Chủ sở hữu / bước tiếp theo |
| ----------------------------- | ---------- | ---------------------- | -------------------- | --------------------------- |
| `Cao` / `Trung bình` / `Thấp` | `<vấn đề>` | `<bằng chứng>`         | `<đã giảm thiểu gì>` | `<ai/làm gì/khi nào>`       |

### Lỗi có thể tái lập

```text
<Không chép secret. Ghi thông báo lỗi ngắn, điều kiện xảy ra và cách tái lập.>
```

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. `<Bước tiếp theo cụ thể; file hoặc command bắt đầu.>`
2. `<Bước tiếp theo cụ thể.>`

### Cần quyết định / quyền truy cập từ người khác

- `<Câu hỏi hoặc quyền cần có; ảnh hưởng nếu chưa có.>`

### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, tài liệu nguồn và `git status` trước khi sửa.
- Giữ nguyên các quyết định ở phần 6, trừ khi có yêu cầu mới và ghi lý do thay đổi.
- Trước khi kết luận hoàn thành, chạy lại các lệnh ở phần 9 phù hợp với thay đổi mới.
- Không hiển thị secret hoặc đưa giá trị `.env` vào chat, log, commit hay test fixture.
- Cập nhật log này (hoặc file ngày mới) ngay sau khi thay đổi trạng thái, quyết định hoặc bằng chứng kiểm tra.

## 12. Tham chiếu

- `<Tài liệu thiết kế / Notion>`
- `<Tài liệu cấu hình / API / migration>`
- `<Issue, PR, CI run hoặc dashboard>`

## 13. Kết thúc session

| Trường                     | Giá trị                                        |
| -------------------------- | ---------------------------------------------- |
| Thời điểm dừng             | `<YYYY-MM-DD HH:mm Asia/Saigon>`               |
| Trạng thái worktree        | `<sạch / có thay đổi chưa commit; mô tả ngắn>` |
| Commit/PR đã tạo           | `<SHA/URL hoặc Chưa tạo>`                      |
| Người cập nhật log         | `<tên hoặc AI agent>`                          |
| Cần đọc trước khi tiếp tục | `<mục/đường dẫn quan trọng>`                   |

---

## Checklist trước khi đóng log

- [ ] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [ ] Mọi quyết định ảnh hưởng thiết kế đều có lý do.
- [ ] File thay đổi và migration/dependency quan trọng đã được nêu.
- [ ] Có lệnh hoặc thao tác tái lập cho các kiểm tra đã tuyên bố.
- [ ] Rủi ro, blocker và next step có chủ sở hữu hoặc hành động rõ ràng.
- [ ] Không có secret, token, connection string nhạy cảm hoặc PII không cần thiết.
- [ ] Trạng thái commit/PR và worktree là chính xác tại thời điểm ghi.
