package com.weav.workflow.application.node;

import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.application.port.out.ControlBotStore.LastRun;
import com.weav.workflow.application.port.out.ControlBotStore.WorkflowRef;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunItem;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.MonitoringService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WeavWorkflowNodeExecutorTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID ACTOR = UUID.randomUUID();
    private static final UUID SELF = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-09T10:00:00Z");

    private final Set<String> capabilities = new HashSet<>(
            Set.of("WORKFLOW_RUN", "WORKFLOW_MANAGE_STATE", "WORKFLOW_MONITOR"));
    private final List<WorkflowRef> workflows = new ArrayList<>();
    private final ExecutionAdmissionPort admissionPort = mock(ExecutionAdmissionPort.class);
    private final MonitoringQueryPort queryPort = mock(MonitoringQueryPort.class);
    private final WorkflowPublicationService publication = mock(WorkflowPublicationService.class);
    private WeavWorkflowNodeExecutor executor;
    private WorkflowRef report;
    private UUID nodeExecutionId;
    private ExecutionTriggerType originTrigger = ExecutionTriggerType.TELEGRAM;
    private String originKey;
    private UUID publisher = ACTOR;
    private int workflowLookups;

    @BeforeEach
    void setUp() {
        report = new WorkflowRef(UUID.randomUUID(), "Báo cáo tuần", WorkflowStatus.PUBLISHED);
        workflows.clear();
        workflows.add(report);
        workflows.add(new WorkflowRef(SELF, "Bot điều khiển", WorkflowStatus.PUBLISHED));
        WorkspaceAccessPort access = (workspaceId, userId) ->
                new WorkspaceAccessPort.Access(workspaceId, userId, "MEMBER", capabilities);
        WorkspaceAuthorization authorization = new WorkspaceAuthorization(access);
        ExecutionAdmissionService admission = new ExecutionAdmissionService(
                authorization, admissionPort, JsonMapper.builder().build(), 1_048_576, 32);
        Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
        executor = new WeavWorkflowNodeExecutor(new FakeStore(), admission, publication,
                new MonitoringService(authorization, queryPort, clock), authorization, clock);
        nodeExecutionId = UUID.randomUUID();
        when(admissionPort.create(any())).thenAnswer(call -> new ExecutionAdmissionPort.Admission(
                UUID.randomUUID(), report.id(), UUID.randomUUID(), ExecutionStatus.QUEUED));
    }

    private NodeExecutor.Result execute(Map<String, Object> config) {
        return executor.execute(new NodeExecutor.Context(WORKSPACE, UUID.randomUUID(), nodeExecutionId, "control",
                1, "corr-1", null), config);
    }

    private NodeExecutor.Failure failure(Map<String, Object> config) {
        return assertThrows(NodeExecutor.Failure.class, () -> execute(config));
    }

    private Map<String, Object> command(String text) {
        return execute(Map.of("operation", "command", "text", text, "sender", "42",
                "allowedSenders", List.of("7", "42"))).output();
    }

    @Test
    void runAdmitsAsThePublisherWithAnIdempotencyKeyAndDoesNotWait() {
        Map<String, Object> output = execute(Map.of("operation", "run", "workflow", "  báo  CÁO tuần ",
                "input", Map.of("n", 1))).output();

        assertEquals("QUEUED", output.get("status"));
        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);
        verify(admissionPort).create(command.capture());
        assertEquals(ACTOR, command.getValue().actorId());
        assertEquals(report.id(), command.getValue().workflowId());
        assertEquals(ExecutionTriggerType.MANUAL, command.getValue().triggerType());
        assertEquals("wfctl-" + nodeExecutionId, command.getValue().idempotencyKey());
    }

    @Test
    void permissionDeniedFailsWithForbiddenAndIsNotRetried() {
        capabilities.remove("WORKFLOW_RUN");
        NodeExecutor.Failure denied = failure(Map.of("operation", "run", "workflow", "Báo cáo tuần"));
        assertEquals("FORBIDDEN", denied.code());
        assertFalse(denied.retryable());
        verify(admissionPort, never()).create(any());

        capabilities.remove("WORKFLOW_MONITOR");
        assertEquals("FORBIDDEN", failure(Map.of("operation", "status", "workflow", "Báo cáo tuần")).code());
        assertEquals("FORBIDDEN", failure(Map.of("operation", "list_failures")).code());

        when(publication.pause(WORKSPACE, report.id(), ACTOR)).thenThrow(new ForbiddenException());
        assertEquals("FORBIDDEN", failure(Map.of("operation", "pause", "workflow", "Báo cáo tuần")).code());
    }

    @Test
    void aWorkflowCannotRunOrPauseItself() {
        assertEquals("SELF_REFERENCE", failure(Map.of("operation", "run", "workflow", SELF.toString())).code());
        assertEquals("SELF_REFERENCE", failure(Map.of("operation", "pause", "workflow", "bot ĐIỀU khiển")).code());
        verify(admissionPort, never()).create(any());
        verify(publication, never()).pause(any(), any(), any());
    }

    @Test
    void namesMatchIgnoringCaseSpacesAndDiacriticNormalisationButNotDiacritics() {
        assertEquals(report.id(), executor.resolve(WORKSPACE, "báo cáo  tuần").id());
        assertEquals(report.id(), executor.resolve(WORKSPACE, "BÁO CÁO TUẦN").id());
        // decomposed (NFD) input matches the composed stored name
        assertEquals(report.id(), executor.resolve(WORKSPACE,
                java.text.Normalizer.normalize("Báo cáo tuần", java.text.Normalizer.Form.NFD)).id());
        assertEquals("WORKFLOW_NOT_FOUND", failure(Map.of("operation", "status", "workflow", "Bao cao tuan")).code());
        assertEquals(report.id(), executor.resolve(WORKSPACE, report.id().toString().toUpperCase()).id());
    }

    @Test
    void twoWorkflowsWithTheSameNameAreAmbiguousAndListedUpToFive() {
        for (int i = 0; i < 6; i++) {
            workflows.add(new WorkflowRef(UUID.randomUUID(), "Báo cáo tuần", WorkflowStatus.PAUSED));
        }
        NodeExecutor.Failure ambiguous = failure(Map.of("operation", "status", "workflow", "báo cáo tuần"));
        assertEquals("AMBIGUOUS_WORKFLOW", ambiguous.code());
        assertEquals(5, ambiguous.safeMessage().split("\\(", -1).length - 1);
    }

    @Test
    void pauseAndResumeReturnTheNewPublicStatus() {
        when(publication.pause(WORKSPACE, report.id(), ACTOR)).thenReturn(stored(WorkflowStatus.PAUSED));
        when(publication.resume(WORKSPACE, report.id(), ACTOR)).thenReturn(stored(WorkflowStatus.PUBLISHED));

        assertEquals("PAUSED", execute(Map.of("operation", "pause", "workflow", "Báo cáo tuần")).output().get("status"));
        assertEquals("ACTIVE", execute(Map.of("operation", "resume", "workflow", "Báo cáo tuần")).output().get("status"));
    }

    @Test
    void statusReportsLastRunAndSuccessRate() {
        Map<String, Object> output = execute(Map.of("operation", "status", "workflow", "Báo cáo tuần")).output();

        assertEquals(report.id().toString(), output.get("workflowId"));
        assertEquals("ACTIVE", output.get("status"));
        Map<?, ?> lastRun = (Map<?, ?>) output.get("lastRun");
        assertEquals("FAILED", lastRun.get("status"));
        assertEquals("2026-10-09T09:00:00Z", lastRun.get("finishedAt"));
        assertEquals(0.75, output.get("successRate7d"));
        // a workflow that never finished a run has no lastRun
        workflows.add(new WorkflowRef(UUID.randomUUID(), "Mới", WorkflowStatus.DRAFT));
        Map<String, Object> fresh = execute(Map.of("operation", "status", "workflow", "mới")).output();
        assertNull(fresh.get("lastRun"));
        assertEquals("DRAFT", fresh.get("status"));
    }

    @Test
    void listFailuresUsesTheMonitoringQueryAndTheLimit() {
        RunItem item = new RunItem(UUID.randomUUID(), report.id(), report.name(), ExecutionStatus.FAILED,
                ExecutionTriggerType.SCHEDULE, NOW, NOW, NOW, "HTTP_TIMEOUT", "timed out");
        when(queryPort.history(any(), any(), anyInt(), anyInt())).thenReturn(
                new MonitoringQueryPort.RunPage(List.of(item), 0, 3, 1));

        Map<String, Object> output = execute(Map.of("operation", "list_failures", "limit", "3")).output();

        List<?> items = (List<?>) output.get("items");
        assertEquals(1, items.size());
        assertEquals("HTTP_TIMEOUT", ((Map<?, ?>) items.getFirst()).get("errorCode"));
        ArgumentCaptor<MonitoringQueryPort.RunFilter> filter = ArgumentCaptor.forClass(MonitoringQueryPort.RunFilter.class);
        verify(queryPort).history(eq(WORKSPACE), filter.capture(), eq(0), eq(3));
        assertEquals(ExecutionStatus.FAILED, filter.getValue().status());
        assertNull(filter.getValue().workflowId());
        assertEquals("CONFIGURATION_ERROR", failure(Map.of("operation", "list_failures", "limit", 21)).code());
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "/run Báo cáo tuần|true|Đã xếp lịch chạy",
            "/RUN  báo   cáo TUẦN |true|Đã xếp lịch chạy",
            "/status@WeavBot Báo cáo tuần|true|Quy trình",
            "/failures|true|Không có lần chạy lỗi",
            "/failures Báo cáo tuần|true|Không có lần chạy lỗi",
            "/help|true|Các lệnh",
            "hello|false|Các lệnh",
            "/dance|false|không tồn tại",
            "/pause|false|Thiếu tên",
            "/run Không có|false|Không tìm thấy",
            "/run Bot điều khiển|false|chính quy trình",
    })
    void commandAlwaysAnswersAndNeverFailsTheNode(String text, boolean ok, String replyContains) {
        when(queryPort.history(any(), any(), anyInt(), anyInt())).thenReturn(
                new MonitoringQueryPort.RunPage(List.of(), 0, 5, 0));

        Map<String, Object> output = command(text);

        assertEquals(ok, output.get("ok"), text);
        String reply = (String) output.get("reply");
        assertTrue(reply.contains(replyContains), reply);
        assertTrue(reply.length() <= 1000);
    }

    @Test
    void commandRepliesInsteadOfFailingWhenTheOperationIsDenied() {
        capabilities.remove("WORKFLOW_RUN");
        Map<String, Object> output = command("/run Báo cáo tuần");
        assertEquals(false, output.get("ok"));
        assertTrue(((String) output.get("reply")).contains("quyền"));
    }

    @Test
    void runsInsideAWorkflowEventChainAreMarkedSoTheirFailuresNeverFireEvents() {
        ArgumentCaptor<ExecutionAdmissionPort.Command> command = ArgumentCaptor.forClass(ExecutionAdmissionPort.Command.class);

        originTrigger = ExecutionTriggerType.WORKFLOW_EVENT;
        execute(Map.of("operation", "run", "workflow", "Báo cáo tuần"));
        originTrigger = ExecutionTriggerType.MANUAL;
        originKey = "wfctl-chain-" + UUID.randomUUID();
        execute(Map.of("operation", "run", "workflow", "Báo cáo tuần"));
        originTrigger = ExecutionTriggerType.TELEGRAM;
        originKey = "wfctl-" + UUID.randomUUID();
        execute(Map.of("operation", "run", "workflow", "Báo cáo tuần"));

        verify(admissionPort, org.mockito.Mockito.times(3)).create(command.capture());
        assertEquals("wfctl-chain-" + nodeExecutionId, command.getAllValues().get(0).idempotencyKey());
        assertEquals("wfctl-chain-" + nodeExecutionId, command.getAllValues().get(1).idempotencyKey());
        assertEquals("wfctl-" + nodeExecutionId, command.getAllValues().get(2).idempotencyKey());
    }

    @Test
    void capabilityIsCheckedBeforeTheTargetIsResolved() {
        capabilities.clear();
        for (String operation : List.of("run", "pause", "resume", "status", "list_failures")) {
            NodeExecutor.Failure denied = failure(Map.of("operation", operation, "workflow", "Không tồn tại"));
            assertEquals("FORBIDDEN", denied.code(), operation);
        }
        assertEquals(0, workflowLookups, "no name lookup for an unauthorised caller");
        Map<String, Object> reply = command("/status Không tồn tại");
        assertEquals(false, reply.get("ok"));
        assertTrue(((String) reply.get("reply")).contains("quyền"));
        assertEquals(0, workflowLookups);
    }

    @Test
    void ambiguousCommandReplyNamesNoIds() {
        workflows.add(new WorkflowRef(UUID.randomUUID(), "Báo cáo tuần", WorkflowStatus.PAUSED));
        Map<String, Object> output = command("/status báo cáo tuần");
        assertEquals(false, output.get("ok"));
        String reply = (String) output.get("reply");
        assertTrue(reply.contains("trùng tên"));
        assertFalse(reply.matches("(?s).*[0-9a-f]{8}-[0-9a-f]{4}-.*"), reply);
    }

    @Test
    void commandIsRefusedForSendersOutsideTheAllowListBeforeAnyLookup() {
        for (Map<String, Object> config : List.<Map<String, Object>>of(
                Map.of("operation", "command", "text", "/run Báo cáo tuần", "sender", "99", "allowedSenders", List.of("42")),
                Map.of("operation", "command", "text", "/run Báo cáo tuần", "allowedSenders", List.of("42")),
                Map.of("operation", "command", "text", "/run Báo cáo tuần", "sender", "42"),
                Map.of("operation", "command", "text", "/run Báo cáo tuần", "sender", "42", "allowedSenders", List.of()))) {
            Map<String, Object> output = execute(config).output();
            assertEquals(false, output.get("ok"));
            assertEquals("Bạn không có quyền điều khiển quy trình.", output.get("reply"));
        }
        assertEquals(0, workflowLookups);
        verify(admissionPort, never()).create(any());
    }

    @Test
    void anAllowedSenderMayControlAndNumericIdsMatchTextEntries() {
        Map<String, Object> output = execute(Map.of("operation", "command", "text", "/run Báo cáo tuần",
                "sender", 42L, "allowedSenders", List.of(" 42 "))).output();
        assertEquals(true, output.get("ok"));
        verify(admissionPort).create(any());
    }

    @Test
    void otherOperationsIgnoreTheAllowList() {
        assertEquals("QUEUED", execute(Map.of("operation", "run", "workflow", "Báo cáo tuần", "sender", "99",
                "allowedSenders", List.of("1"))).output().get("status"));
    }

    @Test
    void aVersionWithoutPublisherFailsForbiddenWithoutRetry() {
        publisher = null;
        NodeExecutor.Failure failure = failure(Map.of("operation", "status", "workflow", "Báo cáo tuần"));
        assertEquals("FORBIDDEN", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void longRepliesAreCutOnALineBoundary() {
        String line = "1. " + "w".repeat(100) + " - HTTP_TIMEOUT (2026-10-09 10:00 UTC)\n";
        String cut = WeavWorkflowNodeExecutor.capOnBoundary(line.repeat(20), 1000);
        assertTrue(cut.length() <= 1000);
        assertTrue(cut.endsWith(")…"), cut.substring(cut.length() - 20));
        assertEquals("kết thúc", WeavWorkflowNodeExecutor.capOnBoundary("kết thúc", 1000));
    }

    @Test
    void aVeryLongReplyIsCappedAtOneThousandCharacters() {
        workflows.add(new WorkflowRef(UUID.randomUUID(), "x".repeat(255), WorkflowStatus.PUBLISHED));
        Map<String, Object> output = command("/status " + "x".repeat(255));
        assertTrue(((String) output.get("reply")).length() <= 1000);
    }

    private Workflow stored(WorkflowStatus status) {
        Instant at = Instant.parse("2026-10-01T00:00:00Z");
        return new Workflow(report.id(), WORKSPACE, report.name(), null, status, "1.0", Map.of(), null,
                UUID.randomUUID(), ACTOR, at, at, at, null, null);
    }

    private final class FakeStore implements ControlBotStore {
        @Override
        public Optional<RunOrigin> runOrigin(UUID executionId) {
            return Optional.of(new RunOrigin(executionId, SELF, WORKSPACE, publisher, originTrigger, originKey));
        }

        @Override
        public List<WorkflowRef> workflows(UUID workspaceId) {
            workflowLookups++;
            return List.copyOf(workflows);
        }

        @Override
        public Set<UUID> existingWorkflowIds(UUID workspaceId, Set<UUID> ids) {
            return Set.of();
        }

        @Override
        public Optional<LastRun> lastFinishedRun(UUID workflowId) {
            return workflowId.equals(report.id())
                    ? Optional.of(new LastRun(UUID.randomUUID(), ExecutionStatus.FAILED,
                    Instant.parse("2026-10-09T09:00:00Z")))
                    : Optional.empty();
        }

        @Override
        public Double successRate(UUID workflowId, Instant since) {
            assertEquals(NOW.minusSeconds(7 * 86400L), since);
            return 0.75;
        }

        @Override
        public Optional<FinishedSource> finishedSource(UUID executionId) {
            return Optional.empty();
        }

        @Override
        public List<EventListener> eventListeners(UUID workspaceId) {
            return List.of();
        }
    }
}
