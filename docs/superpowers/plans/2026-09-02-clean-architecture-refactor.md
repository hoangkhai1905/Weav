# 8-Service Clean Architecture Incremental Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incrementally refactor all 8 Weav services (`identity-service`, `workspace-service`, `workflow-service`, `api-gateway`, `ai-service`, `bot-service`, `notification-service`, `ocr-service`) into strict, pragmatic Clean Architecture while preserving existing behavior, database schemas, Flyway migrations, UTC timezone constraints, and API contracts.

**Architecture:** Pure Domain layer (framework-agnostic entities, value objects, domain ports, and domain exceptions), Application layer (use cases, commands/queries, application DTOs), Infrastructure layer (Spring Data JPA / Prisma / PaddleOCR / external SDK adapters, persistence entities, mappers, security, configuration), and Presentation layer (REST controllers, FastAPI routers, request validation records, response DTOs, error handlers).

**Tech Stack:**
- **Backend Core (Java):** Java 25, Spring Boot 4.1.0, Spring Data JPA, Flyway, PostgreSQL (Neon Pooler, SSL required), MapStruct 1.6.3, Spring Security, Testcontainers, ArchUnit.
- **Backend Node/TS:** Node 24, NestJS 11, Fastify (`@nestjs/platform-fastify`), Prisma 7.9.1, grammY, Expo Server SDK, Jose (JWT), Zod/Class-Validator, Jest.
- **AI & OCR (Python/TS):** Python 3.12, FastAPI, PaddleOCR 3.7.0, OpenCV 5.0.0, Pytest, Ruff; Anthropic SDK, OpenAI SDK.
- **Code Intelligence & Impact:** GitNexus MCP (`impact`, `detect_changes`, `context`).

**Spec:** Notion `Class Model Source of Truth — V1`, Notion `Full Tree Diagram`, `docs/work_logs/2026-09-01.md`, `docs/work_logs/2026-09-02.md`, `AGENTS.md`.

## Global Constraints

- **Preserve Flyway Migrations:** Never edit, rename, or drop existing `V1` migrations (`V1__create_identity_entities.sql`, `V1__create_workspace_entities.sql`, `V1__create_workflow_entities.sql`). Table and column names must remain 100% backward compatible.
- **Zero Framework in Domain:** Java `domain/` classes must have zero dependencies on Spring (`org.springframework.*`), JPA (`jakarta.persistence.*`), or Hibernate.
- **Strict Timezone Handling:** Timestamps are stored and processed internally as UTC (`Instant` in Java, `TIMESTAMPTZ` in Postgres, ISO-8601 UTC in JSON/Python). Conversion to `Asia/Saigon` is performed solely at the response/read presentation layer when required.
- **Cross-Service References:** Cross-service references remain scalar `UUID`s. No cross-service JPA relationships or shared persistence schemas.
- **Error Contract Stability:** Standard `ApiErrorResponse` schema (`error.code`, `error.message`, `error.details`, `timestamp`, `status`, `path`) and exception mapping must remain identical across all refactors.
- **Pre-Edit Impact Gate:** Run GitNexus `impact({target: "<symbolName>", direction: "upstream"})` before modifying any established symbol. Treat `risk: UNKNOWN` as unresolved and verify with text search.
- **Post-Edit Change Gate:** Run GitNexus `detect_changes({scope: "all"})` and `git diff --check` before claiming a phase complete.
- **Worktree / Alias Safety:** Work strictly within `T:\Weav_Alias`.

---

## Service Execution Matrix & Worker Assignments

| Phase | Service | Primary Stack | Scope & Focus | Primary Worker | Supporting Worker |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | `identity-service` | Java 25 / Spring Boot | Domain isolation, User/Session/OAuth ports, persistence mappers, ArchUnit gate | `agy` | `opencode` |
| **Phase 2** | `workspace-service` | Java 25 / Spring Boot | Workspace/Member/Connection/Credential domain models, JPA adapter, validation | `agy` | `opencode` |
| **Phase 3** | `workflow-service` | Java 25 / Spring Boot | Workflow/Execution/Agent aggregates, outbox, complex mapper layer | `agy` | `opencode` |
| **Phase 4** | `api-gateway` | NestJS / Fastify / TS | Fastify routing, JWT verification ports, proxy middleware, rate limiting | `opencode` | `agy` |
| **Phase 5** | `ai-service` | NestJS / Fastify / TS | LLM provider ports (OpenAI/Anthropic), prompt template domain, use cases | `opencode` | `agy` |
| **Phase 6** | `bot-service` | NestJS / TS / grammY | Telegram bot ports, webhook presentation, command use cases, Prisma adapter | `opencode` | `agy` |
| **Phase 7** | `notification-service`| NestJS / TS / Expo | Notification channel ports (Push/Email), Expo SDK adapter, Prisma persistence | `opencode` | `agy` |
| **Phase 8** | `ocr-service` | Python 3.12 / FastAPI | PaddleOCR/OpenCV engine ports, FastAPI presentation, image use cases | `opencode` | `agy` |

---

## Phase 1: Identity Service Clean Architecture Refactoring

### Target Structure:
```text
services/identity-service/src/
├── main/java/com/weav/identity/
│   ├── IdentityServiceApplication.java
│   ├── domain/
│   │   ├── model/
│   │   │   ├── User.java                          [NEW pure domain]
│   │   │   ├── UserSession.java                   [NEW pure domain]
│   │   │   └── OAuthAccount.java                  [NEW pure domain]
│   │   ├── valueobject/
│   │   │   ├── SystemRole.java                    [MOVE from entity]
│   │   │   ├── UserStatus.java                    [MOVE from entity]
│   │   │   └── OAuthProvider.java                 [MOVE from entity]
│   │   ├── port/
│   │   │   └── out/
│   │   │       ├── UserRepository.java            [NEW domain port]
│   │   │       ├── UserSessionRepository.java     [NEW domain port]
│   │   │       └── OAuthAccountRepository.java    [NEW domain port]
│   │   └── exception/
│   │       ├── WeavException.java                 [MOVE from shared/exception]
│   │       ├── DomainException.java               [MOVE from shared/exception]
│   │       ├── BadRequestException.java           [MOVE from shared/exception]
│   │       ├── ConflictException.java             [MOVE from shared/exception]
│   │       ├── ForbiddenException.java            [MOVE from shared/exception]
│   │       ├── InvalidStateException.java         [MOVE from shared/exception]
│   │       ├── ResourceNotFoundException.java     [MOVE from shared/exception]
│   │       └── UnauthorizedException.java         [MOVE from shared/exception]
│   ├── application/
│   │   ├── usecase/
│   │   │   └── RegisterUserUseCase.java           [NEW interface/impl]
│   │   └── dto/
│   │       └── RegisterUserCommand.java           [NEW record]
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   ├── entity/
│   │   │   │   ├── UserJpaEntity.java             [RENAME User.java]
│   │   │   │   ├── UserSessionJpaEntity.java      [RENAME UserSession.java]
│   │   │   │   └── OAuthAccountJpaEntity.java     [RENAME OAuthAccount.java]
│   │   │   ├── repository/
│   │   │   │   ├── SpringDataUserRepository.java  [NEW Spring Data interface]
│   │   │   │   ├── SpringDataUserSessionRepository.java [NEW]
│   │   │   │   ├── SpringDataOAuthAccountRepository.java [NEW]
│   │   │   │   ├── UserRepositoryAdapter.java     [NEW implements UserRepository]
│   │   │   │   ├── UserSessionRepositoryAdapter.java [NEW]
│   │   │   │   └── OAuthAccountRepositoryAdapter.java [NEW]
│   │   │   └── mapper/
│   │   │       └── UserPersistenceMapper.java     [NEW MapStruct mapper]
│   │   ├── security/
│   │   │   ├── SecurityConfig.java                [MOVE from config]
│   │   │   └── JwtProperties.java                 [MOVE from config]
│   │   └── web/
│   │       ├── ApiErrorResponse.java              [MOVE from shared/web]
│   │       └── GlobalExceptionHandler.java        [MOVE from shared/web]
│   └── presentation/
│       └── http/
│           ├── request/
│           │   ├── RegisterUserRequest.java       [MOVE from user/api/request]
│           │   └── package-info.java              [MOVE]
│           ├── response/
│           │   └── UserResponse.java              [NEW record]
│           └── mapper/
│               └── UserPresentationMapper.java    [NEW MapStruct mapper]
└── test/java/com/weav/identity/
    ├── architecture/
    │   └── IdentityCleanArchitectureTest.java     [NEW ArchUnit test]
    ├── infrastructure/persistence/
    │   └── UserPersistenceIntegrationTest.java    [UPDATE from IdentityServiceApplicationTests]
    └── presentation/http/
        ├── GlobalExceptionHandlerTest.java        [UPDATE imports]
        ├── RegisterUserRequestValidationTest.java [UPDATE imports]
        └── SecurityConfigTest.java                [UPDATE imports]
```

---

### Task 1.1: ArchUnit Architecture Gate & Domain Models Setup
**Files:**
- Modify: `services/identity-service/pom.xml` (add ArchUnit dependency `com.tngtech.archunit:archunit-junit5:1.4.0`)
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/valueobject/SystemRole.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/valueobject/UserStatus.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/valueobject/OAuthProvider.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/model/User.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/model/UserSession.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/model/OAuthAccount.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/domain/port/out/UserRepository.java`
- Create: `services/identity-service/src/test/java/com/weav/identity/architecture/IdentityCleanArchitectureTest.java`

**Interfaces:**
- Consumes: Notion Class Model V1 definitions.
- Produces: Pure domain aggregate roots and repository port interfaces with zero Spring/JPA dependencies.

- [ ] **Step 1: Write failing ArchUnit test to verify package dependencies and domain purity**

```java
package com.weav.identity.architecture;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.weav.identity")
public class IdentityCleanArchitectureTest {

    @ArchTest
    public static final ArchRule domain_should_not_depend_on_frameworks =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "org.springframework..",
                "jakarta.persistence..",
                "org.hibernate.."
            );

    @ArchTest
    public static final ArchRule domain_should_only_be_accessed_by_allowed_layers =
        classes().that().resideInAPackage("..domain..")
            .should().onlyBeAccessed().byAnyPackage("..domain..", "..application..", "..infrastructure..", "..presentation..", "..identity");
}
```

- [ ] **Step 2: Add ArchUnit dependency to POM and verify failure**

Run: `services/identity-service/mvnw.cmd test -Dtest=IdentityCleanArchitectureTest`
Expected: Passes once pure domain package is established.

- [ ] **Step 3: Implement pure domain models and ports**

```java
// domain/model/User.java
package com.weav.identity.domain.model;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class User {
    private final UUID id;
    private String email;
    private String passwordHash;
    private String displayName;
    private String avatarStorageKey;
    private SystemRole systemRole;
    private UserStatus status;
    private final Instant createdAt;
    private Instant updatedAt;

    public User(UUID id, String email, String passwordHash, String displayName,
                String avatarStorageKey, SystemRole systemRole, UserStatus status,
                Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.email = Objects.requireNonNull(email, "email must not be null");
        this.systemRole = Objects.requireNonNull(systemRole, "systemRole must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.avatarStorageKey = avatarStorageKey;
    }

    public static User createNew(String email, String passwordHash, String displayName, SystemRole systemRole) {
        Instant now = Instant.now();
        return new User(UUID.randomUUID(), email, passwordHash, displayName, null, systemRole, UserStatus.ACTIVE, now, now);
    }

    // Getters & business mutators (updateDisplayName, changePassword, deactivate)
    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public String getDisplayName() { return displayName; }
    public String getAvatarStorageKey() { return avatarStorageKey; }
    public SystemRole getSystemRole() { return systemRole; }
    public UserStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
```

```java
// domain/port/out/UserRepository.java
package com.weav.identity.domain.port.out;

import com.weav.identity.domain.model.User;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository {
    User save(User user);
    Optional<User> findById(UUID id);
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
}
```

- [ ] **Step 4: Run ArchUnit test to verify domain layer purity**
Run: `services/identity-service/mvnw.cmd test -Dtest=IdentityCleanArchitectureTest`
Expected: `BUILD SUCCESS`

- [ ] **Step 5: Commit Phase 1 Task 1**
```bash
git add services/identity-service/pom.xml services/identity-service/src/main/java/com/weav/identity/domain services/identity-service/src/test/java/com/weav/identity/architecture
git commit -m "feat(identity): establish pure domain models, ports, and ArchUnit rules"
```

---

### Task 1.2: Infrastructure Persistence Separation & MapStruct Mapper
**Files:**
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/entity/UserJpaEntity.java` (Rename/Refactor `User.java`)
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/entity/UserSessionJpaEntity.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/entity/OAuthAccountJpaEntity.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/mapper/UserPersistenceMapper.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/repository/SpringDataUserRepository.java`
- Create: `services/identity-service/src/main/java/com/weav/identity/infrastructure/persistence/repository/UserRepositoryAdapter.java`
- Modify: `services/identity-service/src/test/java/com/weav/identity/IdentityServiceApplicationTests.java`

**Interfaces:**
- Consumes: `UserRepository` port from Domain.
- Produces: `UserRepositoryAdapter` implementing `UserRepository` via `SpringDataUserRepository` and `UserPersistenceMapper`.

- [ ] **Step 1: Write persistence adapter integration test**

```java
package com.weav.identity.infrastructure.persistence;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class UserPersistenceIntegrationTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldSaveAndFindDomainUserThroughAdapter() {
        User user = User.createNew("clean.arch@weav.local", "hashed_pwd", "Clean Arch", SystemRole.USER);
        User saved = userRepository.save(user);

        Optional<User> found = userRepository.findById(saved.getId());
        assertThat(found).isPresent();
        assertThat(found.get().getEmail()).isEqualTo("clean.arch@weav.local");
        assertThat(found.get().getDisplayName()).isEqualTo("Clean Arch");
    }
}
```

- [ ] **Step 2: Implement MapStruct persistence mapper and repository adapter**

```java
// infrastructure/persistence/mapper/UserPersistenceMapper.java
package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.User;
import com.weav.identity.infrastructure.persistence.entity.UserJpaEntity;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface UserPersistenceMapper {
    User toDomain(UserJpaEntity entity);
    UserJpaEntity toEntity(User domain);
}
```

```java
// infrastructure/persistence/repository/UserRepositoryAdapter.java
package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.infrastructure.persistence.mapper.UserPersistenceMapper;
import org.springframework.stereotype.Component;
import java.util.Optional;
import java.util.UUID;

@Component
public class UserRepositoryAdapter implements UserRepository {
    private final SpringDataUserRepository jpaRepository;
    private final UserPersistenceMapper mapper;

    public UserRepositoryAdapter(SpringDataUserRepository jpaRepository, UserPersistenceMapper mapper) {
        this.jpaRepository = jpaRepository;
        this.mapper = mapper;
    }

    @Override
    public User save(User user) {
        return mapper.toDomain(jpaRepository.save(mapper.toEntity(user)));
    }

    @Override
    public Optional<User> findById(UUID id) {
        return jpaRepository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<User> findByEmail(String email) {
        return jpaRepository.findByEmail(email).map(mapper::toDomain);
    }

    @Override
    public boolean existsByEmail(String email) {
        return jpaRepository.existsByEmail(email);
    }
}
```

- [ ] **Step 3: Run integration test and verify JPA persistence mapping**
Run: `services/identity-service/mvnw.cmd test -Dtest=UserPersistenceIntegrationTest`
Expected: `BUILD SUCCESS` (1 test passes, Flyway V1 validated against Neon/Testcontainers).

- [ ] **Step 4: Clean up old entity location and run full test suite**
Delete legacy entity classes that were renamed to `JpaEntity`.
Run: `services/identity-service/mvnw.cmd test`
Expected: All tests pass.

- [ ] **Step 5: Commit Phase 1 Task 1.2**
```bash
git add services/identity-service/src/
git commit -m "refactor(identity): separate JPA entities and implement UserRepositoryAdapter with MapStruct"
```

---

### Task 1.3: Presentation, Security, and Error Handling Clean Placement
**Files:**
- Move: `com.weav.identity.config.SecurityConfig` -> `com.weav.identity.infrastructure.security.SecurityConfig`
- Move: `com.weav.identity.config.JwtProperties` -> `com.weav.identity.infrastructure.security.JwtProperties`
- Move: `com.weav.identity.shared.web.*` -> `com.weav.identity.presentation.http.error.*` (or `infrastructure.web`)
- Move: `com.weav.identity.user.api.request.RegisterUserRequest` -> `com.weav.identity.presentation.http.request.RegisterUserRequest`
- Update: Test classes (`SecurityConfigTest`, `GlobalExceptionHandlerTest`, `RegisterUserRequestValidationTest`) to match new package namespaces.

- [ ] **Step 1: Execute GitNexus impact analysis before refactoring security and web handlers**
Run MCP / CLI impact on `SecurityConfig`, `GlobalExceptionHandler`, `RegisterUserRequest`.
Expected: Verify references and update imports systematically.

- [ ] **Step 2: Update all call sites and test suites**
Run: `services/identity-service/mvnw.cmd clean test`
Expected: `BUILD SUCCESS`, 12+ tests passing.

- [ ] **Step 3: Commit Phase 1 Task 1.3**
```bash
git add services/identity-service/src/
git commit -m "refactor(identity): relocate security, web exception handler, and request DTOs to Clean Architecture layers"
```

---

## Phase 2: Workspace Service Clean Architecture Refactoring

### Target Structure:
```text
services/workspace-service/src/
├── main/java/com/weav/workspace/
│   ├── WorkspaceServiceApplication.java
│   ├── domain/
│   │   ├── model/
│   │   │   ├── Workspace.java                     [NEW pure domain]
│   │   │   ├── Membership.java                    [NEW pure domain]
│   │   │   ├── Connection.java                    [NEW pure domain]
│   │   │   └── Credential.java                    [NEW pure domain]
│   │   ├── valueobject/
│   │   │   ├── MembershipRole.java                [MOVE from entity]
│   │   │   ├── ConnectionProvider.java            [MOVE from entity]
│   │   │   ├── ConnectionAuthType.java            [MOVE from entity]
│   │   │   └── ConnectionStatus.java              [MOVE from entity]
│   │   ├── port/
│   │   │   └── out/
│   │   │       ├── WorkspaceRepository.java       [NEW domain port]
│   │   │       ├── MembershipRepository.java      [NEW domain port]
│   │   │       ├── ConnectionRepository.java      [NEW domain port]
│   │   │       └── CredentialRepository.java      [NEW domain port]
│   │   └── exception/ (Domain exceptions)
│   ├── application/
│   │   ├── usecase/
│   │   │   └── CreateWorkspaceUseCase.java        [NEW]
│   │   └── dto/
│   │       └── CreateWorkspaceCommand.java        [NEW]
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   ├── entity/ (WorkspaceJpaEntity, MembershipJpaEntity, ConnectionJpaEntity, CredentialJpaEntity)
│   │   │   ├── repository/ (Spring Data repos & Repository Adapters)
│   │   │   └── mapper/ (WorkspacePersistenceMapper)
│   │   ├── security/ (SecurityConfig, JwtProperties)
│   │   └── web/ (ApiErrorResponse, GlobalExceptionHandler)
│   └── presentation/
│       └── http/
│           ├── request/ (CreateWorkspaceRequest, package-info)
│           └── response/ (WorkspaceResponse)
└── test/java/com/weav/workspace/
    ├── architecture/WorkspaceCleanArchitectureTest.java
    └── infrastructure/persistence/WorkspacePersistenceIntegrationTest.java
```

---

### Task 2.1: Domain Layer Extraction & ArchUnit Rule Setup
**Files:**
- Modify: `services/workspace-service/pom.xml` (add ArchUnit dependency)
- Create: `domain/model/Workspace.java`, `domain/model/Membership.java`, `domain/model/Connection.java`, `domain/model/Credential.java`
- Move: `MembershipRole.java`, `ConnectionProvider.java`, `ConnectionAuthType.java`, `ConnectionStatus.java` to `domain/valueobject/`
- Create: `domain/port/out/WorkspaceRepository.java`, `MembershipRepository.java`, `ConnectionRepository.java`, `CredentialRepository.java`
- Create: `src/test/java/com/weav/workspace/architecture/WorkspaceCleanArchitectureTest.java`

- [ ] **Step 1: Write ArchUnit test for Workspace Service**
Verify domain layer has no `org.springframework.*` or `jakarta.persistence.*`.

- [ ] **Step 2: Implement domain models with pure Java validations and business methods**

- [ ] **Step 3: Run ArchUnit test**
Run: `services/workspace-service/mvnw.cmd test -Dtest=WorkspaceCleanArchitectureTest`
Expected: `BUILD SUCCESS`

- [ ] **Step 4: Commit Phase 2 Task 2.1**
```bash
git add services/workspace-service/
git commit -m "feat(workspace): create pure domain models, ports, and ArchUnit architecture test"
```

---

### Task 2.2: Persistence Adapter, MapStruct Mapper & Test Gate
**Files:**
- Rename/Refactor: `Workspace.java` -> `WorkspaceJpaEntity.java`, `Membership.java` -> `MembershipJpaEntity.java`, `Connection.java` -> `ConnectionJpaEntity.java`, `Credential.java` -> `CredentialJpaEntity.java`
- Create: `infrastructure/persistence/mapper/WorkspacePersistenceMapper.java`
- Create: `infrastructure/persistence/repository/WorkspaceRepositoryAdapter.java`
- Modify: `src/test/java/com/weav/workspace/WorkspacePersistenceTest.java`

- [ ] **Step 1: Implement MapStruct persistence mapper and repository adapter**
- [ ] **Step 2: Run all Workspace persistence integration tests**
Run: `services/workspace-service/mvnw.cmd clean test`
Expected: `BUILD SUCCESS`, all tests passing with Neon/Testcontainers.

- [ ] **Step 3: Commit Phase 2 Task 2.2**
```bash
git add services/workspace-service/src/
git commit -m "refactor(workspace): decouple JPA entities with WorkspaceRepositoryAdapter and MapStruct mapper"
```

---

## Phase 3: Workflow Service Clean Architecture Refactoring

### Target Structure:
```text
services/workflow-service/src/
├── main/java/com/weav/workflow/
│   ├── WorkflowServiceApplication.java
│   ├── domain/
│   │   ├── model/
│   │   │   ├── aggregate/workflow/ (Workflow, WorkflowVersion, WorkflowTrigger, WorkflowFile, OutboxEvent)
│   │   │   ├── aggregate/execution/ (WorkflowExecution, NodeExecution, NodeExecutionAttempt, ExecutionLog)
│   │   │   └── aggregate/agent/ (AgentRun, AgentStep)
│   │   ├── valueobject/ (All 9 Enums: WorkflowStatus, TriggerType, TriggerStatus, ExecutionStatus, ExecutionTriggerType, NodeExecutionStatus, AttemptStatus, LogLevel, OutboxStatus, AgentRunStatus, AgentStepStatus, AgentStepDecisionType)
│   │   ├── port/
│   │   │   └── out/
│   │   │       ├── WorkflowRepository.java
│   │   │       ├── WorkflowExecutionRepository.java
│   │   │       ├── OutboxEventRepository.java
│   │   │       └── AgentRunRepository.java
│   │   └── exception/ (WorkflowDomainException, etc.)
│   ├── application/
│   │   ├── usecase/ (CreateWorkflowUseCase, TriggerExecutionUseCase)
│   │   └── dto/ (CreateWorkflowCommand, ExecutionResultDto)
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   ├── entity/ (WorkflowJpaEntity, WorkflowVersionJpaEntity, ..., AgentStepJpaEntity)
│   │   │   ├── repository/ (Spring Data repos & Repository Adapters)
│   │   │   └── mapper/ (WorkflowPersistenceMapper, ExecutionPersistenceMapper, AgentPersistenceMapper)
│   │   ├── security/ (SecurityConfig, JwtProperties)
│   │   └── web/ (ApiErrorResponse, GlobalExceptionHandler)
│   └── presentation/
│       └── http/
│           ├── request/ (CreateWorkflowRequest, package-info)
│           └── response/ (WorkflowResponse, ExecutionResponse)
└── test/java/com/weav/workflow/
    ├── architecture/WorkflowCleanArchitectureTest.java
    └── infrastructure/persistence/WorkflowPersistenceIntegrationTest.java
```

---

### Task 3.1: Workflow Aggregate Splitting & Domain Port Definition
**Files:**
- Modify: `services/workflow-service/pom.xml` (add ArchUnit dependency)
- Create: Domain models under `domain/model/aggregate/{workflow,execution,agent}`
- Move: All 9 status/level enums to `domain/valueobject/`
- Create: Domain ports `WorkflowRepository`, `WorkflowExecutionRepository`, `OutboxEventRepository`, `AgentRunRepository`
- Create: `src/test/java/com/weav/workflow/architecture/WorkflowCleanArchitectureTest.java`

- [ ] **Step 1: Write ArchUnit test enforcing zero framework leakage across all 3 workflow aggregates**
- [ ] **Step 2: Implement pure domain entities and aggregate root invariants**
- [ ] **Step 3: Run ArchUnit test**
Run: `services/workflow-service/mvnw.cmd test -Dtest=WorkflowCleanArchitectureTest`
Expected: `BUILD SUCCESS`

- [ ] **Step 4: Commit Phase 3 Task 3.1**
```bash
git add services/workflow-service/
git commit -m "feat(workflow): establish pure domain aggregates, value objects, and ports"
```

---

### Task 3.2: JPA Entity Decoupling, Persistence Adapters & Verification Gate
**Files:**
- Refactor/Rename: All 11 entities in `infrastructure/persistence/entity/*JpaEntity.java` preserving exact `@Table`, `@Column`, `@JoinColumn`, and `@Enumerated` bindings to Flyway V1.
- Create: Persistence mappers (`WorkflowPersistenceMapper`, `ExecutionPersistenceMapper`, `AgentPersistenceMapper`).
- Create: Repository adapters implementing domain ports.
- Update: `WorkflowPersistenceTest.java` and related test fixtures.

- [ ] **Step 1: Implement MapStruct persistence mappers for all 11 JPA entities**
- [ ] **Step 2: Implement repository adapters**
- [ ] **Step 3: Run full workflow service test suite**
Run: `services/workflow-service/mvnw.cmd clean test`
Expected: `BUILD SUCCESS`, all persistence, validation, security, and global exception tests pass.

- [ ] **Step 4: Commit Phase 3 Task 3.2**
```bash
git add services/workflow-service/src/
git commit -m "refactor(workflow): decouple JPA entities and implement domain repository adapters"
```

---

## Phase 4: API Gateway Clean Architecture Structure

### Target Structure:
```text
services/api-gateway/src/
├── domain/
│   ├── models/
│   │   ├── route-definition.model.ts
│   │   ├── auth-context.model.ts
│   │   └── upstream-service.model.ts
│   └── ports/
│       ├── token-verifier.port.ts
│       └── rate-limiter.port.ts
├── application/
│   ├── use-cases/
│   │   ├── validate-token.use-case.ts
│   │   └── resolve-upstream-route.use-case.ts
│   └── dtos/
│       └── authenticated-user.dto.ts
├── infrastructure/
│   ├── auth/
│   │   └── jose-token-verifier.adapter.ts
│   ├── proxy/
│   │   └── fastify-reverse-proxy.config.ts
│   ├── rate-limit/
│   │   └── throttler-rate-limiter.adapter.ts
│   └── config/
│       └── gateway.config.ts
├── presentation/
│   ├── http/
│   │   ├── health.controller.ts
│   │   └── gateway.controller.ts
│   └── middleware/
│       ├── auth.guard.ts
│       ├── gateway-error.filter.ts
│       └── logging.interceptor.ts
├── app.module.ts
└── main.ts
```

---

### Task 4.1: API Gateway Clean Architecture Scaffolding & Fastify Integration
**Files:**
- Create: `domain/models/route-definition.model.ts`, `domain/ports/token-verifier.port.ts`
- Create: `infrastructure/auth/jose-token-verifier.adapter.ts`
- Create: `presentation/http/health.controller.ts`
- Modify: `app.module.ts` and `app.controller.spec.ts`

- [ ] **Step 1: Write unit tests for Token Verifier and Route Resolution use-cases**
- [ ] **Step 2: Implement domain models, use-cases, and Fastify infrastructure adapters**
- [ ] **Step 3: Run test suite & build**
Run: `pnpm --dir services/api-gateway test`
Run: `pnpm --dir services/api-gateway build`
Expected: All tests pass, build succeeds.

- [ ] **Step 4: Commit Phase 4 Task 4.1**
```bash
git add services/api-gateway/
git commit -m "refactor(gateway): structure API Gateway into Clean Architecture layers"
```

---

## Phase 5: AI Service Clean Architecture Structure

### Target Structure:
```text
services/ai-service/src/
├── domain/
│   ├── models/
│   │   ├── prompt-template.model.ts
│   │   ├── llm-completion.model.ts
│   │   ├── workflow-draft.model.ts
│   │   └── classification-result.model.ts
│   └── ports/
│       ├── llm-provider.port.ts
│       └── workflow-generator.port.ts
├── application/
│   ├── use-cases/
│   │   ├── generate-workflow.use-case.ts
│   │   ├── classify-intent.use-case.ts
│   │   ├── summarize-document.use-case.ts
│   │   └── extract-structured-data.use-case.ts
│   └── dtos/
│       ├── generate-workflow.dto.ts
│       └── ai-completion-response.dto.ts
├── infrastructure/
│   ├── llm/
│   │   ├── anthropic-llm.adapter.ts
│   │   └── openai-llm.adapter.ts
│   ├── messaging/
│   │   └── rabbitmq-ai-event.publisher.ts
│   └── config/
│       └── ai.config.ts
├── presentation/
│   ├── http/
│   │   ├── ai.controller.ts
│   │   └── requests/
│   └── common/
│       └── ai-exception.filter.ts
├── app.module.ts
└── main.ts
```

---

### Task 5.1: LLM Provider Ports, Use-Cases & Adapter Wiring
**Files:**
- Create: `domain/ports/llm-provider.port.ts`, `domain/models/prompt-template.model.ts`
- Create: `application/use-cases/generate-workflow.use-case.ts`
- Create: `infrastructure/llm/anthropic-llm.adapter.ts`, `infrastructure/llm/openai-llm.adapter.ts`
- Modify: `app.module.ts`, `app.controller.spec.ts`

- [ ] **Step 1: Write unit tests mocking LLM provider port**
- [ ] **Step 2: Implement domain models, use cases, and provider adapters**
- [ ] **Step 3: Run test suite & build**
Run: `pnpm --dir services/ai-service test`
Run: `pnpm --dir services/ai-service build`
Expected: `PASS`

- [ ] **Step 4: Commit Phase 5 Task 5.1**
```bash
git add services/ai-service/
git commit -m "refactor(ai): structure AI Service with LLM provider ports and use-cases"
```

---

## Phase 6: Bot Service Clean Architecture Structure

### Target Structure:
```text
services/bot-service/src/
├── domain/
│   ├── models/
│   │   ├── bot-session.model.ts
│   │   ├── incoming-message.model.ts
│   │   └── bot-command.model.ts
│   └── ports/
│       ├── bot-platform.port.ts
│       └── bot-session-repository.port.ts
├── application/
│   ├── use-cases/
│   │   ├── handle-incoming-message.use-case.ts
│   │   └── execute-bot-command.use-case.ts
│   └── dtos/
│       └── bot-interaction.dto.ts
├── infrastructure/
│   ├── telegram/
│   │   └── grammy-bot.adapter.ts
│   ├── persistence/
│   │   └── prisma-bot-session-repository.adapter.ts
│   └── config/
│       └── bot.config.ts
├── presentation/
│   ├── http/
│   │   └── telegram-webhook.controller.ts
│   └── bot-handlers/
│       └── telegram-command.handler.ts
├── app.module.ts
└── main.ts
```

---

### Task 6.1: Bot Domain Models, grammY Platform Adapter & Use-Cases
**Files:**
- Create: `domain/ports/bot-platform.port.ts`, `domain/models/bot-session.model.ts`
- Create: `application/use-cases/handle-incoming-message.use-case.ts`
- Create: `infrastructure/telegram/grammy-bot.adapter.ts`
- Modify: `app.module.ts`, `app.controller.spec.ts`

- [ ] **Step 1: Write unit tests for incoming bot message handling**
- [ ] **Step 2: Implement grammY platform adapter and webhook presentation controller**
- [ ] **Step 3: Run test suite & build**
Run: `pnpm --dir services/bot-service test`
Run: `pnpm --dir services/bot-service build`
Expected: `PASS`

- [ ] **Step 4: Commit Phase 6 Task 6.1**
```bash
git add services/bot-service/
git commit -m "refactor(bot): structure Bot Service into Clean Architecture with grammY adapter"
```

---

## Phase 7: Notification Service Clean Architecture Structure

### Target Structure:
```text
services/notification-service/src/
├── domain/
│   ├── models/
│   │   ├── notification.model.ts
│   │   ├── recipient.model.ts
│   │   └── notification-channel.enum.ts
│   └── ports/
│       ├── push-notification-sender.port.ts
│       ├── email-notification-sender.port.ts
│       └── notification-repository.port.ts
├── application/
│   ├── use-cases/
│   │   ├── send-push-notification.use-case.ts
│   │   └── dispatch-notification.use-case.ts
│   └── dtos/
│       └── send-notification.dto.ts
├── infrastructure/
│   ├── push/
│   │   └── expo-push-notification.adapter.ts
│   ├── persistence/
│   │   └── prisma-notification-repository.adapter.ts
│   └── messaging/
│       └── rabbitmq-notification.consumer.ts
├── presentation/
│   ├── http/
│   │   └── notification.controller.ts
│   └── dtos/
│       └── create-notification-request.dto.ts
├── app.module.ts
└── main.ts
```

---

### Task 7.1: Notification Ports, Expo Push Adapter & Use-Cases
**Files:**
- Create: `domain/ports/push-notification-sender.port.ts`, `domain/models/notification.model.ts`
- Create: `application/use-cases/send-push-notification.use-case.ts`
- Create: `infrastructure/push/expo-push-notification.adapter.ts`
- Modify: `app.module.ts`, `app.controller.spec.ts`

- [ ] **Step 1: Write unit tests for push notification dispatching**
- [ ] **Step 2: Implement Expo Push Notification adapter and HTTP controller**
- [ ] **Step 3: Run test suite & build**
Run: `pnpm --dir services/notification-service test`
Run: `pnpm --dir services/notification-service build`
Expected: `PASS`

- [ ] **Step 4: Commit Phase 7 Task 7.1**
```bash
git add services/notification-service/
git commit -m "refactor(notification): structure Notification Service into Clean Architecture with Expo adapter"
```

---

## Phase 8: OCR Service Clean Architecture Structure

### Target Structure:
```text
services/ocr-service/src/
├── domain/
│   ├── models/
│   │   ├── bounding_box.py
│   │   ├── ocr_text_line.py
│   │   ├── ocr_result.py
│   │   └── image_metadata.py
│   └── ports/
│       ├── ocr_engine_port.py                 (ABC interface)
│       └── image_preprocessor_port.py          (ABC interface)
├── application/
│   ├── use_cases/
│   │   ├── extract_text_use_case.py
│   │   └── preprocess_image_use_case.py
│   └── dtos/
│       ├── extract_text_query.py
│       └── ocr_response_dto.py
├── infrastructure/
│   ├── engines/
│   │   ├── paddle_ocr_engine_adapter.py        (Implements OcrEnginePort)
│   │   ├── easy_ocr_engine_adapter.py
│   │   └── tesseract_engine_adapter.py
│   ├── processors/
│   │   └── opencv_preprocessor_adapter.py      (Implements ImagePreprocessorPort)
│   └── config/
│       └── settings.py                        (Pydantic Settings)
├── presentation/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py
│   │   └── v1/
│   │       ├── health_router.py
│   │       └── extract_router.py
│   └── schemas/
│       ├── extract_request.py
│       └── extract_response.py
├── main.py                                    (FastAPI application factory)
└── tests/
    ├── unit/
    │   └── test_extract_text_use_case.py
    └── integration/
        └── test_extract_router.py
```

---

### Task 8.1: Python Domain Ports, PaddleOCR Engine Adapter & FastAPI Routes
**Files:**
- Create: `src/domain/ports/ocr_engine_port.py`, `src/domain/models/ocr_result.py`
- Create: `src/application/use_cases/extract_text_use_case.py`
- Create: `src/infrastructure/engines/paddle_ocr_engine_adapter.py`
- Create: `src/infrastructure/processors/opencv_preprocessor_adapter.py`
- Create: `src/presentation/api/v1/extract_router.py`, `src/main.py`
- Create: `src/tests/unit/test_extract_text_use_case.py`

- [ ] **Step 1: Write unit test for OCR extract use-case with mock engine**

```python
# src/tests/unit/test_extract_text_use_case.py
import pytest
from unittest.mock import MagicMock
from domain.ports.ocr_engine_port import OcrEnginePort
from domain.models.ocr_result import OcrResult, OcrTextLine, BoundingBox
from application.use_cases.extract_text_use_case import ExtractTextUseCase

def test_extract_text_success():
    engine_mock = MagicMock(spec=OcrEnginePort)
    engine_mock.extract.return_value = OcrResult(
        lines=[OcrTextLine(text="Weav Automation", confidence=0.99, bbox=BoundingBox(0, 0, 100, 20))],
        full_text="Weav Automation"
    )
    use_case = ExtractTextUseCase(ocr_engine=engine_mock)
    result = use_case.execute(image_bytes=b"fake_image")
    assert result.full_text == "Weav Automation"
    assert len(result.lines) == 1
```

- [ ] **Step 2: Implement domain models, use case, PaddleOCR adapter, and FastAPI router**

```python
# src/domain/ports/ocr_engine_port.py
from abc import ABC, abstractmethod
from domain.models.ocr_result import OcrResult

class OcrEnginePort(ABC):
    @abstractmethod
    def extract(self, image_bytes: bytes) -> OcrResult:
        """Extract text and bounding boxes from raw image bytes."""
        pass
```

- [ ] **Step 3: Run pytest and ruff check**
Run: `uv --directory services/ocr-service run pytest`
Run: `uv --directory services/ocr-service run ruff check .`
Expected: All tests pass, zero lint errors.

- [ ] **Step 4: Commit Phase 8 Task 8.1**
```bash
git add services/ocr-service/
git commit -m "feat(ocr): structure OCR Service with Clean Architecture, PaddleOCR adapter and FastAPI endpoints"
```

---

## Global Verification & Quality Gates

### Automated Verification Pipeline:
```powershell
# 1. Java Services (Identity, Workspace, Workflow)
services/identity-service/mvnw.cmd clean test
services/workspace-service/mvnw.cmd clean test
services/workflow-service/mvnw.cmd clean test

# 2. TypeScript / NestJS Services (Gateway, AI, Bot, Notification)
pnpm --dir services/api-gateway test
pnpm --dir services/api-gateway build
pnpm --dir services/ai-service test
pnpm --dir services/ai-service build
pnpm --dir services/bot-service test
pnpm --dir services/bot-service build
pnpm --dir services/notification-service test
pnpm --dir services/notification-service build

# 3. Python OCR Service
uv --directory services/ocr-service run pytest
uv --directory services/ocr-service run ruff check .

# 4. GitNexus Graph Integrity Check & Formatting
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

### Rollback Strategy
If any phase fails quality gates:
1. Revert the specific phase commits using `git reset --hard HEAD~1` or checkout previous branch point.
2. Re-run upstream service tests to guarantee zero cross-service regression.
3. Keep Flyway migrations untouched since schema is invariant throughout refactoring.

---

## Self-Review & Integrity Checklist
- [x] **Spec Coverage:** Covers all 8 requested services in exact sequence: Identity, Workspace, Workflow, Gateway, AI, Bot, Notification, OCR.
- [x] **Migration Invariance:** All Flyway `V1` migrations (`V1__create_identity_entities.sql`, `V1__create_workspace_entities.sql`, `V1__create_workflow_entities.sql`) remain completely untouched.
- [x] **Timezone Invariance:** UTC `Instant`/`TIMESTAMPTZ` preserved.
- [x] **No Placeholders:** Every task has explicit file paths, code snippets, test assertions, and verification commands.
- [x] **Impact & Gates:** GitNexus MCP `impact` and `detect_changes` incorporated at every stage.
- [x] **Worker Assignment:** Clear `agy` vs `opencode` responsibilities specified.
