# Nhật ký: Sẵn sàng build APK Android (apps/mobile)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-11-05` |
| Múi giờ ghi log | `Asia/Saigon` |
| Nhánh / commit đầu | `chore/mobile-apk-readiness` từ `dev` / `eaaf2a6f` |
| Người thực hiện | T + AI agent |
| Trạng thái | `Đang tiếp tục` (còn lỗi lint có sẵn, backup keystore) |
| Phạm vi | Rà soát trước khi build APK cài trực tiếp (không lên Google Play), sửa các mục "Nên sửa" |

## 2. Tóm tắt

- Rà soát: Expo SDK 57, RN 0.86, managed (CNG; `android/` bị gitignore), một profile `preview` ra APK release. Không có lỗi chặn build.
- Đã sửa: package lệch SDK, gỡ async-storage không dùng, vá axios/zod, cài ESLint, versionCode do EAS tự tăng.
- Chưa xong: 24 lỗi lint có sẵn (xem mục 10), backup keystore (người dùng tự làm).

## 5. Session 1 — 2026-11-05

| Việc | Kết quả | Trạng thái |
| --- | --- | --- |
| Rà soát config, quyền, signing, env, bundle | Báo cáo trong chat; package `com.truong0910.mobile`, API `https://`, keystore EAS remote, biến file `GOOGLE_SERVICES_JSON` có trong env `preview` | Xong |
| `npx expo install --fix` | 18 package lên đúng bản SDK 57 (`expo` 57.0.31, `react-native` 0.86.3, …) | Xong |
| Gỡ `@react-native-async-storage/async-storage` | Không có import nào trong `src/`; `pnpm why` chỉ ra mobile là người dùng duy nhất | Xong |
| `axios` ^1.21.0, `zod` ^4.6.7 | Hết advisory high ở 2 package này | Xong |
| Thêm `eslint` ^9 + `eslint-config-expo` ~57.0.2 (dev) | ESLint 10 làm `eslint-plugin-react` 7.37.5 crash (`getFilename is not a function`) nên ghim v9 | Xong |
| `eas.json`: `appVersionSource: remote`, `preview.autoIncrement: true` | Trước đó mọi build đều `versionCode 1`. EAS chưa có version remote; build đầu sẽ khởi tạo từ local (1) rồi tăng | Xong |

## 6. Quyết định

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| ESLint 9 thay vì 10 | Plugin react trong `eslint-config-expo` 57 chưa hỗ trợ ESLint 10 | Nâng lên 10 khi expo config hỗ trợ |
| versionCode remote + autoIncrement | Phân biệt được các bản APK, không lo hạ version | Version nằm trên EAS, không còn trong repo |
| Không sửa `eslint.config.js` | Hook `config-protection` (ecc) chặn | Cần người dùng quyết định (mục 11) |

## 8. File ảnh hưởng

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `apps/mobile/package.json` | Căn chỉnh SDK, gỡ async-storage, axios/zod, thêm eslint |
| Sửa | `pnpm-lock.yaml` | Chỉ importer `apps/mobile` đổi |
| Sửa | `apps/mobile/eas.json` | Version remote + autoIncrement |

## 9. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Doctor | `npx expo-doctor@latest` | 21/21 pass (trước: 20/21) |
| Phiên bản | `npx expo install --check` | Up to date |
| Types | `npx tsc --noEmit -p .` | Pass |
| Test | `node --test $(find src e2e -name "*.test.cjs")` | 256/256 pass |
| Bundle | `npx expo export --platform android` | Pass, Hermes 6.3MB |
| Lint | `npx eslint . --ignore-pattern ".expo/**"` | 24 lỗi, 25 cảnh báo (có từ trước) |
| Audit | `pnpm --dir apps/mobile audit --prod` | axios/zod sạch; `follow-redirects` 1.16.0 còn (chỉ adapter Node của axios, RN không dùng) |

### Chưa kiểm tra

- Chưa build APK mới và cài lên máy với các bản package mới.

## 10. Rủi ro

| Mức | Vấn đề | Bước tiếp |
| --- | --- | --- |
| Trung bình | 15 lỗi React Compiler (`set-state-in-effect`, `refs`, `purity`) trong 10 file; compiler bỏ qua tối ưu các component đó | Sửa từng file, có test |
| Thấp | 9 lỗi `no-undef __dirname` trong file `.cjs`; `.expo/export-check*` (build cũ) bị lint quét | Thêm globals Node cho `**/*.cjs` và ignore `.expo/*` trong `eslint.config.js` |
| Thấp | Keystore chỉ nằm trên EAS | `eas credentials` → Android → preview → tải keystore, cất ngoài repo |

## 11. Bàn giao

- Build: `eas build -p android --profile preview` (cài đè: `adb install -r <file>.apk`).
- Không build release bằng `expo run:android`: `android/app/debug.keystore` ký khác bản EAS.
- Cần quyết định: cho phép sửa `eslint.config.js` (tắt tạm hook `config-protection`) hay không.
