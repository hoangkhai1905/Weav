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
