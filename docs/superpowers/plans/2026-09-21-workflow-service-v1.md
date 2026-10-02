# Workflow Service V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the workspace-authorized Workflow V1 authoring and execution backend, real supported integrations, and explicit failure/readiness behavior for integrations whose contracts are not ready.

**Architecture:** Keep the existing `domain/application/infrastructure/presentation` boundary. PostgreSQL owns immutable versions, execution/node/attempt state, trigger registrations, and transactional outbox records; RabbitMQ delivers whole execution IDs to workers that coordinate a DAG in-process. Workspace remains authoritative for capabilities and credentials; external adapters receive credentials only for the duration of a call.

**Tech Stack:** Verified repository baseline: Java 25, Spring Boot 4.1.0, Jackson 3 (`tools.jackson`), PostgreSQL/Flyway/JPA, Spring AMQP/RabbitMQ, ArchUnit 1.5.0, JUnit/Testcontainers; NestJS/Fastify Gateway; React/Vite catalog and Playwright; pnpm 11.22.0. Use existing dependency management and wrappers.

**Spec:** [Workflow Service V1 specification](../specs/workflow-service-spec.md). Read the complete spec before executing any task.

**Scope update, 2026-09-23:** Gateway integration (Task 19) is owned by the user's partner and is excluded from this branch's delivery and completion claim. Task 21's local live acceptance runs against Workflow Service directly; the partner will verify Gateway forwarding separately. The Task 19 details below remain a handoff contract, not work assigned to this implementation.

## Global Constraints

- PostgreSQL schema: `workflow`. UUID identifiers. Persist instants as UTC `TIMESTAMPTZ`.
- Preserve `V1__create_workflow_entities.sql`; all schema changes are additive migrations. Preserve agent/file tables and existing data.
- Domain code has no Spring, JPA, HTTP, broker, or Jackson dependencies. Retain existing domain repository ports; add application ports only at real boundaries.
- Executable definitions use `schemaVersion: "1.0"`; editor coordinates belong to `editor_state`.
- Each definition has exactly one `trigger.manual`; only the firing trigger root is active in an execution.
- Workflow states are `DRAFT`, `PUBLISHED`, `PAUSED`. Execution states are `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`.
- Node states are `PENDING`, `READY`, `RUNNING`, `WAITING`, `SUCCESS`, `FAILED`, `SKIPPED`, `CANCELLED`. Do not introduce a V1 cancellation/resume API or asynchronous WAITING integration.
- RabbitMQ carries whole execution jobs, not node jobs. PostgreSQL is authoritative; Redis is not the execution queue.
- Default `maxAttempts=3` total: initial attempt plus two retries. Retry delays are 1 second, then 2 seconds; no delay after the last attempt.
- Six-field Spring cron with required IANA timezone; UI default `Asia/Ho_Chi_Minh`.
- Public caller identity comes only from the authenticated access-token principal. Workspace calls use `X-Internal-Service-Key`.
- Connection usage response is exactly `{ "inUse": boolean }`; preserve `401`, `429`, `500` and Workspace's fail-closed handling of failures. **User clarification, 2026-09-21:** no references means `200 {"inUse":false}`, without a Workspace lookup. Clarify the shared contract to retire its unimplementable unknown-connection 404 rule; this decision supersedes that part of spec section 8.
- **User clarification, 2026-09-21:** all stored immutable versions count toward connection usage, including versions belonging to soft-deleted workflows. Exclude only soft-deleted drafts.
- Provider secrets stay in Workspace. No resolved secrets in definitions, variables, persisted input/output, attempts, outbox, logs, or HTTP responses.
- Webhook secrets are stored only as hashes; `X-Webhook-Secret` comparison is constant-time. Missing/invalid secret and unknown endpoint use generic `404 WEBHOOK_NOT_FOUND`.
- OCR uses asymmetric service JWTs: `iss=weav-workflow`, `aud=weav-ocr`, `scope=ocr:extract`, `workspace_id`, `mode=execution`, `execution_id`, `node_execution_id`, TTL at most 120 seconds; required UUID `X-Request-ID`, optional `traceparent`.
- No invented AI/Bot routes, payloads, providers, credentials, or auth contracts. Unconfigured action adapters return `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`.
- Exclude `agent.task`, `google.docs`, loops, arbitrary code/JavaScript, human approvals, Gmail scope expansion, and direct Telegram public webhooks.
- **User execution override:** implement directly in `T:\Weav` on `feature/workflow-service`; do not create a worktree. Assign ownership before any parallel writes. One Luna MAX worker starts Task 1; the coordinator reviews before advancing.
- Run GitNexus upstream impact before each existing-symbol edit; report HIGH/CRITICAL risks, corroborate UNKNOWN with source. Run complete, non-partial change detection before milestone commits. Do not push automatically.
- Stop immediately on `helper_unknown_error: setup refresh had errors`; do not retry or work around that error.

## Review Focus

These are concrete failure cases that the implementation must test, beyond the spec's happy paths.

1. Nested JSON nulls and mutable maps must survive persistence and cannot mutate an already-published snapshot: Tasks 1, 5, 6.
2. Concurrent publish, pause, admission, and schedule ticks must produce one coherent current version/trigger decision, without duplicate scheduled slots: Tasks 6, 8, 16.
3. Worker death between provider success and persistence, or during backoff, must not replay recorded successes or reset attempt budgets: Tasks 10, 11, 21. External effects in the uncertainty window remain at-least-once.
4. A merge fed by multiple trigger roots and nested conditions must wait for all active predecessors, ignore inactive ones, and run once: Tasks 9, 11.
5. Malicious URLs and providers echoing tokens must not bypass DNS validation or leak credentials through outputs, exceptions, database logs, or monitoring: Tasks 13, 14, 18, 21.

## Verified starting point and scope

- Inspected `dev` at `c836de239fe09907a9db11e953f2f3e9588b1e3d`. The spec names `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`; `git diff --stat <spec-baseline> HEAD` shows documentation/guidance changes only, so the runtime source baseline matches.
- The supplied spec was already untracked. Preserve it; do not replace or silently stage it.
- Workflow's use-case, DTO/response, persistence-adapter/mapper, and architecture-test files include empty scaffolds. JPA entities and the V1 schema exist; implemented business HTTP endpoints do not.
- `Workflow.publish(Instant)` currently always changes status to PUBLISHED, does not select a version, and does not preserve PAUSED. Domain JSON copying is shallow and `Map.copyOf` rejects JSON null values. `WorkflowExecution` omits `triggerId` even though the table/entity has it.
- `SecurityConfig` uses HTTP Basic and has `/auth/**` as a public matcher. JWT properties are not proof of access-token verification. Complete the actual resource-server path.
- Existing test foundations: `WorkflowPersistenceTest`, `SecurityConfigTest`, `WorkflowServiceApplicationTests`, `CreateWorkflowRequestValidationTest`, `GlobalExceptionHandlerTest`, and PostgreSQL/RabbitMQ `TestcontainersConfiguration`. Empty test files do not count as coverage.
- GitNexus planning queries/context/impact used repo `Weav`. Upstream impact reported LOW for `Workflow` (caller `createNew`) and `WorkflowExecution` (caller `queue`), one caller each and zero resolved processes. The index is three commits behind at `4aad0ce`; those commits are documentation-only, but these narrow graph results are not full integration assurance. Refresh was attempted: sandbox runner hit EPERM, elevated analyzer stalled at its banner and was stopped. Refresh and re-run impacts in the implementation worktree; source inspection supplies the planning baseline.
- Read current `docs/work_logs/T/2026-09-02.md`, `docs/work_logs/K/workspace-core-v1.md`, the consolidated Workspace connection logs, the root `AGENTS.md`, and `docs/work_logs/log_template.md` at execution start.
- This is one coordinated service plan because authoring, versioning, admission, and recovery share transactions and state invariants. Gateway and catalog work are bounded integration lanes; OCR-service hardening and artifact/Bot/AI/provider contract design remain separately owned prerequisites.
- The web change here is catalog/configuration compatibility requested by the spec. Replacing the current local-storage Workflow UI with complete backend-driven authoring/monitoring is a separate product scope; do not silently add it.

## Planning decisions and integration gates

These are proposed implementation choices, not claims that the spec already defines them. Keep them visible in contract review.

| Decision | Implementation choice and consequence |
| --- | --- |
| Publish while paused | Persist the new immutable version and its disabled registrations; return actual status PAUSED. The spec's PUBLISHED response example applies to a non-paused publish. |
| Draft validation | Enforce envelope/JSON types, unique IDs, bounds, and authorization of literal connection references at save. Defer graph reachability, complete node config, and mapping semantics to publish. |
| Connection references | `config.connectionId` is a literal UUID, never a mapping expression. Runtime context supplies workspace/user identity. |
| Usage knowledge | User-approved: absence of references returns 200 false, including connections/workspaces never previously observed by Workflow. Workflow answers only its own usage question; Workspace owns existence/ownership checks. No local connection-existence registry or outbound lookup is needed. |
| Webhook republish | Each newly published webhook registration gets a new key/secret and disables the prior registration. Return newly generated secrets once, including when provisioning a paused version. Document that old URLs stop accepting events. No read/rotation endpoint is added. |
| Telegram readiness | Validate/save/publish its node identity, retain a DISABLED registration with a sanitized dependency reason, and expose readiness with workflow detail. Only the application ingress port exists until a Bot contract is approved. Manual execution still works. |
| Unconfigured action nodes | Valid configuration can be published. Execution fails explicitly at that node with the non-retryable dependency error. No mock success. |
| Schedule downtime | V1 coalesces missed ticks: enqueue one recorded due instant, then advance to the first cron occurrence strictly after the scan time. Resume starts at the next future occurrence; do not replay paused slots. Record this operational policy in README. |
| Limits | Configurable initial limits: 1 MiB request/definition/input body, 200 nodes, 1,000 edges, JSON depth 32, page size 20/max 100, four ready nodes per execution, two executions per instance. Outbound response max 1 MiB, connect timeout 5s, call timeout 30s. Validate positive bounded settings; measure before increasing. |
| Worker ownership | PostgreSQL lease with monotonically increasing fencing token; 60s lease, renew every 15s. No long DB transaction surrounds a provider call. Expired owners stop dispatching and cannot commit results. Fencing cannot undo an external request already sent. |
| HTTP output | Canonical output is `{ "status": 200, "data": <JSON-or-text> }`; the spec's `nodes.http1.output.body` illustrates mapping syntax only. Use `.data` in new catalog examples and contract fixtures. |
| Public pagination | Add optional `page` (zero-based) and `size`; stable `createdAt DESC, id DESC`; return `items`, `page`, `size`, `totalElements`. No unbounded list or caller-selected SQL sort. |

**Production gates:** URL OCR requires verified OCR signature/claim enforcement plus existing URL allowlist compliance. Artifact OCR additionally requires an approved descriptor/download contract. Gmail send, AI nodes, Telegram sending/ingress remain dependency failures until their contracts and real adapters are separately approved. Passing this plan's disabled-adapter tests does not establish those integrations as operational.

## File and ownership map

All paths below are repository-relative. In task file lists, `M` means `services/workflow-service/src/main/java/com/weav/workflow`, `T` means `services/workflow-service/src/test/java/com/weav/workflow`, and `R` means `services/workflow-service/src/main/resources`. These are exact prefix substitutions, not search patterns. Nested records/interfaces named below live in their owning Java file unless a separate path is listed.

| Owner / tasks | Files and responsibility |
| --- | --- |
| Domain, 1–3 and 9 | `M/domain/definition/`, `M/domain/mapping/`, `M/domain/execution/`: immutable JSON, typed graph/catalog, validation, mapping, readiness, retry policy. |
| Authoring, 4–8 | Existing `M/domain/model/aggregate/workflow/`, repository ports; new `M/application/service/`, `M/application/port/out/`, `M/presentation/http/`: authorization, draft lifecycle, versions, triggers, usage, durable admission. |
| Runtime, 10–12 | Existing execution aggregates and entities; `M/application/execution/`, `M/infrastructure/messaging/`, `M/infrastructure/persistence/`: claims, attempts, engine coordination, queries. |
| External adapters, 13–15 and 18 | `M/infrastructure/http/`, `M/infrastructure/sheets/`, `M/infrastructure/ocr/`, `M/application/node/`: controlled provider I/O and explicit dependency failures. |
| Triggers, 16–17 | `M/infrastructure/scheduling/`, `M/application/trigger/`, webhook presentation/security. |
| Partner-owned Gateway, 19 | Only Gateway source/tests, its contract, and Gateway-specific config; excluded from this branch's delivery. |
| Web catalog, 20 | Node catalog/types and affected config/handle rendering; Playwright compatibility tests. |
| Integrator, 21 | Root Compose/templates, final README/runbook, regression tests, work log. Assign `pom.xml`, migrations, security configuration, and shared ports to one owner at a time. |

## Task dependencies and milestones

```text
1 -> 2 -> 3
1 + 4 -> 5; 2 + 3 + 5 -> 6; 4 + 5 + 6 -> 7
6 -> 8; 2 + 3 -> 9; 8 + 9 -> 10 -> 11 -> 12
4 + 11 -> 13 -> 14; 2 + 11 -> 15
6 + 8 + 11 -> 16 and 17
11 + 13 -> 18 (production activation additionally requires the OCR enforcement gate)
4 + 6 + 12 + 17 -> 19; 2 + 3 -> 20
7 + 12 through 20 -> 21
```

- **M1, Tasks 1–7:** authorized authoring/versioning and authoritative connection usage.
- **M2, Tasks 8–12:** durable manual executions, branching, retries, recovery, monitoring.
- **M3, Tasks 13–17:** supported HTTP/Sheets actions, explicit unsupported adapters, schedule and webhook.
- **M4, Tasks 18–21:** gated OCR adapter, Gateway/catalog alignment, real-stack acceptance and handoff.
- Read-only investigation may run in parallel. Implementation lanes require worktrees, stable shared interfaces, individual review, and integration tests before merging. Do not parallelize tasks that share migrations, entities, security config, or transaction invariants.

## Verification conventions

For every Java task below, run its named test first and confirm a meaningful failure, implement the listed behavior, then rerun that test. A compile failure is acceptable only for a genuinely new type; after adding the type, demonstrate the behavior assertion fails before implementing it. Use real PostgreSQL/RabbitMQ Testcontainers for storage/broker claims; test doubles are appropriate for capability and provider protocol unit tests, not final integration evidence.

From `services/workflow-service` in PowerShell:

```powershell
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
.\mvnw.cmd '-Dstyle.color=never' '-Dtest=JsonValuesTest' test
.\mvnw.cmd '-Dstyle.color=never' test
.\mvnw.cmd '-Dstyle.color=never' verify
```

Replace only the `-Dtest` value with the exact class listed in a task. Do not use `--runInBand` with Maven. The existing POM uses Surefire; name runnable integration tests `*Test`, or deliberately configure Failsafe in the task that introduces it. Confirm Docker access before interpreting Testcontainers failures. No service tests or runtime claims were made during plan authoring.

Every task ends with diff review, its focused tests, an updated member work log, and `git diff --check`. At each completed milestone, run full affected suites, stage only that milestone's owned files, run GitNexus `detect_changes(scope=all)` against the actual worktree, resolve partial/truncated/UNKNOWN results, and commit with summary and description. No push. Do not stage the entire repository.

---

### Task 1: Preserve JSON values and enforce the domain boundary

**Files:** Create `M/domain/definition/JsonValues.java`; modify existing `Workflow.java`, `WorkflowVersion.java`, `WorkflowTrigger.java`, `WorkflowExecution.java`, `NodeExecution.java`, `NodeExecutionAttempt.java`, `ExecutionLog.java`, `OutboxEvent.java` under their existing aggregate directories only where JSON copying changes; fill `T/architecture/WorkflowCleanArchitectureTest.java`; create `T/domain/definition/JsonValuesTest.java`.

**Interfaces:** `JsonValues.freeze(Object) -> Object` and `JsonValues.freezeMap(Map<String,Object>) -> Map<String,Object>` recursively return unmodifiable JSON trees, preserving null, booleans, strings, numbers, lists, and string-keyed objects. Reject other Java types; do not stringify them.

- [ ] Add the null/mutation regression before changing the aggregates:

```java
@Test void freezesNestedJsonWithoutLosingNull() {
    var nested = new java.util.LinkedHashMap<String, Object>();
    nested.put("value", null);
    var source = new java.util.LinkedHashMap<String, Object>();
    source.put("nested", nested);
    var frozen = JsonValues.freezeMap(source);
    nested.put("value", "changed");
    assertTrue(((Map<?, ?>) frozen.get("nested")).containsKey("value"));
    assertNull(((Map<?, ?>) frozen.get("nested")).get("value"));
    assertThrows(UnsupportedOperationException.class, () -> frozen.put("x", 1));
}
```

- [ ] Run `-Dtest=JsonValuesTest`; confirm the failure.
- [ ] Implement recursive copying with `LinkedHashMap`, `ArrayList`, `Collections.unmodifiableMap/List`; use `freezeMap` instead of shallow `Map.copyOf` on affected JSON. Keep optional absent JSON containers consistent with existing getters.

```java
if (value instanceof Map<?, ?> map) {
    var copy = new java.util.LinkedHashMap<String, Object>();
    map.forEach((key, item) -> {
        if (!(key instanceof String)) throw new IllegalArgumentException("JSON object key");
        copy.put((String) key, freeze(item));
    });
    return java.util.Collections.unmodifiableMap(copy);
}
```

- [ ] Add ArchUnit rules forbidding domain dependencies on `org.springframework..`, `jakarta.persistence..`, `org.hibernate..`, `tools.jackson..`, `com.rabbitmq..`, and HTTP packages; prohibit application imports of infrastructure/presentation.
- [ ] Run `JsonValuesTest,WorkflowCleanArchitectureTest,WorkflowPersistenceTest`; include a JSONB round trip with nested null. Review/record this independently testable change.

### Task 2: Define the executable graph and complete V1 catalog validation

**Coordinator clarification before implementation:** Draft validation permits unfinished node configuration and mappings; enforce structural shape, bounds, unique IDs and credential safety on drafts. Complete configuration, graph semantics and mapping grammar are publish checks. Task 2 owns pure validation and sanitized diagnostic tests; Task 5 owns proof that rejected drafts never reach persistence. JSON Schema describes the draft envelope and catalog/config shapes without requiring publish-complete fields; Java additionally enforces graph semantics and limits. Include optional literal UUID `http.request.connectionId` and required literal UUID for Sheets; neither accepts mappings. Keep removed catalog types rejected, condition ports restricted to `true|false`, and credential-field/header checks case-insensitive without echoing values. Task 3 supplies the full mapping parser and static upstream checks; do not implement a second parser in Task 2.

**Files:** Create `M/domain/definition/WorkflowDefinition.java`, `DefinitionValidator.java`, `NodeCatalog.java`, `ValidationIssue.java`; create `M/infrastructure/definition/DefinitionJsonCodec.java`; create `T/domain/definition/DefinitionValidatorTest.java`, `T/infrastructure/definition/DefinitionJsonCodecTest.java`; create `packages/contracts/http/workflow/definition.schema.json`.

**Interfaces:** `WorkflowDefinition(String schemaVersion,List<Node> nodes,List<Edge> edges,Map<String,Object> variables)` contains `Node(String id,String type,Map<String,Object> config)` and `Edge(String id,String source,String target,String sourcePort)`. `DefinitionValidator.validateDraft/validatePublish(WorkflowDefinition) -> List<ValidationIssue>`; `ValidationIssue(String nodeId,String field,String code,String message)`. Codec maps Jackson JSON to these pure types; never expose JPA entities.

`DefinitionJsonCodec.decode(tools.jackson.databind.JsonNode) -> WorkflowDefinition` and `encode(WorkflowDefinition) -> tools.jackson.databind.JsonNode` are infrastructure-only signatures. Freeze record lists/config/variables on construction. The public no-argument DefinitionValidator is sufficient for non-schedule unit tests; application wiring uses its `DefinitionValidator(ScheduleValidation)` constructor and the real Task 16 implementation when schedules are enabled.

- [ ] Write parameterized invalid graph cases: duplicate node/edge IDs, dangling edge, cycle, unreachable action, incoming trigger edge, zero/two manual roots, unknown node type, unknown source port, invalid schema version, and size/depth limits.

```java
@Test void rejectsRemovedCatalogTypes() {
    var graph = new WorkflowDefinition("1.0", List.of(
        new WorkflowDefinition.Node("m", "trigger.manual", Map.of()),
        new WorkflowDefinition.Node("a", "agent.task", Map.of())),
        List.of(new WorkflowDefinition.Edge("e", "m", "a", null)), Map.of());
    assertTrue(new DefinitionValidator().validatePublish(graph).stream()
        .anyMatch(i -> i.nodeId().equals("a") && i.code().equals("UNKNOWN_NODE_TYPE")));
}
```

- [ ] Run `DefinitionValidatorTest,DefinitionJsonCodecTest` and observe failures.
- [ ] Implement Kahn topological sorting and reverse reachability. Draft shape permits unfinished semantic configuration; publish enforces all graph/config rules. Use an explicit catalog whitelist:

```java
Set<String> types = Set.of("trigger.manual", "trigger.schedule", "trigger.webhook",
    "trigger.telegram", "http.request", "email.send", "google.sheets",
    "telegram.send_message", "logic.condition", "ai.extract", "ai.classify",
    "ai.summarize", "ocr.extract");
Set<String> conditionOperators = Set.of("eq", "ne", "gt", "gte", "lt", "lte");
```

- [ ] Encode each spec node schema: HTTP method/url/headers/query/body; typed email recipients/subject/body; Sheets literal connection UUID, operation `read|append|update`, spreadsheetId/range, values for writes; Telegram chatId/text; condition left/operator/right; AI text/content/inputText plus their optional fields; OCR exactly one artifactId/fileUrl plus language/detectTables; schedule cron/timezone. Validate literal fields immediately; mapped fields must match grammar now and be type-checked after resolution. Require true/false ports only on condition source edges. Do not create provider-specific fields absent from the spec.
- [ ] Include a draft-save security check before persistence: reject inline credential configuration, including Authorization/Cookie/X-API-Key headers, provider token/password fields, and URL userinfo. Runtime credentials come from Workspace connection references. Test that a rejected credential-bearing draft leaves neither its definition nor its rejected values in database/error logs. Validation diagnostics identify only the field and reason, never the rejected value.
- [ ] Inject a schedule-validation boundary from infrastructure when full publish validation needs Spring `CronExpression`; domain must not import Spring. Define it as nested `DefinitionValidator.ScheduleValidation` with `List<ValidationIssue> validate(String nodeId,String cron,String timezone)` and supply its implementation in Task 16; before then publish rejects unavailable schedule validation explicitly.
- [ ] Run the focused tests and schema fixtures. Confirm all 13 supported types are represented and both excluded types are rejected.

### Task 3: Implement safe mapping with static upstream validation

**Files:** Create `M/domain/mapping/MappingResolver.java`, `MappingContext.java`, `MappingException.java`; modify `DefinitionValidator.java`; create `T/domain/mapping/MappingResolverTest.java`.

**Interfaces:** `MappingContext(Object triggerInput,Map<String,Object> outputs,Map<String,Object> variables)`; `MappingResolver.resolve(Object value,MappingContext context) -> Object`; `references(Object value) -> Set<String>` returns node IDs referenced by mappings. `MappingException` carries node/field context and stable `MAPPING_ERROR`, always non-retryable.

- [ ] Write type-preservation, scalar interpolation, recursive list/object, explicit null versus missing property, unknown/non-upstream node, unavailable branch output, and forbidden grammar tests.

```java
@Test void preservesWholeExpressionType() {
    var context = new MappingContext(Map.of("count", 3), Map.of(), Map.of());
    assertEquals(3, new MappingResolver().resolve("{{ trigger.input.count }}", context));
    assertEquals("count=3", new MappingResolver().resolve("count={{ trigger.input.count }}", context));
    assertThrows(MappingException.class,
        () -> new MappingResolver().resolve("{{ trigger.input.missing }}", context));
}
```

- [ ] Run `MappingResolverTest`; observe failure.
- [ ] Parse only `trigger.input[.path]`, `nodes.<nodeId>.output[.path]`, and `variables[.path]` in `{{ ... }}`. Split object path segments; check `containsKey` before `get`. Reject brackets, function calls, operators, malformed/unmatched template delimiters, and traversal through non-objects. No array indexing or JavaScript evaluation.

```java
if (!(current instanceof Map<?, ?> object) || !object.containsKey(segment)) {
    throw new MappingException("MAPPING_ERROR", "Referenced property is unavailable");
}
current = object.get(segment); // An existing JSON null is distinct from absence.
```

- [ ] Resolve a single-expression string to the original frozen value; embedded values permit strings/numbers/booleans/null (`null` text), and reject arrays/objects. Resolve recursively. Numeric comparison later uses numeric value, not Java wrapper class equality.
- [ ] Add publish-time reachability checks for every referenced node. Runtime additionally requires a SUCCESS upstream output on the firing root's active path. Never fill absent data with empty strings.
- [ ] Run mapping/definition tests and record the fixture contract.

### Task 4: Authenticate callers and consume authoritative Workspace access

**Files:** Modify `M/infrastructure/security/SecurityConfig.java`, `JwtProperties.java`, `M/infrastructure/web/GlobalExceptionHandler.java`, `R/application.properties`; create `M/application/port/out/WorkspaceAccessPort.java`, `WorkspaceConnectionPort.java`, `M/application/service/WorkspaceAuthorization.java`, `M/infrastructure/workspace/WorkspaceClient.java`, `WorkspaceClientProperties.java`, `M/infrastructure/security/InternalServiceKeyFilter.java`, `M/infrastructure/web/CorrelationIdFilter.java`; create `T/infrastructure/workspace/WorkspaceClientTest.java`, `T/presentation/http/WorkflowSecurityTest.java`; update existing `T/SecurityConfigTest.java`.

**Interfaces:** `WorkspaceAccessPort.getAccess(UUID workspaceId,UUID userId) -> Access(UUID workspaceId,UUID userId,String role,Set<String> capabilities)`, matching Workspace's actual response. `WorkspaceAuthorization.require(UUID workspaceId,UUID userId,String capability) -> void`. `WorkspaceConnectionPort.authorizeAttachment(UUID workspaceId,UUID connectionId,UUID userId) -> void`, `resolve(UUID workspaceId,UUID connectionId) -> ResolvedConnection`, `reportAuthenticationRejected(UUID workspaceId,UUID connectionId) -> void`. Define `ResolvedConnection` as a non-record, non-serializable closeable holder of `provider`, `authType`, and `auth` with redacted `toString`; `auth` contains the documented `accessToken`, `token`, `apiKey`, `username/password`, or no fields for NONE. Never expect a refresh token. Close discards references; do not claim Java Strings can be reliably zeroed.

- [ ] Test valid access JWT, malformed subject UUID, wrong signature, expired token, refresh token, missing bearer, client-supplied actor, capability denial, owner access, unknown future capability, missing internal key, and key-only access to public routes. Test Workspace timeout/malformed access JSON denies access.

```java
@Test void editCapabilityDoesNotGrantPublish() {
    WorkspaceAccessPort access = (workspace, user) ->
        new WorkspaceAccessPort.Access(workspace, user, "MEMBER", Set.of("WORKFLOW_EDIT"));
    assertThrows(ForbiddenException.class, () ->
        new WorkspaceAuthorization(access).require(UUID.randomUUID(), UUID.randomUUID(), "WORKFLOW_PUBLISH"));
}
```

- [ ] Run `WorkflowSecurityTest,WorkspaceClientTest` first.
- [ ] Adapt the existing Workspace resource-server verifier/filter conventions, including actual access-token claims and standard security error envelope. Public Workflow routes require JWT; internal usage requires the service key independently; webhook bypasses JWT only for its exact method/path and authenticates in Task 17. Disable HTTP Basic. Remove the scaffold-only `/auth/**` exemption; update its scaffold test to require authentication, since Workflow owns no auth routes.
- [ ] Implement the four documented Workspace operations with `X-Internal-Service-Key`, bounded timeout, correlation propagation, and strict response validation. Verify access response workspaceId/userId match the requested values and the required capability is present; owners receive the full capability set from Workspace. Reject malformed/denied access, attachment authorization, missing fields, or service failure. Attachment authorization does not imply an ACTIVE connection; runtime resolve checks ACTIVE. Resolve has no request body and returns `Cache-Control: no-store`. Match confirmed credential rejection to `{"failureCode":"AUTHENTICATION_REJECTED"}` only. No credential cache or additional Workflow access cache; Workspace itself documents a possible PT5M stale bound after failed eviction.
- [ ] Map capabilities exactly: reads `WORKSPACE_VIEW`; create `WORKFLOW_CREATE`; save `WORKFLOW_EDIT`; publish `WORKFLOW_PUBLISH`; run `WORKFLOW_RUN`; monitor `WORKFLOW_MONITOR`; pause/resume `WORKFLOW_MANAGE_STATE`. Do not derive a local role policy.
- [ ] Test correlation/error output contains no keys, tokens, raw downstream responses, or request bodies. Reuse the structured error body even for exceptions before controllers. Run focused tests and existing security/error regressions.

### Task 5: Implement workspace-scoped draft creation, editing, and reads

**Files:** Fill `M/application/usecase/CreateWorkflowUseCase.java`, `M/application/dto/CreateWorkflowCommand.java`, `M/presentation/http/request/CreateWorkflowRequest.java`, `M/presentation/http/response/WorkflowResponse.java`, `M/infrastructure/persistence/mapper/WorkflowPersistenceMapper.java`, `M/infrastructure/persistence/repository/WorkflowRepositoryAdapter.java`; modify `M/domain/port/out/WorkflowRepository.java`, aggregate `Workflow.java`, `WorkflowJpaEntity.java`; create `M/application/service/WorkflowDraftService.java`, `M/presentation/http/WorkflowController.java`, `M/presentation/http/request/SaveWorkflowDraftRequest.java`, `T/presentation/http/WorkflowDraftHttpTest.java`, `T/infrastructure/persistence/WorkflowDraftPersistenceTest.java`.

**Interfaces:** `CreateWorkflowCommand(UUID workspaceId,UUID actorId,String name,String description)`. `WorkflowDraftService.create(CreateWorkflowCommand) -> Workflow`; `save(UUID workspaceId,UUID workflowId,UUID actorId,String name,String description,WorkflowDefinition definition,Map<String,Object> editorState) -> Workflow`; `get(UUID workspaceId,UUID workflowId,UUID actorId) -> Workflow`; `list(UUID workspaceId,UUID actorId,int page,int size) -> WorkflowPage`. Define `WorkflowPage(List<Workflow> items,int page,int size,long totalElements)` nested in this service. Add `WorkflowRepository.findByWorkspaceAndId(UUID workspaceId,UUID workflowId) -> Optional<Workflow>`, `findPage(UUID workspaceId,int page,int size) -> List<Workflow>`, `countByWorkspace(UUID workspaceId) -> long` and transaction-local `lockByWorkspaceAndId(UUID workspaceId,UUID workflowId) -> Optional<Workflow>`.

- [ ] Add real HTTP/PostgreSQL tests for create seeded manual root, create description, edit draft, list pagination, cross-workspace IDs, deleted rows, invalid body, and missing capability. Explicitly verify creation does not require callers to send schemaVersion/draftDefinition/editorState.

```java
mockMvc.perform(post("/workspaces/{workspaceId}/workflows", workspaceId)
    .with(jwt().jwt(j -> j.subject(actorId.toString())))
    .contentType("application/json").content("{\"name\":\"Daily report\",\"description\":\"Team\"}"))
    .andExpect(status().isCreated())
    .andExpect(jsonPath("status").value("DRAFT"));
```

- [ ] Run `WorkflowDraftHttpTest,WorkflowDraftPersistenceTest` and confirm missing behavior.
- [ ] Implement server-seeded `schemaVersion=1.0`, one node `{id:"manual",type:"trigger.manual",config:{}}`, empty edges/variables. Save editor state separately; basic validation permits unfinished publish semantics. Authorize every literal `config.connectionId` before saving.
- [ ] Implement JPA mappings that preserve domain IDs/timestamps and nested nulls; existing entity constructors generate IDs, so add an explicit restore/mapping path rather than generating a second ID during save. Keep queries workspace-scoped and exclude deleted drafts.
- [ ] Serialize save operations with a workflow row lock; include the connection-reference projection hook used by Task 7 in the same transaction. Use frozen definitions so edits cannot mutate published versions. Test two concurrent writes give coherent complete drafts, not mixed metadata/definition.
- [ ] Update the existing CreateWorkflowRequest validation test to the actual public create contract; run focused tests and `WorkflowPersistenceTest`.

### Task 6: Publish immutable versions and manage workflow/trigger state atomically

**Files:** Create `M/application/service/WorkflowPublicationService.java`, `M/application/port/out/WorkflowVersionPort.java`, `WorkflowTriggerPort.java`, `M/infrastructure/persistence/repository/WorkflowVersionAdapter.java`, `WorkflowTriggerAdapter.java`, `T/application/WorkflowPublicationTest.java`, `T/infrastructure/persistence/WorkflowPublicationConcurrencyTest.java`; modify workflow/version/trigger aggregates and entities, `WorkflowController.java`, `WorkflowResponse.java`, `WorkflowPersistenceMapper.java`.

**Interfaces:** `WorkflowPublicationService.publish(UUID workspaceId,UUID workflowId,UUID actorId) -> Publication(UUID workflowId,UUID versionId,int version,WorkflowStatus status,List<WebhookProvisioning> webhooks)`; `pause/resume(UUID workspaceId,UUID workflowId,UUID actorId) -> Workflow`. `WebhookProvisioning(UUID triggerId,String endpointKey,String secret)` is response-only and has redacted string rendering. `WorkflowVersionPort.nextNumber(UUID workflowId)`, `insert(WorkflowVersion)`, `require(UUID versionId)`; `WorkflowTriggerPort.replaceCurrent(UUID workflowId,UUID versionId,List<WorkflowTrigger>)`, `find(UUID triggerId)`, `setCurrentEnabled(UUID workflowId,UUID versionId,boolean)`.

- [ ] Test immutable snapshot after draft mutation, publication rollback, version numbering under concurrent publishes, failed connection authorization, publish while PAUSED, pause DRAFT error, resume with no published version error, and old queued execution version pinning.

```java
// Use two transactions synchronized by CountDownLatch in the integration test.
assertEquals(2, versions.size());
assertEquals(List.of(1, 2), versions.stream().map(WorkflowVersion::getVersionNumber).sorted().toList());
assertEquals(WorkflowStatus.PAUSED, pausedPublication.status());
assertTrue(currentTriggers.stream().allMatch(t -> t.getStatus() == TriggerStatus.DISABLED));
```

- [ ] Run publication tests before implementation.
- [ ] Authorize capability and connections, validate a frozen draft snapshot, then acquire the workflow row lock and compare against that snapshot. If it changed during remote validation, return `409 DRAFT_CHANGED`; never publish an unvalidated new draft. Under the lock allocate version number, insert immutable version, switch currentVersionId, replace registrations, and update references in one transaction.
- [ ] Preserve paused state; DRAFT becomes PUBLISHED; PUBLISHED stays PUBLISHED. Pause/resume are idempotent for already-paused/already-published workflows with a current version. Disable old automatic registrations. Keep Telegram unavailable/disabled. Schedule readiness implementation comes from Task 16; webhook secret provisioning from Task 17, so until those tasks their registrations must fail configuration visibly rather than claim readiness.
- [ ] Define the required pure aggregate operation as `publishVersion(UUID versionId,Instant at)`; it sets the version and timestamp but changes status only when not PAUSED. Preserve constructor compatibility until persistence mapping/tests are updated; use GitNexus rename if renaming existing symbols.
- [ ] Run both publication test classes plus draft regressions. Verify an injected failure after version insert rolls back version, pointer, and trigger changes together.

### Task 7: Implement the existing internal connection-usage contract

**Files:** Create `R/db/migration/V2__connection_reference_tracking.sql`, `M/application/service/ConnectionUsageService.java`, `M/application/port/out/ConnectionReferencePort.java`, `M/infrastructure/persistence/repository/ConnectionReferenceAdapter.java`, `M/presentation/http/InternalConnectionUsageController.java`, `T/presentation/http/ConnectionUsageHttpTest.java`, `T/infrastructure/persistence/ConnectionReferenceMigrationTest.java`; update draft/publication adapters and `packages/contracts/http/workflow/openapi.yaml` only additively.

**Interfaces:** `ConnectionReferencePort.replaceDraft(UUID workflowId,Set<UUID> connections)`, `appendVersion(UUID workflowId,UUID versionId,Set<UUID> connections)`, `inUse(UUID workspaceId,UUID connectionId) -> boolean`. `ConnectionUsageService.lookup(UUID workspaceId,UUID connectionId) -> boolean`; controller returns a record with the sole component `boolean inUse`.

- [ ] Test invalid/missing service key 401, unused false, active-draft true, stored-version true, cross-workspace exclusion, deleted-draft exclusion, and **stored version of a deleted workflow true**. Test never-observed pair returns 200 false, configured rate limit 429, DB failure 500, and that zero Workspace HTTP calls are made during lookup. A missing reference must not be interpreted as a missing Workspace connection.

```sql
-- The version arm intentionally does not test workflows.deleted_at.
SELECT EXISTS (
  SELECT 1 FROM workflow_connection_references r
  JOIN workflows w ON w.id = r.workflow_id
  WHERE w.workspace_id = :workspaceId AND r.connection_id = :connectionId
    AND (r.version_id IS NOT NULL OR w.deleted_at IS NULL)
);
```

- [ ] Run `ConnectionUsageHttpTest,ConnectionReferenceMigrationTest` before filling behavior.
- [ ] Add `workflow_connection_references(workflow_id UUID NOT NULL REFERENCES workflows(id),version_id UUID REFERENCES workflow_versions(id),connection_id UUID NOT NULL)`. Add separate partial unique indexes for draft `(workflow_id,connection_id) WHERE version_id IS NULL` and version `(version_id,connection_id) WHERE version_id IS NOT NULL`, plus connection lookup index. No cross-service FKs.
- [ ] Backfill references from the exact `nodes[*].config.connectionId` location in existing drafts/versions; tolerate missing/unfinished configs without unsafe casts. Test migration from a populated V1 schema, including deleted workflow versions. Do not scan arbitrary user text for UUIDs.
- [ ] Replace draft projection and append immutable-version references in the authoring transaction after successful attachment authorization. Never delete immutable references just because a new version omits that connection.
- [ ] Clarify OpenAPI/README: Workspace verifies connection existence; Workflow returns 200 false when no scoped references exist. Remove the operation's unknown-connection 404 semantics, as explicitly approved by the user. Workspace must still fail closed on an unexpected non-200, including a routing 404. Add a bounded internal lookup limiter and standard error envelopes. Run the real Workspace usage client contract against this controller, including unused-connection deletion and failure paths. Complete M1 review and tests before its commit.

### Task 8: Commit execution admission and outbox intent together

**Files:** Fill `M/application/usecase/TriggerExecutionUseCase.java`, `M/application/dto/ExecutionResultDto.java`, `M/infrastructure/persistence/repository/WorkflowExecutionRepositoryAdapter.java`, `OutboxEventRepositoryAdapter.java`, `M/infrastructure/persistence/mapper/ExecutionPersistenceMapper.java`; create `M/application/execution/ExecutionAdmissionService.java`, `M/application/port/out/ExecutionAdmissionPort.java`, `M/infrastructure/messaging/ExecutionOutboxPublisher.java`, `RabbitExecutionConfiguration.java`, `T/infrastructure/messaging/ExecutionOutboxTest.java`, `T/application/ExecutionAdmissionTest.java`; modify execution/outbox aggregates/entities, `R/application.properties`; create `R/db/migration/V3__execution_delivery_state.sql`.

**Interfaces:** `ExecutionAdmissionService.manual(UUID workspaceId,UUID workflowId,UUID actorId,Object input,String correlationId,String traceparent) -> Admission`; `automatic(UUID triggerId,Object input,Instant scheduledAt,String correlationId,String traceparent) -> Admission`. `Admission(UUID executionId,UUID workflowId,UUID workflowVersionId,ExecutionStatus status)`; `ExecutionAdmissionPort.create(Command command) -> Admission`, with nested `Command(UUID workspaceId,UUID workflowId,UUID actorId,UUID triggerId,ExecutionTriggerType triggerType,Object input,Instant scheduledAt,String correlationId,String traceparent)`. The adapter locks the workflow/registration and derives current version/root itself; never accept those from event input. Automatic context is obtained from the trigger's stored workflow relationship, not body fields.

- [ ] Test DRAFT/PAUSED rejection, PUBLISHED manual acceptance, wrong-workspace denial, pinned version, exact firing root, malformed/oversized input, admission rollback, publisher crash, broker down, confirm timeout, unroutable message, and duplicate delivery.

```java
// In a PostgreSQL/RabbitMQ integration test, stop Rabbit before calling manual().
assertEquals(ExecutionStatus.QUEUED, admission.status());
assertEquals(1, jdbc.queryForObject(
    "select count(*) from workflow.outbox_events where aggregate_id = ? and status = 'PENDING'",
    Integer.class, admission.executionId()));
// Restart Rabbit, trigger the publisher, and consume {"executionId":"<same UUID>"}.
```

- [ ] Run `ExecutionAdmissionTest,ExecutionOutboxTest` and observe failures.
- [ ] Add `root_node_id`, `correlation_id`, `traceparent`, `scheduled_at`, `edge_states JSONB NOT NULL DEFAULT '{}'`, `lease_owner`, `lease_token BIGINT NOT NULL DEFAULT 0`, `lease_until` to workflow executions; add `next_attempt_at` to node executions; add bounded publisher lease/retry timestamp columns to outbox. Keep new columns nullable/backfillable for V1 rows. Add a partial unique index `(trigger_id,scheduled_at) WHERE scheduled_at IS NOT NULL`. New executions always have a valid root and immutable version.
- [ ] Add `triggerId` to the domain execution and persist it through the existing entity/mapper. Change its JSON input boundary to `Object` with `JsonValues.freeze`, preserving object/array/scalar/null webhook bodies; manual API still requires its documented input object. Do not wrap webhook arrays/scalars in an invented object. Keep constructors/mappers and existing persistence fixtures consistent.
- [ ] Under the same workflow lock used by publish/pause, recheck PUBLISHED/current registration and atomically insert execution, one node row per definition node, and one `PENDING` outbox event. V1 outbox event payload contains only executionId; broker headers carry correlation if needed. The HTTP response follows DB commit, not a direct broker publish; broker downtime leaves a durable queued execution.

```json
{"executionId":"00000000-0000-0000-0000-000000000001"}
```

- [ ] Declare durable exchange `workflow.executions`, durable queue `workflow.executions.v1`, routing key `execute`, and a dead-letter queue for malformed/poison messages. Publish persistent messages with mandatory routing and publisher confirms. Mark outbox PUBLISHED only after a routed positive confirm. Nack/timeout/return leaves durable retry intent; recover abandoned publisher leases. Publisher failure must not exhaust the three **node** attempts.
- [ ] Test commit-before-publish and crash-after-confirm-before-marking windows: delivery may duplicate, execution ID does not. Keep transaction/connection usage short; no DB transaction waits through provider execution. Run focused tests and migration upgrade coverage.

### Task 9: Implement active-edge readiness, branch exclusion, and joins

**Files:** Create `M/domain/execution/GraphState.java`, `ReadinessPlanner.java`, `ConditionEvaluator.java`, `RetryPolicy.java`; create `T/domain/execution/ReadinessPlannerTest.java`, `ConditionEvaluatorTest.java`, `RetryPolicyTest.java`.

**Interfaces:** `GraphState(Map<String,NodeExecutionStatus> nodes,Map<String,EdgeState> edges)` with `EdgeState { UNKNOWN, ACTIVE, INACTIVE }`. `ReadinessPlanner.initialize(WorkflowDefinition,String firingRoot) -> GraphState`; `afterSuccess(WorkflowDefinition,GraphState,String nodeId,String selectedPort) -> GraphState`; `ready(WorkflowDefinition,GraphState) -> List<String>`. `ConditionEvaluator.evaluate(Object left,String operator,Object right) -> boolean`; `RetryPolicy.retryable(String code,Integer httpStatus)`, `delayAfter(int attemptNumber) -> Duration`, `canRetry(int attemptsConsumed,boolean retryable) -> boolean`.

- [ ] Write table-driven graphs for manual-only, manual plus automatic roots, diamond join, selected B/skipped C feeding D, nested conditions, a node with both inactive and active routes, multiple active predecessors finishing in reverse order, and an inactive condition subtree.

```java
@Test void retryBudgetCountsTheInitialAttempt() {
    var policy = new RetryPolicy();
    assertTrue(policy.canRetry(1, true));
    assertTrue(policy.canRetry(2, true));
    assertFalse(policy.canRetry(3, true));
    assertEquals(Duration.ofSeconds(1), policy.delayAfter(1));
    assertEquals(Duration.ofSeconds(2), policy.delayAfter(2));
    assertFalse(policy.canRetry(1, false));
}
```

- [ ] Run `ReadinessPlannerTest,ConditionEvaluatorTest,RetryPolicyTest` and observe failures.
- [ ] Initialize the firing trigger as SUCCESS with its normalized input output, other trigger roots as SKIPPED, and propagate their outgoing edges ACTIVE/INACTIVE. An unresolved active path remains UNKNOWN until its predecessor succeeds/selects a branch. Persist edge state and node state atomically later in Task 11.
- [ ] Implement the readiness decision exactly, without counting all declared edges as active:

```text
For each PENDING node in topological order:
  if any incoming edge is UNKNOWN: leave PENDING
  else if no incoming edge is ACTIVE: mark SKIPPED; set outgoing INACTIVE
  else if every ACTIVE predecessor is SUCCESS: mark READY
Repeat until propagation stops. Never skip a node with any active incoming path.
```

- [ ] On condition success set the selected port's edges ACTIVE and all other port edges INACTIVE; ordinary success activates all outgoing edges. Conditions use structural JSON equality for eq/ne (numeric values compared numerically) and numeric-only ordering; absent inputs are errors, not null.
- [ ] Verify all-inactive joins skip, mixed-root joins do not wait for inactive roots, and a join becomes READY only once. Pure unit tests must not need Spring, threads, clocks, or a broker.

### Task 10: Claim, fence, and recover execution work across worker restarts

**Files:** Create `M/application/port/out/ExecutionStatePort.java`, `M/infrastructure/persistence/repository/ExecutionStateAdapter.java`, `M/infrastructure/messaging/ExecutionJobListener.java`, `M/infrastructure/scheduling/ExecutionRecoveryScanner.java`, `T/infrastructure/persistence/ExecutionLeaseTest.java`, `T/infrastructure/messaging/ExecutionRecoveryTest.java`.

**Interfaces:** `ExecutionStatePort.claim(UUID executionId,String owner,Duration lease) -> Optional<Lease>`; `renew(Lease,Duration) -> boolean`; `load(Lease) -> Snapshot`; `commit(Lease,Transition) -> boolean`; `release(Lease) -> void`. Define these nested records in ExecutionStatePort; only this adapter commits transitions, checking token and lease expiry:

```java
record Lease(UUID executionId, String owner, long token) {}
record Snapshot(UUID workflowId, UUID workspaceId, WorkflowVersion version,
    WorkflowDefinition definition, String firingRoot, Object input, GraphState graph,
    Map<String, NodeExecution> nodes, List<NodeExecutionAttempt> attempts,
    Map<String, Instant> nextAttempts, String correlationId, String traceparent,
    ExecutionStatus status) {}
record Transition(GraphState graph, List<NodeExecution> nodes,
    List<NodeExecutionAttempt> attempts, Map<String, Instant> nextAttempts,
    ExecutionStatus status, Map<String, Object> output, Map<String, Object> error,
    Instant finishedAt, List<ExecutionLog> logs) {}
```

Snapshot/Transition use existing pure domain aggregates, not JPA entities. The adapter persists graph/node/attempt/retry/terminal changes in one short transaction. Every optional timestamp/error has an explicit null/empty interpretation in mapper tests; null `finishedAt` means nonterminal.

- [ ] Test two workers claiming one execution, valid heartbeat, lease loss, expired claim takeover, stale-owner commit rejection, terminal duplicate delivery, crash with SUCCESS nodes already stored, and a RUNNING execution whose queue message was acknowledged before worker death.

```sql
UPDATE workflow_executions
SET lease_owner = :owner, lease_token = lease_token + 1,
    lease_until = CURRENT_TIMESTAMP + :leaseInterval,
    status = 'RUNNING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
WHERE id = :id AND status IN ('QUEUED','RUNNING')
  AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP)
RETURNING lease_token;
```

- [ ] Run `ExecutionLeaseTest,ExecutionRecoveryTest` first.
- [ ] Implement claim and every subsequent state write using PostgreSQL time and fencing. A failed fence rolls back the entire transition. Renewals use a separate short transaction; do not occupy Hikari's pool during external calls. Listener validates the UUID-only envelope, then hands the execution to the application runner from Task 11.
- [ ] Define acknowledgement behavior: ack a successfully claimed/handed-off job and terminal duplicates; an already-owned duplicate may be acked because recovery scanning is mandatory. Transient DB errors requeue with bounded broker redelivery delay; malformed envelopes dead-letter. Do not hot-loop immediate requeue.
- [ ] Recovery scanner finds QUEUED rows missing effective delivery and RUNNING rows with expired leases, then writes a new outbox event using a guarded DB claim. This provides recovery even after early ack. Scan bounds and lease make it safe on multiple instances. Shutdown stops admission to the local executor, stops new nodes, and releases only after running calls settle or ownership expires.
- [ ] On takeover, recorded SUCCESS/SKIPPED nodes stay terminal. Persist an interrupted RUNNING attempt as FAILED with `WORKER_INTERRUPTED`; retain its consumed attempt number. Retry only within the remaining budget. Old rows with no recoverable root/version fail visibly with a sanitized legacy-state error; do not guess a root or replay arbitrary actions.
- [ ] Run real multi-worker DB/broker tests. State precisely that fencing prevents stale database commits, not duplicate external side effects already in flight.

### Task 11: Execute ready nodes concurrently with durable attempts and retries

**Files:** Create `M/application/node/NodeExecutor.java`, `NodeExecutorRegistry.java`, `M/application/execution/ExecutionRunner.java`, `NodeAttemptRunner.java`, `M/application/port/out/RetryWaitPort.java`, `M/infrastructure/execution/BoundedExecutionConfiguration.java`, `ScheduledRetryWait.java`; modify execution/node/attempt aggregates, `ExecutionStateAdapter.java`, `ExecutionJobListener.java`; create `T/application/execution/ExecutionRunnerTest.java`, `T/infrastructure/execution/ExecutionRuntimeTest.java`.

**Interfaces:** `NodeExecutor.execute(Context context,Map<String,Object> resolvedConfig) -> Result` and `type() -> String`. Nested `Context(UUID workspaceId,UUID executionId,UUID nodeExecutionId,String nodeId,int attemptNumber,String correlationId,String traceparent)` has no credential fields. Nested `Result(Map<String,Object> output,String selectedPort)`; nested `Failure(String code,String safeMessage,boolean retryable)` is a runtime exception with no raw provider body/cause serialization. `ExecutionRunner.run(ExecutionStatePort.Lease lease) -> void`; `RetryWaitPort.until(Instant eligibleAt) -> CompletionStage<Void>`. `NodeExecutorRegistry.require(String type) -> NodeExecutor`.

- [ ] Test two independent READY nodes overlap using CountDownLatch; a join waits for both; retries persist attempts 1/2/3; clock-controlled delays are 1s/2s; mapping/config/auth errors consume one attempt only; missing registry adapter fails explicitly. Do not test concurrency with arbitrary sleeps.

```java
var entered = new CountDownLatch(2);
var release = new CountDownLatch(1);
// Register two test NodeExecutors whose execute calls entered.countDown(), then release.await().
assertTrue(entered.await(5, TimeUnit.SECONDS));
release.countDown();
// Assert both node SUCCESS rows and one successful join after the latch opens.
```

- [ ] Run `ExecutionRunnerTest,ExecutionRuntimeTest` first.
- [ ] Runner reloads the pinned definition/state, computes READY nodes with Task 9, and schedules only up to the configured per-execution bound. Centralize transition writes through the runner; callbacks return results instead of mutating shared graph maps. Before provider use resolve mappings from SUCCESS outputs and validate the resolved typed config again.
- [ ] In a fenced transaction, create a RUNNING attempt with unique `(node_execution_id,attempt_number)` and increment the persisted count **before** invoking its executor. On success atomically store safe output, SUCCESS attempt/node, selected branch/edge transitions, and sanitized event log. Persist `next_attempt_at = failure_time + delayAfter(attempt)` before waiting; restart uses that persisted time and remaining budget.

```text
failure -> persist FAILED attempt
if transient and attempt_count < 3:
  persist retry eligibility; wait without retaining a DB transaction or node permit
  schedule next attempt when due, only if lease valid and execution not failing
else:
  stop dispatching new nodes; let already-running independent calls settle
  persist FAILED execution and CANCELLED not-started active work
  preserve SKIPPED nodes for inactive branches
```

- [ ] Include `http 5xx`, `429`, network/timeout as transient; mapping/config/dependency errors, confirmed authentication rejection, and ordinary business 4xx are not retryable. Do not report Workspace auth-failure for 429/timeouts/business denials. A failure during another node's backoff prevents that retry from starting.
- [ ] Finalize SUCCESS only when every active node is SUCCESS and inactive nodes are SKIPPED. A failed execution is finalized only after running work settles; its API can remain RUNNING with failure detail while settling, but no new nodes start. Record stable error/timing and bounded output/log sizes.
- [ ] Kill/restart a worker during backoff and after success persistence; verify no reset attempt budget and no replay of completed nodes. Demonstrate the uncertain provider-success window in a test and document at-least-once behavior. Run Task 9–11 tests together.

### Task 12: Expose manual execution and authorized execution monitoring

**Files:** Create `M/presentation/http/WorkflowExecutionController.java`, `M/presentation/http/request/ManualExecutionRequest.java`, `M/application/service/ExecutionQueryService.java`, `M/application/port/out/ExecutionQueryPort.java`, `M/infrastructure/persistence/repository/ExecutionQueryAdapter.java`, `T/presentation/http/WorkflowExecutionHttpTest.java`; fill `M/presentation/http/response/ExecutionResponse.java`, `M/application/dto/ExecutionResultDto.java`; extend `packages/contracts/http/workflow/openapi.yaml`; create `packages/contracts/http/workflow/README.md`.

**Interfaces:** `ExecutionQueryService.list(UUID workspaceId,UUID workflowId,UUID actorId,int page,int size) -> ExecutionPage`; `detail(UUID workspaceId,UUID workflowId,UUID executionId,UUID actorId) -> ExecutionDetail`. Define the DTOs here: page items include IDs/version/status/trigger type/times; detail adds node states, attempt number/status/times, sanitized output/error, and bounded/paginated logs. Query port consumes scoped IDs and returns these projection types, with no lazy JPA serialization.

- [ ] Test manual input `{ "input": {...} }`, 202 only after commit, DRAFT/PAUSED rejection, WORKFLOW_RUN distinct from WORKFLOW_MONITOR, wrong execution/workflow/workspace tuple, stable pagination, and no credential fields in deeply nested response data.

```java
mockMvc.perform(post("/workspaces/{w}/workflows/{f}/executions", workspaceId, workflowId)
    .with(jwt().jwt(j -> j.subject(actorId.toString())))
    .contentType("application/json").content("{\"input\":{\"count\":2}}"))
    .andExpect(status().isAccepted())
    .andExpect(jsonPath("workflowVersionId").value(versionId.toString()))
    .andExpect(jsonPath("status").value("QUEUED"));
```

- [ ] Run `WorkflowExecutionHttpTest` first.
- [ ] Delegate POST to Task 8 admission and GET to scoped query projections. Authorization happens before returning data; a UUID match alone is insufficient. Define GET detail with `logPage`/`logSize` defaults 0/20, max 100 and a deterministic log ordering; do not truncate logs without indicating pagination.
- [ ] Expand OpenAPI to all ten spec resource routes plus later webhook route, retaining the exact existing internal usage operation/security/response shape. Service paths omit `/api/v1`; document Gateway-prefixed examples separately. Include actual PAUSED publish result, field diagnostics, dependency error, pagination, and one-time webhook response secret classification.
- [ ] Test standard envelopes for malformed JSON, invalid UUID, size/rate limit, authorization, validation, state conflict, and sanitized unexpected failures. Run actual HTTP with valid signed test JWTs in addition to MockMvc principal tests. Complete M2's full Workflow test/verify and review before commit.

### Task 13: Execute HTTP requests with enforced SSRF controls and secret hygiene

**Files:** Create `M/infrastructure/http/HttpRequestNodeExecutor.java`, `OutboundTargetPolicy.java`, `PinnedHttpTransport.java`, `OutputSanitizer.java`, `OutboundHttpProperties.java`, `T/infrastructure/http/OutboundTargetPolicyTest.java`, `HttpRequestNodeExecutorTest.java`, `HttpTransportIntegrationTest.java`; modify `services/workflow-service/pom.xml` only if the verified Workspace pinned-transport dependency is absent; register in `NodeExecutorRegistry.java` and `R/application.properties`.

**Interfaces:** `OutboundTargetPolicy.approve(URI uri) -> ApprovedTarget(URI original,List<InetAddress> addresses)`; `PinnedHttpTransport.execute(ApprovedTarget target,String method,Map<String,String> headers,Object query,Object body) -> HttpResponse(int status,Object data,Map<String,String> headers)` with bounded body/timeout; `OutputSanitizer.sanitize(Object value,Set<String> activeSecretValues) -> Object`. `HttpRequestNodeExecutor` implements `NodeExecutor` for `http.request`. Transport DTOs remain infrastructure-only.

- [ ] Write tests for private/loopback/link-local/metadata IPv4 and IPv6 (including mapped IPv4), userinfo URL, unsupported scheme, DNS results containing any forbidden address, DNS rebinding, redirects to private destinations, oversized response, timeout, provider 401 versus 429/403 business failure, and echoed authorization tokens.

```java
@ParameterizedTest
@ValueSource(strings = {"http://127.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "file:///etc/passwd"})
void rejectsUnsafeTargets(String url) {
    assertThrows(NodeExecutor.Failure.class, () -> targetPolicy.approve(URI.create(url)));
}
```

- [ ] Run the three HTTP test classes first.
- [ ] Adapt the current Workspace mechanism in `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/HttpTargetValidator.java` and `PinnedHttpTransport.java` into Workflow's infrastructure without importing Workspace source/domain. The existing transport uses Apache HttpClient 5's pinned resolver; extend its method/body support for Workflow with its own tests. Reject all prohibited destinations before transport; connect only to the vetted addresses while retaining the original hostname for TLS certificate verification/SNI and Host. Disable redirects, implicit client retries, and unbounded decompression. Do not validate with one DNS lookup and let the client independently resolve again.
- [ ] Validate URL again **after mapping**, restrict to HTTP(S), bound request/response sizes and timeout, reject user-controlled Host/content-length/connection framing and credential-bearing inline headers. Optional authentication comes from a literal Workspace connection UUID. Resolve immediately before each attempt; apply the provider/authType's already-documented runtime headers only within transport scope.
- [ ] Sanitize response headers, output data, failure messages, and log fields before persistence. Drop authorization/cookie/token/secret/signature-bearing headers/fields, scrub exact active secret values wherever echoed, and strip signed-URL query credentials. Persist only allowed output; never attach raw provider exceptions to error envelopes or repository logs. Close/discard credentials after each call.
- [ ] Return `{status,data}` on a real successful response; classify failures by Task 11 policy. Call auth-failure only for confirmed credential rejection. Never infer successful authentication from a network failure.
- [ ] Use deterministic DNS/transport unit seams and a controlled real HTTP server test proving the socket uses the approved address. Any local-test allowance is test-profile-only; assert production policy still rejects loopback. Run log/database secret-leak assertions and real TLS/pinning verification before claiming SSRF protection works.

### Task 14: Implement real Google Sheets read, append, and update

**Files:** Create `M/infrastructure/sheets/GoogleSheetsNodeExecutor.java`, `GoogleSheetsClient.java`, `T/infrastructure/sheets/GoogleSheetsNodeExecutorTest.java`, `GoogleSheetsContractTest.java`; register executor; document an opt-in provider smoke procedure in Workflow README during Task 21.

**Interfaces:** `GoogleSheetsClient.read(String spreadsheetId,String range,ResolvedConnection) -> Map<String,Object>`; `append/update(String spreadsheetId,String range,List<List<Object>> values,ResolvedConnection) -> Map<String,Object>`. Executor consumes resolved config and NodeExecutor.Context and returns sanitized JSON Result. No direct Workspace database or OAuth ownership.

- [ ] Test URL/path encoding for spreadsheet ID and range, required literal connection, read/append/update mapping, values preserving JSON cell types, provider rejection, token expiration/re-resolution per retry, and no secret persistence. Unknown operation is a non-retryable configuration error.

```text
read   -> GET  https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{encodedRange}
append -> POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{encodedRange}:append?valueInputOption=RAW
update -> PUT  https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{encodedRange}?valueInputOption=RAW
write body -> {"range":"Sheet1!A1:B2","majorDimension":"ROWS","values":[["name",2]]}
```

- [ ] Run `GoogleSheetsNodeExecutorTest,GoogleSheetsContractTest` first. These methods were checked against official [values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), [values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append), and [values.update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update) documentation during planning; refresh the protocol details at implementation time if they have changed.
- [ ] Resolve Workspace Google connection credentials just before calling the fixed Google endpoint; verify provider/auth type and documented runtime fields. Use the shared controlled transport and sanitizer. Keep V1 writes RAW; no additional OAuth scopes or provider SDK unless justified by missing functionality.
- [ ] Return actual API JSON only after real HTTP success. Treat provider errors according to Task 11; append can duplicate in a crash/retry uncertainty window, so do not claim exactly-once append or invent an idempotency header Google does not support.
- [ ] Run deterministic wire-contract tests, then an explicitly configured test spreadsheet smoke: read, append a uniquely marked test row, update that row, read it back. Record redacted result counts/IDs and clean up only test-owned data. If provider credentials are unavailable, report real-provider verification blocked rather than successful.

### Task 15: Make unavailable Email, Telegram, and AI integrations fail explicitly

**Files:** Create `M/application/node/UnavailableNodeExecutor.java`, `IntegrationReadiness.java`, `M/application/port/in/TelegramTriggerIngress.java`, `T/application/node/UnavailableNodeExecutorTest.java`; modify `NodeExecutorRegistry.java`, workflow detail projection and publication trigger readiness.

**Interfaces:** `UnavailableNodeExecutor(String type)` implements NodeExecutor. `IntegrationReadiness.forType(String type) -> Readiness(boolean configured,String reasonCode)`; `TelegramTriggerIngress.accept(UUID triggerId,Object normalizedInput) -> ExecutionAdmissionService.Admission` is an application-only boundary. Its unconfigured implementation throws the dependency failure; no HTTP route or normalization DTO is defined.

- [ ] Parameterize email.send, telegram.send_message, ai.extract, ai.classify, ai.summarize and assert one failed attempt, no fake message ID/output, and no external calls. Assert Telegram registration remains disabled and visible with its dependency reason; the single manual root still runs.

```java
@ParameterizedTest
@ValueSource(strings = {"email.send", "telegram.send_message", "ai.extract", "ai.classify", "ai.summarize"})
void unavailableAdapterNeverClaimsSuccess(String type) {
    var failure = assertThrows(NodeExecutor.Failure.class,
        () -> new UnavailableNodeExecutor(type).execute(context, Map.of()));
    assertEquals("DEPENDENCY_NOT_CONFIGURED", failure.code());
    assertFalse(failure.retryable());
}
```

- [ ] Run `UnavailableNodeExecutorTest` first.
- [ ] Implement the complete failure path:

```java
public NodeExecutor.Result execute(NodeExecutor.Context context, Map<String,Object> config) {
    throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
        "This node has no configured execution adapter", false);
}
```

- [ ] Keep typed catalog validation from Task 2, including AI expected output field documentation. Readiness is server-owned; node config cannot turn it on. Do not grant Gmail send, pick an AI provider/model, generate prompt transport, or expose the spec's unapproved Telegram route suggestion.
- [ ] Run one real database-backed workflow ending at each unavailable node and confirm FAILED/non-retryable monitoring state. Keep these limitations visible in API documentation and final milestone status.

### Task 16: Schedule executions durably with explicit timezone and deduplication

**Files:** Create `M/infrastructure/scheduling/SpringScheduleValidation.java`, `WorkflowScheduleScanner.java`, `M/application/trigger/ScheduleTriggerService.java`, `T/infrastructure/scheduling/ScheduleTriggerTest.java`, `ScheduleConcurrencyTest.java`; modify `WorkflowPublicationService.java`, `WorkflowTriggerAdapter.java`, `R/application.properties` and its test configuration.

**Interfaces:** `SpringScheduleValidation` implements `DefinitionValidator.ScheduleValidation`; `next(String cron,String timezone,Instant after) -> Instant`. `ScheduleTriggerService.scan(Instant now,int batchSize) -> int` returns admitted slot count. Admission uses Task 8 `automatic` with the trigger ID and scheduled instant.

- [ ] Test six-field validation versus five-field rejection, absent/invalid timezone, 09:00 Ho Chi Minh conversion, a DST transition in another valid IANA zone, multiple scheduler instances, restart after admission-before-next-scan, pause/resume, republish, and downtime coalescing.

```java
@Test void scheduleUsesItsTimezoneInsteadOfJvmDefault() {
    assertEquals(Instant.parse("2026-09-21T02:00:00Z"),
        new SpringScheduleValidation().next("0 0 9 * * *", "Asia/Ho_Chi_Minh",
            Instant.parse("2026-09-21T01:59:59Z")));
}
```

- [ ] Run `ScheduleTriggerTest,ScheduleConcurrencyTest` first.
- [ ] Implement with `CronExpression.parse(cron)` and `ZoneId.of(timezone)` in infrastructure; next occurrence uses `ZonedDateTime` in that explicit zone and returns Instant. Reject expressions with no future occurrence. Publish runs this validator even though execution occurs later.
- [ ] Poll due ACTIVE SCHEDULE registrations in bounded batches. Always acquire locks in the same order: workflow row, then trigger row. Recheck workflow PUBLISHED/current version/registration ACTIVE while holding locks. In that same transaction create the execution/outbox for `(triggerId,scheduledAt)`, set `last_triggered_at`, and advance `next_run_at`; rollback all on failure. The unique scheduled-slot index absorbs duplicate scans.

```json
{"scheduledAt":"2026-09-21T02:00:00Z"}
```

- [ ] Use this object as normalized trigger.input. Other roots remain inactive. Implement the documented coalescing policy; pause/resume and republish update future slots under the same locks. Store sanitized trigger errors without disabling unrelated triggers or losing the due slot after a transient DB failure.
- [ ] Run concurrent real PostgreSQL scanner tests and one broker/worker schedule execution to SUCCESS. Verify changing the JVM timezone does not change the scheduled instant.

### Task 17: Provision and authenticate durable webhook ingress

**Files:** Create `R/db/migration/V4__unique_webhook_endpoints.sql`, `M/application/trigger/WebhookTriggerService.java`, `M/infrastructure/security/WebhookSecretService.java`, `M/presentation/http/WebhookController.java`, `T/presentation/http/WebhookIngressTest.java`, `T/infrastructure/security/WebhookSecretTest.java`; modify trigger adapter/publication/security configuration and Workflow OpenAPI.

**Interfaces:** `WebhookSecretService.provision() -> IssuedKey(String endpointKey,String secret,String secretHash)`; `matches(String supplied,String storedHash) -> boolean`. `WebhookTriggerService.accept(String endpointKey,String suppliedSecret,Object input,String correlationId,String traceparent) -> Admission`. IssuedKey has redacted string rendering and is never persisted as a whole.

- [ ] Test unique random keys, hashed-only storage, one-time publish response, no secret in GET, unknown endpoint and missing/wrong secret identical 404, inactive/paused/superseded trigger rejection, accepted arbitrary JSON/null input, body limit, and commit/outbox failure before 202.

```java
mockMvc.perform(post("/webhooks/{endpointKey}", endpointKey)
    .contentType("application/json").content("{\"event\":\"created\"}"))
    .andExpect(status().isNotFound())
    .andExpect(jsonPath("error.code").value("WEBHOOK_NOT_FOUND"));
// Repeat with unknown key and wrong secret; assert the same response shape/message.
```

- [ ] Run `WebhookIngressTest,WebhookSecretTest` first.
- [ ] Generate 24 random bytes for endpoint key and 32 random bytes for the secret with SecureRandom; encode Base64 URL-safe without padding. Store SHA-256 of the high-entropy secret, never plaintext; compare fixed-length digests with `MessageDigest.isEqual`. Use a dummy digest for unknown keys, and avoid secret-dependent error messages.
- [ ] Add a unique partial endpoint-key index for non-null values. Migration preflight reports existing duplicates without deleting data; resolve duplicates as a separate explicit data repair if encountered. Publication provisions each new webhook registration, persists only hash/key, and returns plaintext once with `Cache-Control: no-store`. Lost publication responses require another publish; no hidden secret retrieval mechanism.
- [ ] Lookup trigger identity without trusting body fields, verify secret, acquire workflow then trigger lock, and recheck current PUBLISHED/ACTIVE registration before Task 8 atomic admission. Unknown/invalid/disabled/paused registrations use the generic 404; malformed/oversized JSON returns standard 400/413 independently of graph execution.
- [ ] Apply bounded ingress rate/body limits. Redact both secret and endpoint credential from access logs, MDC, error path, metrics labels, and traces: use `/webhooks/{endpointKey}` as the path template. Later GETs never return the secret or hash. No JWT required on this exact ingress; every other resource retains its own auth policy.
- [ ] Run real HTTP+DB+RabbitMQ acceptance and rollback tests. Confirm a webhook executes only its firing root, and queued work still runs after a subsequent pause. Complete M3 regression/review before commit.

### Task 18: Implement the formal OCR client behind explicit production gates

**Files:** Create `M/infrastructure/ocr/WorkflowServiceJwtIssuer.java`, `OcrClient.java`, `OcrNodeExecutor.java`, `OcrClientProperties.java`, `T/infrastructure/ocr/OcrServiceJwtTest.java`, `OcrClientContractTest.java`, `OcrNodeExecutorTest.java`; modify `packages/contracts/http/ocr/README.md`, `packages/contracts/http/ocr/openapi.yaml`, Workflow config/registry. OCR-service source changes require a separately owned prerequisite milestone, not an invented Workflow workaround.

**Interfaces:** `WorkflowServiceJwtIssuer.issue(NodeExecutor.Context context,Instant now) -> String`; `OcrClient.extract(NodeExecutor.Context context,Map<String,Object> request) -> Map<String,Object>`; OcrNodeExecutor implements `ocr.extract`. Client feature gates are `enabled=false` and `artifactSourceEnabled=false` by default; enabling requires the evidence below, a private OCR base URL, explicit key ID, and local asymmetric private-key reference.

- [ ] Add cryptographic tests verifying signature against a test public key and all required claims. Test wrong audience/issuer/scope/mode/workspace, missing execution/node IDs, expired token, TTL >120s, and no user-token substitution at the OCR verifier boundary. Use test-only generated keys, never repository production material.

```json
{
  "iss":"weav-workflow", "aud":"weav-ocr", "scope":"ocr:extract",
  "workspace_id":"00000000-0000-0000-0000-000000000001", "mode":"execution",
  "execution_id":"00000000-0000-0000-0000-000000000002",
  "node_execution_id":"00000000-0000-0000-0000-000000000003"
}
```

- [ ] Run `OcrServiceJwtTest,OcrClientContractTest,OcrNodeExecutorTest` first.
- [ ] Use the existing JOSE dependency if available; verify the dependency tree before adding one. Select an explicitly configured asymmetric algorithm/key compatible with the approved OCR verifier (initial RS256), set `kid`, `iat`, `exp=iat+60s`, and `jti`; never fall back to an HMAC Identity secret. The configured lifetime cannot exceed 120s. Sign once per attempt immediately before the call.
- [ ] Send exactly private `POST /v1/extractions`, service Authorization, required generated UUID X-Request-ID, and valid traceparent when available. The source is exactly one of these shapes; defaults are language `vi+en`, detectTables true:

```json
{"source":{"type":"url","fileUrl":"https://approved.example/document.pdf"},"language":"vi+en","detectTables":true}
```

```json
{"source":{"type":"artifact","artifactId":"00000000-0000-0000-0000-000000000004"},"language":"vi+en","detectTables":true}
```

- [ ] Update OCR contract docs/schema descriptions/tests to include `execution_id` and `node_execution_id`, which the spec requires but the current contract README does not enumerate. Use the checked-in success fixtures to map `schemaVersion`, `text.rawText`, confidence where present, pages/blocks/tables/metadata; malformed responses fail safely, never synthesize success.
- [ ] Keep disabled gates returning `DEPENDENCY_NOT_CONFIGURED`, non-retryable. **URL gate:** OCR must verify JWT signature and every required claim, derive workspace from the verified claim rather than trusting X-Workspace-ID, require UUID X-Request-ID, and wire an explicit URL allowlist. Current runtime only checks Bearer presence, generates missing request IDs, trusts X-Workspace-ID, and constructs a default-deny SafeUrlFetcher without configured allowed domains. A Workflow-side flag alone is not evidence these problems are fixed.
- [ ] **Artifact gate:** require a written, reviewed descriptor/download contract, a concrete OCR resolver adapter, and artifact ownership/expiry/download verification. Current OCR dependency wiring supplies `artifact_resolver=None`; the abstract port is not an implemented contract. Until this evidence exists, artifact config remains validatable but execution fails with a specific dependency reason. Do not invent a descriptor route/body or add the legacy X-Workspace-ID header to bypass claim validation.
- [ ] Record provider retry classification and sanitize OCR errors/output using Task 13. Final production acceptance requires real Workflow-signed token accepted by hardened OCR, malicious/expired/mismatched tokens rejected, allowed URL extraction successful, disallowed URL blocked. A mocked OCR server validates only the Workflow client contract.

### Task 19: Expose only the specified Workflow routes through Gateway

**Files:** Create `services/api-gateway/src/workflow/workflow.module.ts`, `workflow.controller.ts`, `workflow-proxy.service.ts`, `workflow-proxy.service.spec.ts`, `webhook.controller.ts`, `services/api-gateway/test/workflow.e2e-spec.ts`; modify `services/api-gateway/src/app.module.ts`, `src/config/gateway.config.ts`, `packages/contracts/http/gateway/openapi.yaml`, `README.md`; touch shared transport/limits helpers only if the existing extension point cannot express Workflow limits.

**Interfaces:** WorkflowProxyService forwards exactly the ten resource operations listed in spec section 7 and `POST /webhooks/:endpointKey` to the configured Workflow base URL. Method/path whitelist is exact. Public route input/response shape remains Workflow-owned; proxy transports parsed JSON, bearer token, correlation/trace, and the webhook secret only on webhook ingress.

- [ ] Add E2E tests for every method/path, exactly one `/api/v1` prefix, JWT required for resource routes, public webhook reaching Workflow without JWT, secret forwarding, generic invalid-secret 404, bounded body/response/deadline, and forbidden internal/unknown/wildcard routes.

```typescript
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post(':endpointKey')
  @AuthPolicy('public')
  accept(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.proxy.forwardWebhook(request, reply);
  }
}
```

- [ ] Run `pnpm --dir services/api-gateway test:e2e -- --runInBand workflow.e2e-spec.ts` first. Use the existing auth-policy decorator from `src/auth/auth-policy.decorator.ts`.
- [ ] Follow the existing Workspace proxy's redirect, header, correlation, and timeout protections, but configure Workflow's 1 MiB definition/input budget rather than copying Workspace's 16 KiB body limit. Implement `WorkflowProxyService.forwardWebhook(request: FastifyRequest,reply: FastifyReply): Promise<void>` plus `forwardResource(request,reply,upstreamPath): Promise<void>` with validated path parameters and a whitelist, not arbitrary caller URLs.
- [ ] Explicitly allow/preserve X-Webhook-Secret on this route only. Never forward client X-Internal-Service-Key or expose `/internal/**`. Preserve one-time webhook response secret only on publication, with no-store and sanitized access logs; do not log a whole response body. Redact endpointKey in Gateway logs and errors as Task 17 requires.
- [ ] Route Workflow's structured errors/status transparently within the proxy's safe envelope policy. Do not modify the existing Gateway OCR user-token flow in this task; document its separate service-auth gap rather than treating it as Workflow's signing boundary.
- [ ] Run focused E2E, Gateway unit/full E2E, typecheck, and build:

```powershell
pnpm --dir services/api-gateway test -- --runInBand --silent
pnpm --dir services/api-gateway test:e2e -- --runInBand --silent
pnpm --dir services/api-gateway exec tsc --noEmit
pnpm --dir services/api-gateway build
```

- [ ] Confirm an actual running Gateway forwards authenticated create/publish/manual execution and unauthenticated secret-authenticated webhook to the real Workflow service. A stub upstream alone does not prove service security interoperability.

### Task 20: Align the web catalog and builder inputs with V1

**Files:** Modify `apps/web/src/lib/constants/nodeCatalog.ts`, `apps/web/src/types/workflow.types.ts`, `apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/components/builder/CustomWorkflowNode.tsx`; create `apps/web/e2e/workflow-catalog-v1.spec.ts`; update existing `apps/web/e2e/workflow-ui.spec.ts` and `ocr-builder.spec.ts` only where approved catalog behavior changes.

**Interfaces:** Keep existing NodeCatalogItem and WorkflowEdge; add `'logic'` to NodeCategory and optional `sourcePorts?: Array<{id:string;label:string}>` to catalog entries. New `logic.condition` config defaults are `{left:'',operator:'eq',right:''}`, with left/right accepting user-entered JSON values or mappings. Branch edges persist `sourcePort='true'|'false'`. Do not serialize screen coordinates into the executable schema.

- [ ] Write Playwright checks for the exact supported set, six-field cron/timezone, declarative condition fields and two handles, no arbitrary-code field, no caller-selected webhook path, and user-visible unconfigured integration status. Check both the catalog and the builder's separate palette; the latter currently offers unsupported logic.filter/google.docs and `$json` condition strings.

```typescript
import { expect, test } from '@playwright/test';
import { NODE_CATALOG } from '../src/lib/constants/nodeCatalog';

test('catalog uses the backend V1 schedule', () => {
  const schedule = NODE_CATALOG.find((entry) => entry.type === 'trigger.schedule');
  expect(schedule?.defaultConfig.cron).toBe('0 0 9 * * *');
  expect(schedule?.defaultConfig.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(NODE_CATALOG.some((entry) => entry.type === 'logic.condition')).toBe(true);
  expect(NODE_CATALOG.some((entry) => ['agent.task', 'google.docs', 'logic.filter'].includes(entry.type))).toBe(false);
});
```

- [ ] Run `pnpm --dir apps/web test:e2e -- workflow-catalog-v1.spec.ts` first.
- [ ] Remove unsupported types from **new-node choices**, not from users' saved workflows. Existing drafts containing them display an unsupported-node warning and cannot be published to V1; never silently delete/convert them. Derive palette choices/defaults from the catalog to eliminate the contradictory second list.
- [ ] Replace `$json` examples with `{{ trigger.input.email }}` or an actual upstream `{{ nodes.request.output.data }}` reference; use `.data` for HTTP output. Replace fake connectionId `google-workspace` with an unselected connection input; do not create a fake UUID. Keep create/save possible with unfinished fields; publication requires a real authorized connection. There are currently 14 catalog entries; removing google.docs/agent.task and adding logic.condition yields the 13 V1 entries.
- [ ] Add `logic.condition` left/operator/right fields with the six operators and true/false source handles. Replace the builder's existing code-like condition defaults. Add Telegram trigger/send types to palette; show their actual readiness rather than offering fake execution. OCR config exposes exactly-one artifactId/fileUrl choice and safe defaults, with production dependency state visible.
- [ ] Remove caller-chosen webhook path defaults; show that publication provisions the endpoint/key once. Preserve the existing editor-state shape locally; this task does not connect the local-storage workflow API to the new backend or add a new full authoring product.
- [ ] Run authenticated real browser checks against the running app: add supported nodes, edit a condition, connect both ports and reload, inspect schedule defaults, open an old unsupported draft without data loss, and inspect no console/network failures. Then run build, lint, and affected Playwright specs. Record screenshots/network evidence for the changed user-facing behavior; catalog import assertions alone are insufficient.

### Task 21: Wire configuration and verify the complete supported runtime

**Files:** Create `services/workflow-service/README.md`, `services/workflow-service/src/test/java/com/weav/workflow/acceptance/WorkflowV1AcceptanceTest.java`, `packages/contracts/http/workflow/examples/manual-http-condition.json`, `scripts/test-workflow-v1.ps1`; modify `.env.example`, `compose.dev.yml`, Workflow `application.properties`, affected contract docs, and member work log. Do not modify secret files or production data.

**Interfaces:** The smoke script accepts nonsecret base URLs/fixture paths and reads test credentials from process environment without printing them; it exits nonzero on any incorrect status/shape/state and deletes only resources it demonstrably created, where supported APIs exist. Since V1 has no workflow-delete endpoint, use a disposable test database/workspace rather than inventing cleanup APIs.

- [ ] Build a persisted acceptance graph with manual + webhook + schedule roots, parallel HTTP branches, a condition, an inactive branch, and a join; also create separate Sheets and dependency-failure fixtures. Freeze expected node/attempt states and version IDs in assertions. Every fixture contains only public test data and authorized connection UUID references.

Use this executable smoke core; the larger test suite below supplies failure/concurrency assertions. Its fixture file is the canonical definition object and must target only the controlled acceptance server.

```powershell
param(
    [Parameter(Mandatory)][string]$WorkflowUrl,
    [Parameter(Mandatory)][guid]$WorkspaceId,
    [Parameter(Mandatory)][string]$FixturePath
)
$ErrorActionPreference = 'Stop'
if (-not $env:WORKFLOW_TEST_ACCESS_TOKEN) { throw 'Test access token is required' }
$smokeHeaders = @{ Authorization = 'Bearer ' + $env:WORKFLOW_TEST_ACCESS_TOKEN }
$smokeBase = $WorkflowUrl.TrimEnd('/') + '/workspaces/' + $WorkspaceId + '/workflows'
$smokeStage = 'create'
try {
    $created = Invoke-RestMethod -TimeoutSec 30 -Method Post -Uri $smokeBase -Headers $smokeHeaders -ContentType 'application/json' -Body '{"name":"Workflow V1 acceptance"}'
    if ($created.status -ne 'DRAFT') { throw 'Unexpected create state' }
    $smokeStage = 'draft'
    $definition = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
    $draftBody = @{ name = 'Workflow V1 acceptance'; description = 'Disposable test fixture'; definition = $definition; editorState = @{} } | ConvertTo-Json -Depth 40
    $workflowUri = $smokeBase + '/' + $created.workflowId
    $null = Invoke-RestMethod -TimeoutSec 30 -Method Put -Uri ($workflowUri + '/draft') -Headers $smokeHeaders -ContentType 'application/json' -Body $draftBody
    $smokeStage = 'publish'
    $published = Invoke-RestMethod -TimeoutSec 30 -Method Post -Uri ($workflowUri + '/publish') -Headers $smokeHeaders
    if ($published.status -ne 'PUBLISHED') { throw 'Unexpected publish state' }
    $smokeStage = 'run'
    $run = Invoke-RestMethod -TimeoutSec 30 -Method Post -Uri ($workflowUri + '/executions') -Headers $smokeHeaders -ContentType 'application/json' -Body '{"input":{"acceptance":true}}'
    if ($run.workflowVersionId -ne $published.versionId) { throw 'Version mismatch' }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    do {
        $detail = Invoke-RestMethod -TimeoutSec 30 -Method Get -Uri ($workflowUri + '/executions/' + $run.executionId) -Headers $smokeHeaders
        if ($detail.status -in @('SUCCESS','FAILED','CANCELLED')) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($detail.status -ne 'SUCCESS') { throw 'Execution did not succeed within the deadline' }
    Write-Output ('PASS execution=' + $run.executionId + ' version=' + $published.versionId)
} catch {
    throw ('Workflow acceptance failed at stage: ' + $smokeStage)
} finally {
    $smokeHeaders.Clear()
}
```

- [ ] Write acceptance assertions before runtime wiring: create 201, draft/get/list scoped correctly, publish immutable v1, run 202 then SUCCESS, edit/publish v2 while v1 is queued and prove v1 execution stays pinned, pause rejects new manual/webhook/schedule events but queued work completes, resume uses v2 registrations, monitor records exact attempts and branch state.
- [ ] Run `WorkflowV1AcceptanceTest` against PostgreSQL/RabbitMQ containers first. Add broker restart and worker crash tests, concurrent publication/scans, cross-workspace capability denials, unsupported adapter failure, and connection usage for live drafts/all stored versions/no-reference false. Verify DB/outbox/attempt/log tables do not contain deliberately injected test secret markers.
- [ ] Add named config placeholders only: Workspace base URL and internal client key; Workflow internal key; execution/ready-node limits; outbox/lease/scanner timings; body/output limits; outbound timeouts; private OCR URL, signing key path/kid, and disabled feature gates. Reuse existing RabbitMQ/DB settings. Keep auth keys out of health details; readiness reflects database and configured runtime dependencies without making liveness depend on them. Document key rotation, signing material ownership, broker outage recovery, and stale-lease recovery.
- [ ] Validate Compose using both files and run the exact test/build commands:

```powershell
docker compose -f compose.yml -f compose.dev.yml config --quiet
Set-Location services/workflow-service
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' test
.\mvnw.cmd -B '-Dstyle.color=never' verify
Set-Location ../workspace-service
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=WorkspaceHttpSecurityIntegrationTest,WorkspaceConnectionHttpIntegrationTest,InternalConnectionUseCasesTest,ConnectionUsageProtectionTest,WorkflowContractValidationTest' test
Set-Location ../../
pnpm --dir apps/web build
pnpm --dir apps/web lint
pnpm --dir apps/web test:e2e -- workflow-catalog-v1.spec.ts workflow-ui.spec.ts ocr-builder.spec.ts
git diff --check
```

- [ ] Run the smoke script against actual Workflow Service + Identity access token + Workspace + PostgreSQL + RabbitMQ. Capture response status, correlation ID, execution/version IDs, node state timeline, attempt counts, and controlled HTTP side-effect counts; redact all secrets. Verify Workspace refuses deletion while referenced, allows no-reference usage, and fails closed during Workflow outage. The partner owns the separate Gateway forwarding check.
- [ ] Run opt-in real Sheets smoke and real OCR URL smoke only when configured with approved test resources and OCR gates satisfied. OCR gate verification also includes the separately owned service's actual tests: `uv run pytest src/tests/unit -q`, `uv run ruff check src`, `uv lock --check`, with focused `test_http_api.py`, `test_extract_text_use_case.py`, `test_ocr_contract_schema.py`, `test_safe_url_fetcher.py`. Record exact results from its real execution environment; these commands have not been run by writing this plan.
- [ ] Document metrics/logs for execution admitted/claimed/completed/failed, pending outbox age, expired leases, attempts, provider timeout/rejection, and trigger scan failures with low-cardinality labels. Include the at-least-once external-side-effect limitation, schedule coalescing, republish webhook URL change, and external dependency readiness matrix.
- [ ] Review the whole integrated branch, enforce architecture/security/contract checks, update `docs/work_logs/K/YYYY-MM-DD-workflow-service-v1.md` using the template, and run complete GitNexus change detection against this checkout before the M4 commit. Report verified features, gates still closed, skipped live tests, migration compatibility, and commit SHA. Do not report all integrations ready if OCR/AI/Bot/Gmail prerequisites remain unavailable; do not push.

## Spec coverage and completion gates

| Spec section / acceptance | Owning tasks | Evidence required |
| --- | --- | --- |
| 1–3 architecture/foundation; acceptance 1–2 | 1, 4–7, 12 | ArchUnit and real resource/usage HTTP tests |
| 4 immutable persistence/lifecycle; acceptance 3–4 | 1, 5, 6, 8 | JSONB upgrade, concurrent publish, pinned execution, pause/resume tests |
| 5 catalog/configuration; acceptance 5 | 2, 15, 20 | Every allowed/rejected type, runtime typed config, browser palette/ports |
| 6 mapping; acceptance 6 | 3, 11 | Typed/null/nested/interpolation/upstream/unavailable-output tests |
| 7 APIs/errors | 4–8, 12, 17; partner-owned 19 | Service real HTTP and security/error contracts; partner verifies Gateway forwarding |
| 8 Workspace/usage; acceptance 10 | 4, 5, 7, 13, 14, 21 | Capability enforcement, strict client contract, no secret persistence, both user usage clarifications |
| 9 triggers; acceptance 9 | 6, 8, 15–17 | Cron/timezone/DST, multi-instance duplicate slots, secret/durable enqueue |
| 10 integrations; acceptance 11–12 | 13–15, 18 | Real supported adapters; disabled dependency failures; OCR production gate evidence |
| 11 engine/retries; acceptance 7–8 | 8–11 | Active-edge joins, bounded concurrency, persisted retry budget, crash/recovery, RabbitMQ/outbox |
| 12 security/operations | 4, 7, 13, 17–19, 21 | SSRF socket pinning, limits, no credential/endpoint leaks, wrong-tenant rejection |
| 13 overall V1 acceptance | 21 | Independent whole-branch review plus actual-stack evidence, with dependency gates stated |

The plan is complete when all spec requirements have an owning task, both user clarifications are reflected, named interfaces/paths are consistent, and verification commands match the repository. Implementation is complete only after the task checkboxes and milestone evidence exist; production integration readiness is separately conditional on the gates above.
