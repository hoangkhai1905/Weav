package com.weav.workflow.application.node;

import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.application.port.out.ControlBotStore.RunOrigin;
import com.weav.workflow.application.port.out.ControlBotStore.WorkflowRef;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunItem;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.MonitoringService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.exception.WeavException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * weav.workflow: lets a workflow run, pause, resume and inspect other workflows of its workspace, or answer a chat
 * command. It acts as the user who published the executing version and goes through the same services (and so the
 * same capability checks, quotas and idempotency) as the HTTP API.
 */
@Component
public final class WeavWorkflowNodeExecutor implements NodeExecutor {
    static final String TYPE = "weav.workflow";
    private static final String MONITOR_CAPABILITY = "WORKFLOW_MONITOR";
    private static final String RUN_CAPABILITY = "WORKFLOW_RUN";
    private static final String STATE_CAPABILITY = "WORKFLOW_MANAGE_STATE";
    /** Key prefix of runs started by this node; {@code wfctl-chain-} marks runs inside a workflow-event chain. */
    public static final String KEY_PREFIX = "wfctl-";
    public static final String CHAIN_KEY_PREFIX = "wfctl-chain-";
    static final String SENDER_REFUSED = "Bạn không có quyền điều khiển quy trình.";
    private static final int DEFAULT_LIMIT = 5;
    private static final int MAX_LIMIT = 20;
    private static final int MAX_CANDIDATES = 5;
    static final int MAX_REPLY = 1000;
    private static final int MAX_NAME_ECHO = 100;
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");
    private static final Pattern UUID_TEXT = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'")
            .withZone(ZoneOffset.UTC);
    private static final Set<String> OPERATIONS = Set.of("run", "pause", "resume", "status", "list_failures", "command");

    private final ControlBotStore store;
    private final ExecutionAdmissionService admission;
    private final WorkflowPublicationService publication;
    private final MonitoringService monitoring;
    private final WorkspaceAuthorization authorization;
    private final Clock clock;

    public WeavWorkflowNodeExecutor(
            ControlBotStore store, ExecutionAdmissionService admission, WorkflowPublicationService publication,
            MonitoringService monitoring, WorkspaceAuthorization authorization,
            @Qualifier("workflowExecutionClock") Clock clock) {
        this.store = Objects.requireNonNull(store);
        this.admission = Objects.requireNonNull(admission);
        this.publication = Objects.requireNonNull(publication);
        this.monitoring = Objects.requireNonNull(monitoring);
        this.authorization = Objects.requireNonNull(authorization);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> config) {
        Objects.requireNonNull(context, "context must not be null");
        if (config == null || !(config.get("operation") instanceof String operation)
                || !OPERATIONS.contains(operation)) {
            throw Failure.invalidField("operation", "must be run, pause, resume, status, list_failures or command.");
        }
        if ("command".equals(operation) && !senderAllowed(config)) {
            return new Result(reply(new LinkedHashMap<>(), false, SENDER_REFUSED), null);
        }
        RunOrigin origin = store.runOrigin(context.executionId())
                .filter(found -> found.workspaceId().equals(context.workspaceId()))
                .orElseThrow(() -> new Failure("RUN_NOT_FOUND", "The running execution could not be found.", false));
        if (origin.publishedBy() == null) {
            throw new Failure("FORBIDDEN", "This workflow version has no publisher to act as.", false);
        }
        Call call = new Call(context, origin);
        if ("command".equals(operation)) {
            return new Result(command(call, text(config.get("text"))), null);
        }
        try {
            return new Result(operate(call, operation, config), null);
        } catch (RuntimeException exception) {
            throw asFailure(exception);
        }
    }

    /** Everything one invocation needs: the executing run and the user it acts as. */
    private record Call(Context context, RunOrigin origin) {
        UUID workspaceId() {
            return context.workspaceId();
        }

        UUID actor() {
            return origin.publishedBy();
        }
    }

    // ---- operations ----

    private Map<String, Object> operate(Call call, String operation, Map<String, Object> config) {
        // Authorise first: an unauthorised caller must not learn which workflow names exist.
        authorization.require(call.workspaceId(), call.actor(), capability(operation));
        return switch (operation) {
            case "run" -> run(call, target(call, config.get("workflow")), config.get("input"));
            case "pause" -> changeState(call, target(call, config.get("workflow")), true);
            case "resume" -> changeState(call, target(call, config.get("workflow")), false);
            case "status" -> status(call, target(call, config.get("workflow")));
            case "list_failures" -> listFailures(call, optionalTarget(call, config.get("workflow")),
                    limit(config.get("limit")));
            default -> throw Failure.invalidField("operation", "is not supported.");
        };
    }

    private Map<String, Object> run(Call call, WorkflowRef target, Object input) {
        if (target.id().equals(call.origin().workflowId())) {
            throw selfReference("run");
        }
        if (input != null && !(input instanceof Map<?, ?>)) {
            throw Failure.invalidField("input", "must be an object.");
        }
        ExecutionAdmissionPort.Admission admitted = admission.manual(call.workspaceId(), target.id(), call.actor(),
                input == null ? Map.of() : input, call.context().correlationId(), call.context().traceparent(),
                admissionKey(call.origin(), call.context().nodeExecutionId()));
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("executionId", admitted.executionId().toString());
        output.put("status", "QUEUED");
        output.put("workflowId", target.id().toString());
        output.put("workflowName", target.name());
        return output;
    }

    /** Idempotency key of a run started by this node; chain-marked when the starting run is itself chained. */
    public static String admissionKey(RunOrigin origin, UUID nodeExecutionId) {
        return (chained(origin) ? CHAIN_KEY_PREFIX : KEY_PREFIX) + nodeExecutionId;
    }

    /** A run started by a workflow event, or by a bot step inside such a chain, must not start unmarked runs. */
    private static boolean chained(RunOrigin origin) {
        return origin.triggerType() == ExecutionTriggerType.WORKFLOW_EVENT
                || origin.idempotencyKey() != null && origin.idempotencyKey().startsWith(CHAIN_KEY_PREFIX);
    }

    private static boolean senderAllowed(Map<String, Object> config) {
        String sender = text(config.get("sender"));
        if (sender == null || sender.isBlank() || !(config.get("allowedSenders") instanceof List<?> allowed)) {
            return false;
        }
        String wanted = sender.strip();
        return allowed.stream().map(WeavWorkflowNodeExecutor::text)
                .anyMatch(entry -> entry != null && wanted.equals(entry.strip()));
    }

    private static String capability(String operation) {
        return switch (operation) {
            case "run" -> RUN_CAPABILITY;
            case "pause", "resume" -> STATE_CAPABILITY;
            default -> MONITOR_CAPABILITY;
        };
    }

    private Map<String, Object> changeState(Call call, WorkflowRef target, boolean pause) {
        if (pause && target.id().equals(call.origin().workflowId())) {
            throw selfReference("pause");
        }
        Workflow changed = pause
                ? publication.pause(call.workspaceId(), target.id(), call.actor())
                : publication.resume(call.workspaceId(), target.id(), call.actor());
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("workflowId", target.id().toString());
        output.put("name", target.name());
        output.put("status", publicStatus(changed.getStatus()));
        return output;
    }

    private Map<String, Object> status(Call call, WorkflowRef target) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("workflowId", target.id().toString());
        output.put("name", target.name());
        output.put("status", publicStatus(target.status()));
        output.put("lastRun", store.lastFinishedRun(target.id()).map(last -> {
            Map<String, Object> run = new LinkedHashMap<>();
            run.put("executionId", last.executionId().toString());
            run.put("status", last.status().name());
            run.put("finishedAt", last.finishedAt() == null ? null : last.finishedAt().toString());
            return (Object) run;
        }).orElse(null));
        output.put("successRate7d", store.successRate(target.id(), clock.instant().minus(Duration.ofDays(7))));
        return output;
    }

    private Map<String, Object> listFailures(Call call, WorkflowRef target, int limit) {
        List<RunItem> runs = monitoring.history(call.workspaceId(), call.actor(), ExecutionStatus.FAILED,
                target == null ? null : target.id(), null, null, 0, limit).items();
        List<Map<String, Object>> items = new ArrayList<>();
        for (RunItem run : runs) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("workflowId", run.workflowId().toString());
            item.put("workflowName", run.workflowName());
            item.put("executionId", run.executionId().toString());
            item.put("finishedAt", run.finishedAt() == null ? null : run.finishedAt().toString());
            item.put("errorCode", run.errorCode());
            item.put("errorMessage", run.errorMessage());
            items.add(item);
        }
        return Map.of("items", items);
    }

    // ---- target resolution ----

    private WorkflowRef optionalTarget(Call call, Object value) {
        return value == null || value instanceof String text && text.isBlank() ? null : target(call, value);
    }

    private WorkflowRef target(Call call, Object value) {
        String text = text(value);
        if (text == null || text.isBlank()) {
            throw Failure.invalidField("workflow", "is required for this operation.");
        }
        return resolve(call.workspaceId(), text);
    }

    /** A workflow id, or a name matched trimmed, whitespace-collapsed, NFC-normalised and case-insensitively. */
    WorkflowRef resolve(UUID workspaceId, String reference) {
        List<WorkflowRef> workflows = store.workflows(workspaceId);
        String trimmed = reference.strip();
        if (UUID_TEXT.matcher(trimmed).matches()) {
            UUID id = UUID.fromString(trimmed);
            for (WorkflowRef workflow : workflows) {
                if (workflow.id().equals(id)) {
                    return workflow;
                }
            }
        }
        String wanted = normalize(trimmed);
        List<WorkflowRef> matches = workflows.stream().filter(w -> normalize(w.name()).equals(wanted)).toList();
        if (matches.isEmpty()) {
            throw new Failure("WORKFLOW_NOT_FOUND", "No workflow matches the given name or id.", false);
        }
        if (matches.size() > 1) {
            String candidates = String.join("; ", matches.stream().limit(MAX_CANDIDATES)
                    .map(w -> w.name() + " (" + w.id() + ")").toList());
            throw new Failure("AMBIGUOUS_WORKFLOW",
                    "Several workflows have this name: " + candidates + ". Use the workflow id.", false);
        }
        return matches.getFirst();
    }

    static String normalize(String name) {
        return WHITESPACE.matcher(Normalizer.normalize(name, Normalizer.Form.NFC).strip()).replaceAll(" ")
                .toLowerCase(Locale.ROOT);
    }

    // ---- chat command ----

    private Map<String, Object> command(Call call, String rawText) {
        String text = rawText == null ? "" : rawText.strip();
        Map<String, Object> output = new LinkedHashMap<>();
        if (!text.startsWith("/")) {
            return reply(output, false, "Mình chưa hiểu tin nhắn này.\n" + help());
        }
        String[] parts = WHITESPACE.split(text, 2);
        String word = parts[0].substring(1).toLowerCase(Locale.ROOT);
        int at = word.indexOf('@'); // Telegram appends the bot name in groups: /status@MyBot
        if (at >= 0) {
            word = word.substring(0, at);
        }
        String name = parts.length > 1 ? parts[1].strip() : "";
        if (word.equals("help") || word.equals("start")) {
            return reply(output, true, help());
        }
        String operation = switch (word) {
            case "run" -> "run";
            case "pause" -> "pause";
            case "resume" -> "resume";
            case "status" -> "status";
            case "failures" -> "list_failures";
            default -> null;
        };
        if (operation == null) {
            return reply(output, false, "Lệnh /" + cap(word, 30) + " không tồn tại.\n" + help());
        }
        if (name.isEmpty() && !operation.equals("list_failures")) {
            return reply(output, false, "Thiếu tên quy trình. Ví dụ: /" + word + " Báo cáo tuần");
        }
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("workflow", name);
        try {
            Map<String, Object> result = operate(call, operation, config);
            output.putAll(result);
            return reply(output, true, successReply(operation, result));
        } catch (RuntimeException exception) {
            Failure failure = asFailure(exception);
            return reply(output, false, failureReply(failure, name));
        }
    }

    private static Map<String, Object> reply(Map<String, Object> output, boolean ok, String reply) {
        output.put("ok", ok);
        output.put("reply", capOnBoundary(reply, MAX_REPLY));
        return output;
    }

    private String successReply(String operation, Map<String, Object> result) {
        return switch (operation) {
            case "run" -> "Đã xếp lịch chạy quy trình \"" + cap(String.valueOf(result.get("workflowName")), MAX_NAME_ECHO)
                    + "\". Mã lần chạy: " + result.get("executionId");
            case "pause" -> "Đã tạm dừng quy trình \"" + cap(String.valueOf(result.get("name")), MAX_NAME_ECHO) + "\".";
            case "resume" -> "Đã tiếp tục quy trình \"" + cap(String.valueOf(result.get("name")), MAX_NAME_ECHO) + "\".";
            case "status" -> statusReply(result);
            default -> failuresReply(result);
        };
    }

    private static String statusReply(Map<String, Object> result) {
        StringBuilder text = new StringBuilder("Quy trình \"").append(cap(String.valueOf(result.get("name")), MAX_NAME_ECHO))
                .append("\": ").append(switch (String.valueOf(result.get("status"))) {
                    case "ACTIVE" -> "đang hoạt động";
                    case "PAUSED" -> "đang tạm dừng";
                    default -> "bản nháp";
                }).append('.');
        if (result.get("lastRun") instanceof Map<?, ?> last) {
            text.append(" Lần chạy gần nhất: ")
                    .append("FAILED".equals(last.get("status")) ? "thất bại" : "thành công");
            if (last.get("finishedAt") instanceof String finished) {
                text.append(" lúc ").append(TIME.format(Instant.parse(finished)));
            }
            text.append('.');
        } else {
            text.append(" Chưa có lần chạy nào hoàn tất.");
        }
        if (result.get("successRate7d") instanceof Number rate) {
            text.append(" Tỷ lệ thành công 7 ngày: ").append(Math.round(rate.doubleValue() * 100)).append('%');
        }
        return text.toString();
    }

    private static String failuresReply(Map<String, Object> result) {
        List<?> items = (List<?>) result.get("items");
        if (items.isEmpty()) {
            return "Không có lần chạy lỗi gần đây.";
        }
        StringBuilder text = new StringBuilder("Các lần chạy lỗi gần đây:");
        int index = 1;
        for (Object entry : items) {
            Map<?, ?> item = (Map<?, ?>) entry;
            text.append('\n').append(index++).append(". ").append(cap(String.valueOf(item.get("workflowName")), MAX_NAME_ECHO));
            if (item.get("errorCode") != null) {
                text.append(" - ").append(item.get("errorCode"));
            }
            if (item.get("finishedAt") instanceof String finished) {
                text.append(" (").append(TIME.format(Instant.parse(finished))).append(')');
            }
        }
        return text.toString();
    }

    private static String failureReply(Failure failure, String name) {
        String shown = cap(name, MAX_NAME_ECHO);
        return switch (failure.code()) {
            case "FORBIDDEN" -> "Bạn không có quyền thực hiện lệnh này.";
            case "WORKFLOW_NOT_FOUND" -> "Không tìm thấy quy trình \"" + shown + "\".";
            case "AMBIGUOUS_WORKFLOW" -> "Có nhiều quy trình trùng tên \"" + shown
                    + "\". Hãy đổi tên để chúng khác nhau, hoặc dùng mã quy trình trong cấu hình.";
            case "SELF_REFERENCE" -> "Không thể thao tác lên chính quy trình đang chạy bot này.";
            case "INVALID_STATE" -> "Không thực hiện được: " + failure.safeMessage();
            case "DEPENDENCY_UNAVAILABLE" -> "Dịch vụ tạm thời không khả dụng, hãy thử lại sau.";
            default -> "Không thực hiện được lệnh (" + failure.code() + ").";
        };
    }

    private static String help() {
        return "Các lệnh: /run <tên>, /pause <tên>, /resume <tên>, /status <tên>, /failures [tên], /help";
    }

    // ---- helpers ----

    private static Failure selfReference(String operation) {
        return new Failure("SELF_REFERENCE",
                "A workflow cannot " + operation + " itself through weav.workflow.", false);
    }

    private static Failure asFailure(RuntimeException exception) {
        if (exception instanceof Failure failure) {
            return failure;
        }
        if (exception instanceof ForbiddenException) {
            return new Failure("FORBIDDEN", "The publisher of this workflow is not allowed to do this.", false);
        }
        if (exception instanceof WorkspaceDependencyUnavailableException) {
            return new Failure("DEPENDENCY_UNAVAILABLE", "The workspace service is unavailable.", true, true);
        }
        if (exception instanceof ResourceNotFoundException) {
            return new Failure("WORKFLOW_NOT_FOUND", "The workflow was not found.", false);
        }
        if (exception instanceof WeavException weav) {
            return new Failure(weav.getCode(), weav.getMessage(), false);
        }
        return new Failure("DEPENDENCY_UNAVAILABLE", "The operation could not be completed.", true);
    }

    private static String text(Object value) {
        return value instanceof String text ? text
                : value instanceof Number || value instanceof Boolean ? String.valueOf(value) : null;
    }

    private static int limit(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return DEFAULT_LIMIT;
        }
        try {
            int limit = new java.math.BigDecimal(value instanceof String text ? text.strip() : value.toString())
                    .intValueExact();
            if (limit >= 1 && limit <= MAX_LIMIT) {
                return limit;
            }
        } catch (ArithmeticException | NumberFormatException exception) {
            // falls through to the configuration failure
        }
        throw Failure.invalidField("limit", "must be a whole number from 1 to 20.");
    }

    /** Cuts at a line or word boundary so no id or name is left half-written. */
    static String capOnBoundary(String value, int max) {
        if (value.length() <= max) {
            return value;
        }
        String head = value.substring(0, max - 1);
        int newline = head.lastIndexOf('\n');
        int cut = newline > 0 ? newline : head.lastIndexOf(' ');
        return (cut > 0 ? head.substring(0, cut) : head).stripTrailing() + "…";
    }

    private static String cap(String value, int max) {
        String clean = value == null ? "" : value.replaceAll("[\\p{Cntrl}&&[^\\n]]", " ");
        return clean.length() <= max ? clean : clean.substring(0, max - 1) + "…";
    }

    private static String publicStatus(WorkflowStatus status) {
        return switch (status) {
            case PUBLISHED -> "ACTIVE";
            case PAUSED -> "PAUSED";
            case DRAFT -> "DRAFT";
        };
    }
}
