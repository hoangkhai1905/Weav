# WEAV — Development Setup Guide

Tài liệu này hướng dẫn thành viên trong nhóm thiết lập môi trường development cho WEAV sau khi clone repository.

> **Lưu ý:** Repository đã được bootstrap sẵn. **Không tạo lại** project bằng Spring Initializr, Nest CLI, Vite hoặc Expo CLI.

---

## 1. Yêu cầu môi trường

| Tool           | Version       |
| -------------- | ------------- |
| Java           | 25            |
| Node.js        | 24            |
| pnpm           | 11.22.0       |
| Python         | 3.12          |
| uv             | 0.11.x        |
| Docker         | 29.x          |
| Docker Compose | v5.x          |
| Git            | Latest stable |
| VS Code        | Recommended   |

Repository đã pin runtime bằng:

```text
.java-version
.node-version
.python-version
```

Kiểm tra:

```powershell
java --version
node --version
pnpm --version
uv --version
docker --version
docker compose version
```

---

## 2. Clone repository

Sau khi đã cài Git, Java 25, Node 24, pnpm, uv và Docker:

```powershell
git clone <REPOSITORY_URL>
cd Weav

.\scripts\dev\setup.ps1

powershell -ExecutionPolicy Bypass -File .\scripts\dev\setup.ps1
```

Không chạy lại:

```text
spring initializr
nest new
create-vite
create-expo-app
```

Các project đã có sẵn trong repository.

---

## 3. Kiểm tra Java

WEAV sử dụng Java 25.

```powershell
java --version
```

Kiểm tra Maven Wrapper:

```powershell
cd services/identity-service
.\mvnw.cmd -v
```

Dòng `Java version` cũng phải là Java 25.

Nếu `java --version` là 25 nhưng Maven dùng Java cũ:

```powershell
$env:JAVA_HOME
```

`JAVA_HOME` phải trỏ tới JDK 25. Sau khi sửa Environment Variables, đóng toàn bộ VS Code rồi mở lại.

Quay về root:

```powershell
cd ..\..
```

---

## 4. Cài Node dependencies

Repository dùng pnpm workspace:

```powershell
pnpm install
```

Không dùng `npm install` hoặc `yarn install`.

Kiểm tra package build script:

```powershell
pnpm ignored-builds
```

Workspace đã cấu hình `allowBuilds` trong `pnpm-workspace.yaml`.

---

## 5. Setup Python / OCR Service

Không cần đổi Python global nếu máy đang dùng version khác.

Nếu chưa có Python 3.12 qua uv:

```powershell
uv python install 3.12
```

Sync OCR environment:

```powershell
cd services/ocr-service
uv sync
```

Kiểm tra:

```powershell
uv run python --version
```

Phải ra Python `3.12.x`.

Kiểm tra dependency:

```powershell
uv run python -c "import fastapi, paddle, paddleocr, cv2; print('OCR environment OK')"
```

Quay về root:

```powershell
cd ..\..
```

> `.venv` có thể bị ẩn trong VS Code Explorer bởi workspace settings.

---

## 6. Environment variables

Copy file mẫu:

```powershell
Copy-Item .env.example .env
```

Điền credentials development vào `.env`.

### Neon PostgreSQL

```env
# Use the pooled endpoint from Neon; the hostname contains "-pooler".
IDENTITY_DB_HOST=
IDENTITY_DB_PORT=5432
IDENTITY_DB_NAME=
IDENTITY_DB_USERNAME=
IDENTITY_DB_PASSWORD=
IDENTITY_DB_SSL_MODE=require

WORKSPACE_DB_HOST=
WORKSPACE_DB_PORT=5432
WORKSPACE_DB_NAME=
WORKSPACE_DB_USERNAME=
WORKSPACE_DB_PASSWORD=
WORKSPACE_DB_SSL_MODE=require

WORKFLOW_DB_HOST=
WORKFLOW_DB_PORT=5432
WORKFLOW_DB_NAME=
WORKFLOW_DB_USERNAME=
WORKFLOW_DB_PASSWORD=
WORKFLOW_DB_SSL_MODE=require

BOT_DB_HOST=
BOT_DB_PORT=5432
BOT_DB_NAME=
BOT_DB_USERNAME=
BOT_DB_PASSWORD=
BOT_DB_SSL_MODE=require

NOTIFICATION_DB_HOST=
NOTIFICATION_DB_PORT=5432
NOTIFICATION_DB_NAME=
NOTIFICATION_DB_USERNAME=
NOTIFICATION_DB_PASSWORD=
NOTIFICATION_DB_SSL_MODE=require
```

### Aiven Valkey

```env
VALKEY_URL=
VALKEY_HOST=
VALKEY_PORT=
VALKEY_USERNAME=
VALKEY_PASSWORD=
```

### Workspace service-to-service and authorization

Workspace uses the following non-secret names. Keep the two internal service
keys in the local secret store and configure the Identity key to match on both
the Identity and Workspace containers. When using Compose, `REDIS_URL` may be
left unset if it should inherit the root `VALKEY_URL`.

```env
IDENTITY_SERVICE_URL=http://identity-service:8080
IDENTITY_INTERNAL_SERVICE_KEY=
WEAV_INTERNAL_SERVICE_KEY=
IDENTITY_CONNECT_TIMEOUT=3s
IDENTITY_READ_TIMEOUT=5s
REDIS_URL=
WORKSPACE_AUTHORIZATION_CACHE_TTL=PT5M
JWT_ISSUER=weav-identity
JWT_AUDIENCE=weav-api
JWT_CLOCK_SKEW=30s
```

### RabbitMQ

```env
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_MANAGEMENT_PORT=15672
```

### AI Provider

Có thể để trống nếu chưa làm AI:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

> Không commit `.env`.

---

## 7. Docker

WEAV sử dụng:

```text
compose.yml
compose.dev.yml
```

Start infrastructure:

```powershell
docker compose up -d
```

Kiểm tra:

```powershell
docker compose ps
```

RabbitMQ Management UI:

```text
http://localhost:15672
```

Development credentials mặc định:

```text
username: guest
password: guest
```

Validate Compose:

```powershell
docker compose -f compose.yml -f compose.dev.yml config
```

Stop:

```powershell
docker compose down
```

---

## 8. Kiểm tra Java services

Identity:

```powershell
cd services/identity-service
.\mvnw.cmd clean compile
```

Identity core authentication requires `JWT_ACCESS_SECRET` to contain at least 32 UTF-8 bytes. `JWT_REFRESH_SECRET` remains required for configuration compatibility but opaque refresh tokens are generated randomly and only their SHA-256 hashes are stored.

### Optional Google OAuth web transport

The Identity service reads these names from its process environment; no Spring or Maven startup path loads the repository-root `.env` automatically:

```text
GOOGLE_OAUTH_ENABLED        # blank = auto; false = force disabled; true = require complete config
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET        # secret value supplied out-of-band
GOOGLE_REDIRECT_URI         # default: http://localhost:8081/auth/oauth/google/callback
OAUTH_WEB_RETURN_TARGET_URI # default: http://localhost:5173/auth/callback
OAUTH_WEB_ALLOWED_ORIGIN    # default: http://localhost:5173
```

The Google issuer is fixed to `https://accounts.google.com`; web cookies remain `Secure` and the allowed origin is an exact match. With both credential values empty, OAuth providers and routes stay disabled and core Identity still boots. Setting `GOOGLE_OAUTH_ENABLED=true` with a missing or malformed required value fails startup rather than silently enabling a partial flow.

For Compose, load the local environment at the project root so interpolation forwards these values into `identity-service`, then validate without printing resolved values:

```powershell
docker compose --env-file .env -f compose.yml -f compose.dev.yml config --quiet
docker compose --env-file .env -f compose.yml -f compose.dev.yml --profile app up identity-service
```

### Google Colab OCR development mode

When OCR is running in a Google Colab notebook and exposed through a temporary
HTTPS tunnel, point the Gateway at that URL in the local `.env`:

```env
OCR_SERVICE_URL=https://your-colab-tunnel.example
OCR_ALLOW_UNAUTHENTICATED_DEV=true
```

Commit the generic Compose override from
`compose.colab-ocr.dev.yml`, but never commit the real tunnel URL or an
authentication token. Start only the services needed by the local Gateway so
the local `ocr-service` container is not started:

```powershell
docker compose --env-file .env `
  -f compose.yml `
  -f compose.dev.yml `
  -f compose.colab-ocr.dev.yml `
  --profile app up -d --build identity-service workspace-service api-gateway
```

The local OCR container remains available for fallback testing. Run it by
using the normal Compose files and the local model override; omit the Colab
override so Gateway uses the internal `http://ocr-service:8000` URL:

```powershell
docker compose --env-file .env `
  -f compose.yml `
  -f compose.dev.yml `
  -f compose.ocr-models.dev.yml `
  --profile app up -d --build ocr-service api-gateway
```

The Colab tunnel is temporary and should only receive non-sensitive test
documents. If the notebook restarts, update the local `.env` URL and recreate
the Gateway container.

For direct Maven startup, inject the same names into the process environment through the local shell or secret manager before starting `services/identity-service`; do not pass secret values on the command line or commit `.env`.

The Identity-local OpenAPI contract is published at `packages/contracts/http/auth/openapi.yaml`. Version 1.1 adds the M1 contract target for profile display-name updates, self-service session listing/revocation, revoke-all, and local password change. These additions are contract-first: do not treat them as runtime-ready until the matching M1 implementation and HTTP tests pass. OTP/recovery, admin, avatar, Gateway, and mobile operations remain deferred; the M3 Google OAuth web transport still requires real-provider/browser acceptance.

To run the complete Identity suite with disposable PostgreSQL 18:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' test
```

The current baseline suite applies Flyway migrations to schema `identity` and verifies registration, login, bearer current-user lookup, refresh rotation, logout, duplicate-email/refresh races, and auth throttling. It does not use development Neon credentials. After M1 implementation lands, its focused profile/session/password-change HTTP and concurrency tests must pass together with this baseline suite before the new operations are considered available.

Workflow:

```powershell
cd ..\workflow-service
.\mvnw.cmd clean compile
```

Cả hai phải kết thúc bằng:

```text
BUILD SUCCESS
```

Quay root:

```powershell
cd ..\..
```

---

## 9. Kiểm tra Web và NestJS services

```powershell
pnpm --dir apps/web build
pnpm --dir services/ai-service build
pnpm --dir services/api-gateway build
pnpm --dir services/bot-service build
pnpm --dir services/notification-service build
```

### API Gateway development setup

Gateway chạy bằng NestJS/Fastify và nhận cấu hình từ process environment,
Compose hoặc secret store được phê duyệt. Chỉ ghi tên biến, không ghi secret
value vào file này hoặc vào shell history:

```text
APP_ENV, PORT
JWT_ACCESS_SECRET, JWT_ISSUER, JWT_AUDIENCE, JWT_CLOCK_SKEW
IDENTITY_SERVICE_URL, WORKSPACE_SERVICE_URL, WORKFLOW_SERVICE_URL
AI_SERVICE_URL, BOT_SERVICE_URL, NOTIFICATION_SERVICE_URL, OCR_SERVICE_URL
CORS_ALLOWED_ORIGINS, OCR_ALLOW_UNAUTHENTICATED_DEV
GATEWAY_GENERAL_RATE_LIMIT, GATEWAY_AUTH_RATE_LIMIT, GATEWAY_OCR_RATE_LIMIT
GATEWAY_RATE_LIMIT_WINDOW_MS
```

Từ repository root, sau khi đã cung cấp các tên cấu hình cần thiết:

```powershell
pnpm --dir services/api-gateway start:dev
```

Kiểm tra source-level Gateway mà không cần upstream thật:

```powershell
pnpm --dir services/api-gateway test -- --runInBand --silent
pnpm --dir services/api-gateway test:e2e -- --runInBand --silent
pnpm --dir services/api-gateway exec tsc --noEmit
pnpm --dir services/api-gateway build
pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"
```

`GET /health` là liveness public và không gọi Identity/Workspace. `GET /ready`
là readiness public, probe song song hai service này qua
`/actuator/health/readiness`, đọc cả response body trong deadline hai giây và
trả aggregate `200`/`503` đã được sanitize. Notification và OCR không làm
Gateway unready. Rate limiter dùng in-memory storage cho một Gateway replica;
không coi đây là enforcement phân tán khi scale nhiều replica.

Route matrix, mapping Workspace, auth policy, error contract, OCR streaming
risk và rollback được ghi tại `services/api-gateway/README.md`. Contract
Workspace phía Gateway nằm ở `packages/contracts/http/gateway/openapi.yaml`.

Fixture E2E không thay thế real-service proof. Để kiểm tra login Identity →
Workspace qua Gateway hoặc browser smoke, phải có deployment được ủy quyền,
test account chuyên dụng và dữ liệu test có cleanup rõ ràng; không tự tạo dữ
liệu production hoặc đọc/paste credential.

---

## 10. Mobile

Mobile app đã được scaffold bằng Expo.

Kiểm tra workspace:

```powershell
pnpm --filter ./apps/mobile list --depth 0
```

Không cần chạy emulator trong bước setup ban đầu.

---

## 11. VS Code

Repository có sẵn:

```text
.vscode/
├── extensions.json
└── settings.json
```

Extension chính:

```text
Extension Pack for Java
Spring Boot Extension Pack
ESLint
Prettier
Python
Ruff
Container Tools
YAML
```

Không bắt buộc dùng IntelliJ.

---

## 12. Dockerfile.dev

Các service đã có `Dockerfile.dev`, không cần tự tạo lại:

```text
services/identity-service/Dockerfile.dev
services/workflow-service/Dockerfile.dev

services/ai-service/Dockerfile.dev
services/api-gateway/Dockerfile.dev
services/bot-service/Dockerfile.dev
services/notification-service/Dockerfile.dev

services/ocr-service/Dockerfile.dev
```

---

## 13. Quick Setup Checklist

Sau khi clone, thành viên mới chủ yếu cần:

```powershell
# 1. Clone
git clone <REPOSITORY_URL>
cd Weav

# 2. Install JS/TS dependencies
pnpm install

# 3. Setup Python
cd services/ocr-service
uv sync
cd ..\..

# 4. Environment variables
Copy-Item .env.example .env

# Điền Neon / Aiven credentials vào .env

# 5. Start infrastructure
docker compose up -d

# 6. Verify
docker compose ps
```

---

## 14. Không cần làm lại

Sau khi clone repository, thành viên **không cần**:

```text
❌ Tạo lại Spring project bằng Spring Initializr
❌ Chạy nest new
❌ Chạy create-vite
❌ Chạy create-expo-app
❌ Tạo lại Dockerfile.dev
❌ Tạo lại compose.yml
❌ Cài Maven global
❌ Tự chọn lại version dependency
❌ Tự tạo pnpm workspace
❌ Tự setup PaddleOCR dependency từ đầu
```

---

## 15. Troubleshooting

### Maven báo `release version 25 not supported`

```powershell
java --version

cd services/identity-service
.\mvnw.cmd -v
```

Nếu Maven dùng Java cũ, sửa `JAVA_HOME` sang JDK 25 và restart VS Code.

### pnpm không nhận package

Kiểm tra:

```powershell
Get-Content pnpm-workspace.yaml
```

Phải có:

```yaml
packages:
  - "apps/*"
  - "services/*"
  - "packages/*"
```

### Không thấy `.venv`

```powershell
cd services/ocr-service
Test-Path .venv
```

Nếu `True`, `.venv` chỉ đang bị VS Code ẩn.

### RabbitMQ có deprecated warning

Nếu container vẫn `running`/`healthy` và Management UI truy cập được thì warning development có thể bỏ qua.

---

## 16. Current Development Stack

```text
Frontend Web        → React + TypeScript + Vite
Mobile              → React Native + Expo

Identity            → Java 25 + Spring Boot
Workspace           → Java 25 + Spring Boot
Workflow / Worker   → Java 25 + Spring Boot

AI                  → TypeScript + NestJS + Fastify
API Gateway         → TypeScript + NestJS + Fastify
Bot                 → TypeScript + NestJS + Fastify
Notification        → TypeScript + NestJS + Fastify

OCR                 → Python 3.12 + FastAPI + PaddleOCR

Database             → Neon PostgreSQL
Storage              → Not configured
Cache               → Aiven Valkey
Message Broker      → RabbitMQ
Development Runtime → Docker / Docker Compose
```
