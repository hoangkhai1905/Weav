# Workspace Connection & Credential V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện Connection + Credential cho Workspace Service V1, gồm CRUD, authorization, encrypted credential storage, provider verification, Google OAuth2, runtime credential resolution và Workflow usage protection.

**Architecture:** Giữ kiến trúc hiện tại của Workspace Service. Application use cases orchestration business flow; domain giữ lifecycle/rules; provider-specific logic nằm sau các outbound ports nhỏ; infrastructure triển khai PostgreSQL/Redis/Google/Telegram/HTTP. Không xây generic plugin framework.

## Architecture & Design Pattern Constraints

This implementation MUST preserve the existing Workspace Service architecture.
Do not redesign unrelated parts of the service.

**Repository convention rule:** Follow existing repository conventions over this plan's illustrative class names when they differ. Do not perform unrelated refactors. If an equivalent abstraction/pattern already exists in the codebase, extend or reuse it instead of creating a parallel implementation.

### Architectural Style

Use the existing **Hexagonal / Ports-and-Adapters** structure:

```text
Controller
  -> Application Use Case
  -> Domain / Policy
  -> Outbound Port
  -> Infrastructure Adapter
  -> External System
```

Dependency direction MUST remain inward:

```text
presentation -> application -> domain
```

Infrastructure implements ports defined by application/domain.

Domain and application code MUST NOT depend directly on:

- Spring Data JPA repositories
- Redis APIs
- `RestClient` / `WebClient`
- Google SDK/API implementation details
- Telegram API implementation details
- Workflow Service HTTP implementation

### Required Patterns

#### 1. Use Case Pattern

Keep business flows as focused use cases, for example:

- `CreateConnectionUseCase`
- `UpdateConnectionUseCase`
- `SaveCredentialUseCase`
- `DeleteCredentialUseCase`
- `TestConnectionUseCase`
- `ResolveConnectionUseCase`
- `StartConnectionOAuthUseCase`
- `CompleteConnectionOAuthUseCase`
- `AuthorizeConnectionAttachmentUseCase`
- `ReportConnectionAuthFailureUseCase`

Do NOT replace these with one large `ConnectionService`.

Each use case should orchestrate one business flow and delegate reusable rules to domain/policy components.

#### 2. Repository Pattern

Domain/application accesses Connection and Credential persistence only through:

- `ConnectionRepository`
- `CredentialRepository`

Infrastructure provides JPA/Spring Data adapters.

Spring Data repository types and JPA entities MUST NOT leak into domain/application code.

#### 3. Strategy Pattern

Provider-specific behavior MUST be isolated behind `ConnectionProviderPort`.

Implementations:

- `TelegramConnectionProvider`
- `HttpConnectionProvider`
- `GoogleConnectionProvider`

Do NOT scatter `switch(provider)` or `if (provider == ...)` branches across use cases.

Provider-specific differences belong inside provider strategies.

#### 4. Registry Pattern

`ConnectionProviderRegistry` resolves the correct provider strategy.

The registry is intentionally small and static for V1.

Do NOT turn it into:

- a dynamic plugin framework
- runtime classpath discovery
- provider manifest system
- database-driven provider registry

#### 5. Policy Pattern

Reusable business rules belong in focused policy classes:

- `ConnectionAuthorizationPolicy`
- `ConnectionProviderPolicy`
- `GoogleOAuthScopePolicy`

Do NOT duplicate authorization, provider/auth compatibility, or OAuth scope rules across controllers and use cases.

#### 6. Adapter Pattern

External dependencies must be represented as infrastructure adapters behind explicit ports.

Examples:

- `WorkflowConnectionUsageClient`
- `RedisOAuthStateStore`
- `GoogleOAuthProvider`
- `TelegramConnectionProvider`
- `HttpConnectionProvider`
- `AesGcmCredentialCrypto`

Application/domain code should only know the corresponding interfaces/contracts.

#### 7. Mapper Pattern

Persistence entities MUST NOT leak into domain/application code.

Use dedicated persistence mapping for:

- `Connection <-> ConnectionJpaEntity`
- `Credential <-> CredentialJpaEntity` when mapping logic is required

Mapping responsibilities must remain separate from business-rule enforcement.

### Patterns Explicitly NOT Required

Do NOT introduce these unless this plan/spec is explicitly revised:

- generic plugin framework
- Abstract Factory hierarchy
- CQRS framework
- Event Sourcing
- Saga orchestration
- generic RBAC engine
- provider inheritance hierarchy
- shared OAuth-grant subsystem
- distributed lock for Google token refresh
- additional microservices
- domain events solely to connect components that already communicate synchronously in-process

### Abstraction Rule

If a new abstraction has only one implementation and does not protect a meaningful architectural boundary or expected V1 variation, do not create it merely for pattern purity.

Single implementations are still justified when they protect an important boundary, for example:

- `CredentialCryptoPort` isolates cryptography from application logic.
- `WorkflowConnectionUsagePort` isolates a cross-service contract.
- `OAuthStateStore` isolates Redis/state persistence.
- `GoogleOAuthPort` isolates external OAuth behavior.

### AI-Agent Implementation Guardrails

Before creating a new class or interface, the implementing agent MUST check whether an equivalent abstraction already exists in the repository.

The agent MUST NOT:

- collapse the use-case structure into a god service
- move business authorization into controllers
- access another service's database
- bypass ports by calling external clients directly from use cases
- create abstractions unrelated to a requirement in this plan
- refactor Workspace Core code unless required for Connection/Credential V1
- replace existing repository architecture with a new architectural style

When the plan's example name differs from an established repository naming convention, preserve the architectural responsibility but use the repository convention.

**Patterns are used to preserve boundaries and reduce provider-specific coupling, not as goals by themselves.**

**Tech Stack:** Java 25, Spring Boot 4.1, Spring WebMVC `RestClient`, Spring Data JPA, PostgreSQL, Flyway, Redis, Spring Security, AES-256-GCM, JUnit 5, Testcontainers.

**Spec:** Validated design from this conversation. Intended repository spec path: `docs/superpowers/specs/2026-09-14-workspace-connection-credential-design.md`.

## Global Constraints

- Connection belongs to Workspace; `createdBy` is audit/management metadata, not ownership that disappears when MEMBER leaves.
- OWNER manages every Connection in Workspace.
- MEMBER can create Connection and manage their own Connection only while it is not referenced by a workflow.
- MEMBER can see metadata of every Connection but full `config` only for Connections they created.
- MEMBER may attach only Connections they created; OWNER may attach any Connection.
- Existing authorized workflow execution may use another member's Connection.
- Workflow definition stores `connectionId`; never `credentialId` or secret.
- `provider` and `authType` are immutable.
- Valid combinations:
  - `GMAIL -> OAUTH2`
  - `GOOGLE_SHEETS -> OAUTH2`
  - `TELEGRAM -> TOKEN`
  - `HTTP -> NONE | API_KEY | TOKEN | BASIC`
- New Connection starts `DISABLED`.
- Successful verification -> `ACTIVE`.
- Confirmed auth rejection -> `INVALID`.
- Replacing/removing credential -> `DISABLED`.
- Manual disable is allowed; there is no direct `DISABLED -> ACTIVE` toggle. Re-enable requires Test/OAuth verification.
- Hard delete Connection only when Workflow reports `inUse=false`.
- Required Workflow usage check failure -> `503`; never fail open.
- Connection names are unique per Workspace after normalization.
- `config` contains no secret.
- Credential payload uses AES-256-GCM.
- Plaintext credentials are never logged, cached, returned publicly, persisted in workflow/execution state, or put into OAuth state.
- Google refresh token never leaves Workspace Service.
- Google OAuth grant remains one Credential per Connection in V1.
- OAuth callback uses one-time Redis state with short TTL and does not require JWT.
- Callback re-checks current Workspace membership and Connection management permission.
- HTTP provider test must enforce SSRF protections.
- Provider/network `5xx`, `429`, timeout, DNS/network failures are transient dependency failures; they do not automatically mark Connection `INVALID`.
- Workspace/archive/delete, invitation, ownership transfer and generic/custom RBAC remain out of scope.

---

## Target File Structure

Existing files to extend:

```text
services/workspace-service/
├── src/main/java/com/weav/workspace/
│   ├── domain/
│   │   ├── model/
│   │   │   ├── Connection.java
│   │   │   └── Credential.java
│   │   ├── port/out/
│   │   │   ├── ConnectionRepository.java
│   │   │   └── CredentialRepository.java
│   │   └── valueobject/
│   │       ├── ConnectionProvider.java
│   │       ├── ConnectionAuthType.java
│   │       └── ConnectionStatus.java
│   ├── application/
│   │   ├── dto/
│   │   ├── port/out/
│   │   ├── service/
│   │   └── usecase/
│   ├── infrastructure/
│   │   ├── cache/
│   │   ├── config/
│   │   ├── persistence/
│   │   ├── security/
│   │   └── web/
│   └── presentation/http/
├── src/main/resources/
│   ├── application.properties
│   └── db/migration/
└── src/test/java/com/weav/workspace/
```

New focused packages:

```text
application/port/out/
├── ConnectionProviderPort.java
├── CredentialCryptoPort.java
├── GoogleOAuthPort.java
├── OAuthStateStore.java
└── WorkflowConnectionUsagePort.java

application/service/
├── ConnectionAuthorizationPolicy.java
├── ConnectionProviderPolicy.java
├── ConnectionViewAssembler.java
├── CredentialPayloadCodec.java
├── GoogleOAuthScopePolicy.java
└── ConnectionProviderRegistry.java

infrastructure/
├── credential/
│   └── AesGcmCredentialCrypto.java
├── provider/
│   ├── google/
│   ├── telegram/
│   └── http/
├── workflow/
│   └── WorkflowConnectionUsageClient.java
└── cache/
    └── RedisOAuthStateStore.java
```

---

### Task 1: Domain lifecycle and authorization rules

**Files:**
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/Connection.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionProviderPolicy.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionAuthorizationPolicy.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionDomainTest.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionAuthorizationPolicyTest.java`

**Interfaces:**

```java
public final class ConnectionProviderPolicy {
    public void validate(ConnectionProvider provider, ConnectionAuthType authType);
    public boolean requiresCredential(ConnectionAuthType authType);
}

public final class ConnectionAuthorizationPolicy {
    public boolean canViewConfig(Membership membership, Connection connection);
    public boolean canAttach(Membership membership, Connection connection);
    public boolean canManageIgnoringUsage(Membership membership, Connection connection);
}
```

`Connection` exposes:

```java
public static String normalizeName(String name);

public void rename(String name);
public void updateConfig(Map<String, Object> config);

public void markDisabled();
public void markInvalid();
public void markVerified(Instant verifiedAt);
```

`createNew(...)` must initialize `ConnectionStatus.DISABLED`.

- [ ] **Step 1: Write lifecycle tests**

```java
@Test
void newConnectionStartsDisabled() {
    Connection connection = Connection.createNew(
            WORKSPACE_ID,
            USER_ID,
            "Telegram",
            ConnectionProvider.TELEGRAM,
            ConnectionAuthType.TOKEN,
            Map.of());

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
}

@Test
void verifiedConnectionBecomesActive() {
    Connection connection = newConnection();

    Instant verifiedAt = Instant.parse("2026-09-14T08:00:00Z");
    connection.markVerified(verifiedAt);

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.ACTIVE);
    assertThat(connection.getLastVerifiedAt()).isEqualTo(verifiedAt);
}

@Test
void credentialReplacementCanDisableActiveConnection() {
    Connection connection = activeConnection();

    connection.markDisabled();

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
}
```

- [ ] **Step 2: Write provider/auth whitelist tests**

Verify every allowed and rejected combination explicitly.

```java
assertDoesNotThrow(() ->
    policy.validate(ConnectionProvider.HTTP, ConnectionAuthType.BASIC));

assertThrows(BadRequestException.class, () ->
    policy.validate(ConnectionProvider.GMAIL, ConnectionAuthType.TOKEN));
```

- [ ] **Step 3: Write authorization matrix tests**

Cover:

```text
OWNER + any Connection            -> manage=true, attach=true, viewConfig=true
MEMBER + own Connection           -> manage=true, attach=true, viewConfig=true
MEMBER + another Connection       -> manage=false, attach=false, viewConfig=false
```

Usage-dependent authorization is intentionally not implemented here.

- [ ] **Step 4: Implement minimal domain/policy code**

Do not introduce role interfaces or generic RBAC.

Normalization:

```java
public static String normalizeName(String name) {
    if (name == null || name.isBlank()) {
        throw new IllegalArgumentException("Connection name must not be blank");
    }

    return name.trim()
            .replaceAll("\\s+", " ")
            .toLowerCase(Locale.ROOT);
}
```

- [ ] **Step 5: Run tests**

```bash
cd services/workspace-service
./mvnw -Dtest=ConnectionDomainTest,ConnectionAuthorizationPolicyTest test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/workspace-service/src/main/java \
        services/workspace-service/src/test/java
git commit -m "feat(workspace): define connection lifecycle and access rules"
```

---

### Task 2: Persistence, normalized names, and repository adapters

**Files:**
- Create: `services/workspace-service/src/main/resources/db/migration/V3__connection_constraints.sql`
- Modify: `.../infrastructure/persistence/entity/ConnectionJpaEntity.java`
- Create: `.../infrastructure/persistence/mapper/ConnectionPersistenceMapper.java`
- Create: `.../infrastructure/persistence/repository/SpringDataConnectionRepository.java`
- Create: `.../infrastructure/persistence/repository/SpringDataCredentialRepository.java`
- Create: `.../infrastructure/persistence/repository/ConnectionRepositoryAdapter.java`
- Create: `.../infrastructure/persistence/repository/CredentialRepositoryAdapter.java`
- Modify: `.../domain/port/out/ConnectionRepository.java`
- Modify: `.../domain/port/out/CredentialRepository.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java`

**Repository interfaces:**

```java
public interface ConnectionRepository {
    Connection save(Connection connection);

    Optional<Connection> findById(UUID id);

    Optional<Connection> findByWorkspaceIdAndId(
            UUID workspaceId,
            UUID connectionId);

    List<Connection> findAllByWorkspaceId(UUID workspaceId);

    boolean existsByWorkspaceIdAndNameNormalized(
            UUID workspaceId,
            String normalizedName,
            UUID excludingConnectionId);

    void delete(Connection connection);
}

public interface CredentialRepository {
    Credential save(Credential credential);

    Optional<Credential> findByConnectionId(UUID connectionId);

    void deleteByConnectionId(UUID connectionId);
}
```

- [ ] **Step 1: Add failing persistence tests**

Cover:

```text
same normalized Connection name in same Workspace -> conflict
same normalized name in different Workspace       -> allowed
Credential connection_id                          -> unique
delete Connection                                 -> Credential cascade deleted
config JSON                                       -> round trips unchanged
```

- [ ] **Step 2: Add Flyway V3**

Use additive migration; do not rewrite V1/V2.

```sql
ALTER TABLE connections
    ADD COLUMN name_normalized VARCHAR(255);

UPDATE connections
SET name_normalized =
    lower(
        regexp_replace(
            trim(name),
            '\s+',
            ' ',
            'g'
        )
    );

ALTER TABLE connections
    ALTER COLUMN name_normalized SET NOT NULL;

CREATE UNIQUE INDEX uk_connections_workspace_name_normalized
    ON connections (workspace_id, name_normalized);
```

- [ ] **Step 3: Persist `nameNormalized` explicitly**

`ConnectionJpaEntity` gets:

```java
@Column(name = "name_normalized", nullable = false, length = 255)
private String nameNormalized;
```

Mapper must derive it from `Connection.normalizeName(connection.getName())`; persistence is not allowed to invent a different normalization rule.

- [ ] **Step 4: Implement Spring Data repositories/adapters**

Use existing Workspace repository adapter conventions.

Do not create a generic base repository.

- [ ] **Step 5: Run persistence tests**

```bash
./mvnw -Dtest=ConnectionPersistenceTest test
```

Expected: PASS with PostgreSQL Testcontainer.

- [ ] **Step 6: Commit**

```bash
git add services/workspace-service/src/main/resources/db/migration \
        services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence \
        services/workspace-service/src/main/java/com/weav/workspace/domain/port/out \
        services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java

git commit -m "feat(workspace): persist connections and credentials"
```

---

### Task 3: Connection CRUD application use cases

**Files:**
- Create: `.../application/dto/ConnectionResponse.java`
- Create: `.../application/dto/CreateConnectionCommand.java`
- Create: `.../application/dto/UpdateConnectionCommand.java`
- Create: `.../application/service/ConnectionViewAssembler.java`
- Create:
  - `CreateConnectionUseCase.java`
  - `GetConnectionUseCase.java`
  - `ListConnectionsUseCase.java`
  - `UpdateConnectionUseCase.java`
  - `DisableConnectionUseCase.java`
- Create: `.../application/usecase/ConnectionUseCasesTest.java`

Do not implement delete yet; it requires Workflow usage integration.

**Response model:**

```java
public record ConnectionResponse(
        UUID id,
        UUID workspaceId,
        UUID createdBy,
        String name,
        ConnectionProvider provider,
        ConnectionAuthType authType,
        ConnectionStatus status,
        Map<String, Object> config,
        boolean hasCredential,
        Instant credentialExpiresAt,
        Instant lastVerifiedAt,
        boolean canManage,
        boolean canAttach,
        Instant createdAt,
        Instant updatedAt) {
}
```

Rules:

```text
OWNER:
config     = visible
canManage  = true
canAttach  = true

creator MEMBER:
config     = visible
canManage  = true at local ownership level
canAttach  = true

other MEMBER:
config     = null
canManage  = false
canAttach  = false
```

`canManage` is only local ownership-level permission. Actual mutation still performs authoritative Workflow usage check later.

- [ ] **Step 1: Write create/get/list/update/disable tests**

Include:

```text
non-member -> workspace-style not found/forbidden behavior matching existing service convention
duplicate normalized name -> ConflictException
provider/auth invalid -> BadRequestException
provider/auth immutable through update
OWNER may update any Connection
MEMBER may update own Connection before usage protection is added
MEMBER cannot update another Connection
manual disable ACTIVE -> DISABLED
disable already DISABLED -> idempotent
```

- [ ] **Step 2: Implement CreateConnectionUseCase**

Flow:

```text
verify membership
→ validate provider/auth
→ normalize name / duplicate check
→ create Connection(DISABLED)
→ save
→ assemble response
```

- [ ] **Step 3: Implement Get/List**

Do not call Workflow Service from list/get.

Load Credential metadata only to calculate:

```text
hasCredential
credentialExpiresAt
```

Never expose:

```text
encryptedPayload
encryptionKeyVersion
credential id
plaintext auth fields
```

- [ ] **Step 4: Implement Update/Disable**

`PATCH` updates only:

```text
name
config
```

`provider` and `authType` are not update-command fields.

Any non-secret config change that can affect runtime validity must call:

```java
connection.markDisabled();
```

- [ ] **Step 5: Run tests**

```bash
./mvnw -Dtest=ConnectionUseCasesTest test
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(workspace): add connection CRUD use cases"
```

---

### Task 4: Credential encryption and manual credential lifecycle

**Files:**
- Create: `.../application/port/out/CredentialCryptoPort.java`
- Create: `.../application/service/CredentialPayloadCodec.java`
- Create: `.../infrastructure/credential/AesGcmCredentialCrypto.java`
- Create: `.../infrastructure/config/CredentialEncryptionProperties.java`
- Create:
  - `SaveCredentialUseCase.java`
  - `DeleteCredentialUseCase.java`
- Modify: `src/main/resources/application.properties`
- Create:
  - `.../infrastructure/credential/AesGcmCredentialCryptoTest.java`
  - `.../application/usecase/CredentialUseCasesTest.java`

**Encryption interface:**

```java
public interface CredentialCryptoPort {
    byte[] encrypt(byte[] plaintext);
    byte[] decrypt(byte[] encryptedPayload);
    String currentKeyVersion();
}
```

Environment:

```properties
weav.credential.encryption-key=${CREDENTIAL_ENCRYPTION_KEY}
weav.credential.encryption-key-version=${CREDENTIAL_ENCRYPTION_KEY_VERSION:v1}
```

`CREDENTIAL_ENCRYPTION_KEY` is Base64 encoding of exactly 32 random bytes.

Binary envelope:

```text
byte 0      : format version = 1
bytes 1..12 : random 12-byte GCM nonce
remaining   : ciphertext + 128-bit GCM authentication tag
```

- [ ] **Step 1: Write crypto tests**

```text
encrypt -> decrypt roundtrip
same plaintext twice -> different ciphertext
tampered ciphertext -> decryption failure
wrong key -> decryption failure
invalid key length -> application startup/config failure
```

- [ ] **Step 2: Implement AES-256-GCM**

Use:

```java
Cipher.getInstance("AES/GCM/NoPadding");
GCMParameterSpec(128, nonce);
SecureRandom();
```

Never use a static IV.

- [ ] **Step 3: Implement provider-specific credential payload validation**

Accepted manual payloads:

```json
TELEGRAM/TOKEN
{ "token": "..." }

HTTP/TOKEN
{ "token": "..." }

HTTP/API_KEY
{ "apiKey": "..." }

HTTP/BASIC
{ "username": "...", "password": "..." }
```

Reject manual credential storage for:

```text
GMAIL/OAUTH2
GOOGLE_SHEETS/OAUTH2
HTTP/NONE
```

- [ ] **Step 4: Implement save/delete use cases**

Save:

```text
authorize
→ validate credential shape
→ JSON serialize
→ encrypt
→ upsert Credential
→ connection.markDisabled()
→ save Connection
```

Delete:

```text
authorize
→ delete Credential
→ if authType != NONE: connection.markDisabled()
→ save Connection
```

Do not auto-test here.

- [ ] **Step 5: Assert secret-safe failures**

Tests must verify exception messages do not contain:

```text
token
apiKey value
password value
encrypted bytes
```

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=AesGcmCredentialCryptoTest,CredentialUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): encrypt and manage connection credentials"
```

---

### Task 5: Provider abstraction, Telegram verification, and HTTP verification

**Files:**
- Create:
  - `.../application/port/out/ConnectionProviderPort.java`
  - `.../application/dto/ConnectionTestResult.java`
  - `.../application/service/ConnectionProviderRegistry.java`
- Create:
  - `.../infrastructure/provider/telegram/TelegramConnectionProvider.java`
  - `.../infrastructure/provider/http/HttpConnectionProvider.java`
  - `.../infrastructure/provider/http/HttpTargetValidator.java`
- Create: `.../application/usecase/TestConnectionUseCase.java`
- Create tests under:
  - `.../infrastructure/provider/telegram/`
  - `.../infrastructure/provider/http/`
  - `.../application/usecase/TestConnectionUseCaseTest.java`

**Port:**

```java
public interface ConnectionProviderPort {
    ConnectionProvider provider();

    void validateConfig(
            ConnectionAuthType authType,
            Map<String, Object> config);

    ConnectionTestResult test(
            Connection connection,
            Map<String, Object> decryptedCredential);
}
```

**Result:**

```java
public enum ConnectionTestOutcome {
    VERIFIED,
    AUTH_INVALID,
    DEPENDENCY_FAILURE
}
```

- [ ] **Step 1: Write Telegram verification tests**

Telegram TOKEN test calls:

```text
GET https://api.telegram.org/bot{token}/getMe
```

Classification:

```text
2xx + ok=true        -> VERIFIED
401/404/bad token    -> AUTH_INVALID
429/5xx/timeout      -> DEPENDENCY_FAILURE
```

Do not include token in logs or exception messages.

- [ ] **Step 2: Write HTTP config/SSRF tests**

Safe:

```text
https://api.example.com
https://api.example.com/health
```

Reject production targets resolving to:

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
fe80::/10
0.0.0.0/8
multicast/reserved/unspecified
common cloud metadata hosts/IPs
```

Validation algorithm:

```text
parse URI
→ scheme must be http/https
→ require host
→ resolve all host addresses immediately before request
→ reject if any resolved address is unsafe
→ reject URL user-info
→ disable/fail redirects rather than following to another target
```

Production may require HTTPS via configuration; dev/test override is explicit.

- [ ] **Step 3: Define HTTP auth application**

```text
NONE:
no Authorization/header injection

TOKEN:
Authorization: Bearer <token>

BASIC:
Authorization: Basic base64(username:password)

API_KEY:
header name comes from non-secret config `apiKeyHeaderName`
secret value comes from encrypted Credential
```

Do not support API key query-string placement in V1.

- [ ] **Step 4: Implement HTTP test behavior**

With `testPath`:

```text
baseUrl + testPath
→ SSRF validation
→ outbound request
→ classify result
```

Without `testPath`:

```text
validate URL/config/auth shape
→ VERIFIED
→ no network call
```

- [ ] **Step 5: Implement TestConnectionUseCase**

```text
load + authorize
→ decrypt credential if required
→ providerRegistry.resolve(provider)
→ test
→ VERIFIED          => markVerified(now)
→ AUTH_INVALID      => markInvalid()
→ DEPENDENCY_FAILURE => preserve previous status and throw DependencyUnavailableException
```

If Connection was `DISABLED` and provider dependency fails, leave it `DISABLED`.

If previously `ACTIVE` and provider dependency temporarily fails, leave it `ACTIVE`.

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=TelegramConnectionProviderTest,HttpConnectionProviderTest,TestConnectionUseCaseTest test

git add services/workspace-service
git commit -m "feat(workspace): verify telegram and http connections"
```

---

### Task 6: Workflow usage contract and fail-closed mutation protection

**Files:**
- Create: `packages/contracts/http/workflow/openapi.yaml`
- Remove after contract file exists: `packages/contracts/http/workflow/.gitkeep`
- Create: `.../application/port/out/WorkflowConnectionUsagePort.java`
- Create: `.../infrastructure/workflow/WorkflowConnectionUsageClient.java`
- Create: `.../infrastructure/config/WorkflowServiceProperties.java`
- Modify:
  - `UpdateConnectionUseCase.java`
  - `SaveCredentialUseCase.java`
  - `DeleteCredentialUseCase.java`
- Create: `DeleteConnectionUseCase.java`
- Modify: `application.properties`
- Create: `.../application/usecase/ConnectionUsageProtectionTest.java`

**Workflow contract:**

```http
GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage
X-Internal-Service-Key: ...
```

Response:

```json
{
  "inUse": true
}
```

Port:

```java
public interface WorkflowConnectionUsagePort {
    boolean isInUse(UUID workspaceId, UUID connectionId);
}
```

- [ ] **Step 1: Write usage-protection tests**

Required cases:

```text
MEMBER + own + inUse=false  -> update credential/config allowed
MEMBER + own + inUse=true   -> 409
OWNER + inUse=true          -> update credential/config allowed
DELETE + inUse=true         -> 409 for OWNER and MEMBER
Workflow unavailable        -> 503, no mutation
```

- [ ] **Step 2: Configure Workflow client**

```properties
weav.workflow.base-url=${WORKFLOW_SERVICE_URL:http://localhost:8082}
weav.workflow.connect-timeout=${WORKFLOW_CONNECT_TIMEOUT:3s}
weav.workflow.read-timeout=${WORKFLOW_READ_TIMEOUT:5s}
weav.workflow.internal-service-key=${WORKFLOW_INTERNAL_SERVICE_KEY:}
```

- [ ] **Step 3: Implement mutation guard**

```java
if (membership.getRole() == MembershipRole.MEMBER
        && workflowConnectionUsagePort.isInUse(
                connection.getWorkspaceId(),
                connection.getId())) {
    throw new ConflictException("Connection is used by a workflow");
}
```

OWNER skips usage guard for update/credential rotation.

- [ ] **Step 4: Implement deletion**

All roles must usage-check.

```text
authorize local ownership/OWNER
→ call Workflow usage endpoint
→ unavailable -> DependencyUnavailableException
→ inUse -> ConflictException
→ short transaction
→ re-read Connection
→ delete
```

Credential cascade is handled by FK.

- [ ] **Step 5: Ensure no DB transaction wraps remote Workflow call**

The remote call must occur before the short deletion/mutation transaction.

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=ConnectionUsageProtectionTest test

git add packages/contracts/http/workflow \
        services/workspace-service
git commit -m "feat(workspace): protect referenced connections"
```

---

### Task 7: Google OAuth foundation and one-time state

**Files:**
- Create:
  - `.../application/port/out/GoogleOAuthPort.java`
  - `.../application/port/out/OAuthStateStore.java`
  - `.../application/dto/OAuthPendingState.java`
  - `.../application/dto/OAuthAuthorizationResponse.java`
  - `.../application/service/GoogleOAuthScopePolicy.java`
- Create:
  - `.../infrastructure/cache/RedisOAuthStateStore.java`
  - `.../infrastructure/provider/google/GoogleOAuthProvider.java`
  - `.../infrastructure/provider/google/GoogleConnectionProvider.java`
  - `.../infrastructure/config/GoogleOAuthProperties.java`
- Create:
  - `StartConnectionOAuthUseCase.java`
  - `CompleteConnectionOAuthUseCase.java`
- Modify: `application.properties`
- Create OAuth/state tests.

**Google configuration:**

```properties
weav.google.oauth.client-id=${GOOGLE_OAUTH_CLIENT_ID:}
weav.google.oauth.client-secret=${GOOGLE_OAUTH_CLIENT_SECRET:}
weav.google.oauth.redirect-uri=${GOOGLE_OAUTH_REDIRECT_URI:http://localhost:8080/oauth/google/callback}
weav.google.oauth.frontend-return-url=${GOOGLE_OAUTH_FRONTEND_RETURN_URL:http://localhost:3000/connections}
weav.google.oauth.state-ttl=${GOOGLE_OAUTH_STATE_TTL:PT10M}
```

Do not accept arbitrary redirect URL from API clients.

- [ ] **Step 1: Implement scope policy**

V1 scopes:

```text
GMAIL:
openid
email
https://www.googleapis.com/auth/gmail.metadata
```

This is enough to authorize/identify/test Gmail without granting send permission before a Gmail send node exists.

When a Gmail send node is introduced, expand policy on the same Connection with:

```text
https://www.googleapis.com/auth/gmail.send
```

and require re-consent.

Current V1 Google Sheets operations include read rows and append row, therefore use:

```text
openid
email
https://www.googleapis.com/auth/spreadsheets
```

Do not add broad Drive scope merely to make testing easier.

- [ ] **Step 2: Implement Redis OAuth state**

Key:

```text
workspace:oauth-state:<random-256-bit-state>
```

Value:

```json
{
  "workspaceId": "...",
  "connectionId": "...",
  "userId": "...",
  "provider": "GOOGLE_SHEETS"
}
```

TTL: 10 minutes by default.

Consume semantics must be atomic:

```text
read + delete exactly once
```

Use Redis operation/Lua/GETDEL equivalent supported by current Spring Data Redis version.

- [ ] **Step 3: Write replay/expiry tests**

```text
valid state -> returned once
second consume -> absent
expired state -> absent
wrong provider/connection -> callback rejected
```

- [ ] **Step 4: Implement StartConnectionOAuthUseCase**

```text
JWT actor
→ membership
→ manage permission
→ provider must GMAIL or GOOGLE_SHEETS
→ mark DISABLED
→ persist
→ create one-time state
→ build Google authorization URL
→ return { authorizationUrl }
```

Google authorization request uses:

```text
response_type=code
access_type=offline
include_granted_scopes=true
prompt=consent when refresh-token acquisition/re-consent requires it
```

- [ ] **Step 5: Implement callback exchange**

Callback flow:

```text
consume state
→ load Connection
→ verify workspace/provider
→ re-check current membership of state.userId
→ re-check management permission
→ exchange authorization code
→ validate granted scopes contain policy-required scopes
→ serialize/encrypt OAuth credential
→ save Credential
→ verify Google connection
→ VERIFIED     => ACTIVE
→ AUTH_INVALID => INVALID
```

Credential payload contains:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "Bearer",
  "grantedScopes": ["..."]
}
```

Use `Credential.expiresAt` as canonical access-token expiry.

- [ ] **Step 6: Define Google verification**

Gmail:

```text
GET Gmail users/me/profile
```

Google Sheets:

```text
validate token through Google's OAuth endpoint
+
verify required `spreadsheets` scope is granted
```

Do not request Drive scope and do not store a spreadsheet ID in Connection merely for testing.

- [ ] **Step 7: Run tests and commit**

```bash
./mvnw -Dtest=RedisOAuthStateStoreTest,GoogleOAuthProviderTest,GoogleOAuthUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): add google oauth connection flow"
```

---

### Task 8: Runtime resolve, Google refresh, attachment authorization, and auth-failure reporting

**Files:**
- Create:
  - `.../application/dto/ResolvedConnectionCredential.java`
  - `.../application/usecase/ResolveConnectionUseCase.java`
  - `.../application/usecase/AuthorizeConnectionAttachmentUseCase.java`
  - `.../application/usecase/ReportConnectionAuthFailureUseCase.java`
- Extend: `GoogleOAuthPort.java`
- Create tests: `InternalConnectionUseCasesTest.java`

**Resolve signature:**

```java
public ResolvedConnectionCredential execute(
        UUID workspaceId,
        UUID connectionId);
```

- [ ] **Step 1: Write resolve tests**

Cases:

```text
wrong workspaceId                  -> not found
DISABLED                           -> conflict/invalid state
INVALID                            -> conflict/invalid state
missing required credential        -> invalid state
expired non-refreshable credential -> invalid
active Telegram                    -> returns token
active HTTP BASIC                  -> returns username/password
Google valid access token          -> returns access token only
Google expired access token        -> refreshes then returns new access token
```

- [ ] **Step 2: Implement minimum runtime credential response**

Examples:

```json
{
  "provider": "GMAIL",
  "authType": "OAUTH2",
  "auth": {
    "accessToken": "..."
  }
}
```

```json
{
  "provider": "TELEGRAM",
  "authType": "TOKEN",
  "auth": {
    "token": "..."
  }
}
```

Never return Google `refreshToken`.

- [ ] **Step 3: Implement Google refresh**

```text
decrypt current credential
→ expiresAt still valid -> return access token
→ expired -> call Google token endpoint using refresh token
→ receive new access token
→ preserve old refresh token if Google does not return a new one
→ encrypt updated credential
→ short DB transaction
→ save
→ return new access token
```

For V1, duplicate concurrent refresh requests are tolerated; do not add Redis locking. Last successfully encrypted valid token wins.

- [ ] **Step 4: Implement attachment authorization**

```java
public void execute(
        UUID userId,
        UUID workspaceId,
        UUID connectionId);
```

Require:

```text
Connection belongs to workspace
user is member
OWNER OR connection.createdBy == userId
```

Do not require Connection to be currently ACTIVE when editing a workflow; runtime resolve enforces ACTIVE.

- [ ] **Step 5: Implement auth-failure reporting**

Only confirmed auth failures call:

```java
connection.markInvalid();
```

Endpoint payload later supports only:

```text
AUTHENTICATION_REJECTED
```

Do not support arbitrary provider error bodies.

- [ ] **Step 6: Run and commit**

```bash
./mvnw -Dtest=InternalConnectionUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): resolve runtime connection credentials"
```

---

### Task 9: Public and internal HTTP APIs + OpenAPI contract

**Files:**
- Modify: `packages/contracts/http/workspace/openapi.yaml`
- Modify: `packages/contracts/http/workspace/README.md`
- Create:
  - `.../presentation/http/ConnectionController.java`
  - `.../presentation/http/InternalConnectionController.java`
  - `.../presentation/http/GoogleOAuthCallbackController.java`
- Create request records:
  - `CreateConnectionRequest.java`
  - `UpdateConnectionRequest.java`
  - `SaveCredentialRequest.java`
  - `ReportConnectionAuthFailureRequest.java`
- Create response records:
  - `OAuthAuthorizationHttpResponse.java`
  - `ResolvedConnectionHttpResponse.java`
- Modify:
  - `.../infrastructure/security/SecurityConfig.java`
  - `services/workspace-service/src/test/java/com/weav/workspace/SecurityConfigTest.java`
  - `WorkspaceContractValidationTest.java`
- Create controller integration tests.

**Public endpoints:**

```text
POST   /workspaces/{workspaceId}/connections
GET    /workspaces/{workspaceId}/connections
GET    /workspaces/{workspaceId}/connections/{connectionId}
PATCH  /workspaces/{workspaceId}/connections/{connectionId}
DELETE /workspaces/{workspaceId}/connections/{connectionId}

PUT    /workspaces/{workspaceId}/connections/{connectionId}/credential
DELETE /workspaces/{workspaceId}/connections/{connectionId}/credential

POST   /workspaces/{workspaceId}/connections/{connectionId}/test
POST   /workspaces/{workspaceId}/connections/{connectionId}/disable

POST   /workspaces/{workspaceId}/connections/{connectionId}/oauth/authorize

GET    /oauth/google/callback
```

The explicit `/disable` route is required to expose the already-approved manual-disable lifecycle without allowing clients to set arbitrary status values.

**Internal endpoints:**

```text
POST /internal/workspaces/{workspaceId}/connections/{connectionId}/authorize-attachment

POST /internal/workspaces/{workspaceId}/connections/{connectionId}/resolve

POST /internal/workspaces/{workspaceId}/connections/{connectionId}/auth-failure
```

- [ ] **Step 1: Extend OpenAPI first**

Public `ConnectionResponse` documents that:

```text
config may be null when caller may only see metadata
credential secret is never exposed
credentialExpiresAt is safe metadata
```

- [ ] **Step 2: Add controllers**

Controllers only:

```text
parse HTTP input
extract JwtActor
call use case
map result
```

No authorization logic in controller.

- [ ] **Step 3: Configure security**

Rules:

```text
/oauth/google/callback -> permitAll

/internal/** -> internal-service-key filter/security chain

/workspaces/** -> authenticated JWT
```

OAuth start remains JWT-protected.

- [ ] **Step 4: Implement callback redirect**

Success:

```text
302 <configured-frontend-return-url>?connectionId=<id>&oauth=success
```

Failure:

```text
302 <configured-frontend-return-url>?connectionId=<id>&oauth=failed&reason=<safe-code>
```

Safe failure codes only:

```text
state_invalid
authorization_denied
authorization_changed
token_exchange_failed
verification_failed
```

Never include Google error detail, authorization code, access token or refresh token in URL.

- [ ] **Step 5: Write security/contract tests**

Verify:

```text
callback succeeds through security chain without JWT
oauth authorize requires JWT
internal resolve rejects missing/wrong internal key
public endpoints reject internal key as user authentication
OpenAPI contains all Connection routes
```

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=SecurityConfigTest,WorkspaceContractValidationTest,ConnectionControllerTest,InternalConnectionControllerTest,GoogleOAuthCallbackControllerTest test

git add packages/contracts/http/workspace \
        services/workspace-service
git commit -m "feat(workspace): expose connection and credential APIs"
```

---

### Task 10: End-to-end security regression and documentation

**Files:**
- Create: `services/workspace-service/src/test/java/com/weav/workspace/ConnectionEndToEndTest.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/CredentialSecretRegressionTest.java`
- Modify: `services/workspace-service/README.md`
- Modify environment/documentation examples as applicable.

- [ ] **Step 1: Add end-to-end Telegram/manual credential scenario**

```text
create Connection
→ DISABLED

save Credential
→ DISABLED

test
→ provider mock returns success
→ ACTIVE

internal resolve
→ returns runtime token

replace Credential
→ DISABLED
```

- [ ] **Step 2: Add Google OAuth scenario**

Using provider mock/stub:

```text
create GOOGLE_SHEETS Connection
→ start OAuth
→ state stored
→ callback exchange
→ credential encrypted
→ verification succeeds
→ ACTIVE
→ callback redirects success
→ state replay fails
→ resolve returns access token only
```

- [ ] **Step 3: Add usage protection E2E**

```text
Workflow usage mock = true

MEMBER update own Connection -> 409
OWNER rotate credential      -> allowed
DELETE                        -> 409

Workflow unavailable
DELETE/mutation requiring check -> 503
```

- [ ] **Step 4: Add secret regression assertions**

Serialize/log/error paths and assert output does not contain seeded secrets:

```text
telegram-secret-123
http-password-123
google-access-secret
google-refresh-secret
```

Also inspect Redis OAuth state and confirm none appear there.

- [ ] **Step 5: Update README**

Replace Connection/Credential "deferred" wording with implemented V1 behavior.

Document environment variables:

```text
CREDENTIAL_ENCRYPTION_KEY
CREDENTIAL_ENCRYPTION_KEY_VERSION

GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_OAUTH_FRONTEND_RETURN_URL

WORKFLOW_SERVICE_URL
WORKFLOW_INTERNAL_SERVICE_KEY
```

Document status semantics:

```text
DISABLED = configured/incomplete/unverified/manually disabled
ACTIVE   = verified and usable
INVALID  = known-bad authentication
```

- [ ] **Step 6: Run complete Workspace test suite**

```bash
cd services/workspace-service
./mvnw test
```

Expected:

```text
all existing Workspace Core tests remain green
all Connection/Credential tests green
```

- [ ] **Step 7: Validate contract and migration from clean DB**

Run test suite with fresh Testcontainers PostgreSQL/Redis to guarantee V1 -> V2 -> V3 migration works from zero.

- [ ] **Step 8: Final commit**

```bash
git add services/workspace-service \
        packages/contracts/http/workspace \
        packages/contracts/http/workflow

git commit -m "feat(workspace): complete connection and credential v1"
```

---

# Recommended Implementation Order

```text
Task 1  Domain rules
   ↓
Task 2  Persistence
   ↓
Task 3  Connection CRUD
   ↓
Task 4  Credential crypto
   ↓
Task 5  Telegram + HTTP test
   ↓
Task 6  Workflow usage protection
   ↓
Task 7  Google OAuth
   ↓
Task 8  Runtime resolve/internal flows
   ↓
Task 9  HTTP/OpenAPI/security
   ↓
Task 10 E2E + docs + full regression
```

This order deliberately gets a working manual Connection flow before Google OAuth is introduced.

A useful checkpoint after **Task 6** is:

```text
Telegram + HTTP Connection/Credential V1 works end-to-end
+
workflow usage protection exists
```

Google OAuth can then be implemented without destabilizing core Connection behavior.

# Definition of Done

Workspace Service V1 is complete when all of the following are true:

```text
Connection CRUD works.
Connection name uniqueness is enforced by normalized DB constraint.
Provider/auth combinations are enforced.
Credential secrets are AES-256-GCM encrypted.
Public APIs never expose credential secrets.
Telegram can save/test/resolve TOKEN credentials.
HTTP NONE/API_KEY/TOKEN/BASIC can validate/test/resolve credentials.
HTTP outbound test has SSRF protections.
Google Gmail/Sheets OAuth authorization flow works.
OAuth state is one-time and expiring.
Google refresh tokens never leave Workspace.
Expired Google access tokens can refresh during resolve.
Connection lifecycle follows DISABLED/ACTIVE/INVALID rules.
OWNER/MEMBER management rules are enforced.
MEMBER cannot mutate referenced Connection.
OWNER can rotate referenced Connection.
Referenced Connection cannot be deleted.
Workflow outage fails closed for protected mutations.
Workflow can authorize connection attachment through Workspace.
Worker can resolve minimum runtime auth.
Worker can report confirmed auth failure.
Transient provider failure does not incorrectly mark INVALID.
Existing Workspace Core tests remain green.
README/OpenAPI reflect implemented behavior.
```

# Explicitly Not Included

```text
Workspace delete/archive
invitations
ownership transfer
custom roles / generic RBAC
shared OAuth grants between Gmail and Sheets
KMS/per-workspace encryption keys
generic provider plugin framework
HTTP API key query-string injection
automatic force-detach of Connections from workflows
secret caching
full provider execution proxying through Workspace Service
```
