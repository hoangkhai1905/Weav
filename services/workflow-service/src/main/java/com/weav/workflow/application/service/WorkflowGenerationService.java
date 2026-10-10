package com.weav.workflow.application.service;

import com.weav.workflow.application.node.IntegrationReadiness;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.AiGenerationPort;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.exception.AiQuotaExceededException;
import com.weav.workflow.domain.exception.AiTimeoutException;
import com.weav.workflow.domain.exception.AiUnavailableException;
import com.weav.workflow.domain.exception.GenerationRateLimitedException;
import com.weav.workflow.domain.generation.IntentCompiler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.function.BooleanSupplier;

@Service
public class WorkflowGenerationService {
    private static final Set<String> QUESTION_CODES = Set.of("URL", "SCHEDULE", "TIMEZONE", "VALUE");
    private static final String ANSWERS_HEADER = "\n\nAnswers the user already gave (reuse the node ids that appear in the answer keys):\n";
    private static final Set<String> REASON_CODES = Set.of("CAPABILITY_UNAVAILABLE", "OUT_OF_SCOPE", "AMBIGUOUS_REQUEST");
    private final WorkspaceAuthorization authorization;
    private final WorkspaceConnectionPort connections;
    private final AiGenerationPort ai;
    private final GenerationRateLimiter rateLimiter;
    private final IntentCompiler compiler;
    private final BooleanSupplier enabled;

    @Autowired
    public WorkflowGenerationService(WorkspaceAuthorization authorization, WorkspaceConnectionPort connections,
                                     AiGenerationPort ai, GenerationRateLimiter rateLimiter,
                                     ScheduleValidationPort schedules,
                                     @Value("${weav.workflow.ai.generation-enabled:false}") boolean generationEnabled) {
        this(authorization, connections, ai, rateLimiter, new IntentCompiler(new DefinitionValidator(schedules)),
                () -> generationEnabled);
    }

    WorkflowGenerationService(WorkspaceAuthorization authorization, WorkspaceConnectionPort connections,
                              AiGenerationPort ai, GenerationRateLimiter rateLimiter, IntentCompiler compiler,
                              BooleanSupplier enabled) {
        this.authorization = authorization; this.connections = connections; this.ai = ai;
        this.rateLimiter = rateLimiter; this.compiler = compiler; this.enabled = enabled;
    }

    public Map<String, Object> generate(UUID workspaceId, UUID actorId, String prompt, String timezone,
                                        Map<String, UUID> picked) {
        return generate(workspaceId, actorId, prompt, timezone, picked, Map.of());
    }

    /** {@code answers}: the user's replies to earlier VALUE/URL/SCHEDULE/TIMEZONE questions, keyed by the question's field. */
    public Map<String, Object> generate(UUID workspaceId, UUID actorId, String prompt, String timezone,
                                        Map<String, UUID> picked, Map<String, String> answers) {
        if (!enabled.getAsBoolean()) throw new AiUnavailableException();
        if (!rateLimiter.tryAcquire(actorId, workspaceId)) throw new GenerationRateLimitedException();
        authorization.require(workspaceId, actorId, "WORKFLOW_CREATE");
        picked.values().forEach(id -> connections.authorizeAttachment(workspaceId, id, actorId));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("prompt", answers.isEmpty() ? prompt : prompt + ANSWERS_HEADER
                + answers.entrySet().stream().map(a -> "- " + a.getKey() + ": " + a.getValue())
                        .collect(java.util.stream.Collectors.joining("\n")));
        if (timezone != null) payload.put("timezone", timezone);
        payload.put("capabilities", capabilities());
        Map<String, Object> result;
        try { result = ai.generate(workspaceId, payload); }
        catch (NodeExecutor.Failure failure) {
            if ("AI_QUOTA_EXCEEDED".equals(failure.code())) throw new AiQuotaExceededException();
            if ("AI_TIMEOUT".equals(failure.code()) || "TIMEOUT".equals(failure.code())) throw new AiTimeoutException();
            // The model answered, but not with a usable workflow: tell the user to rephrase, not "unavailable".
            if ("AI_OUTPUT_INVALID".equals(failure.code())) return invalidIntent();
            throw new AiUnavailableException();
        }
        return switch (String.valueOf(result.get("status"))) {
            case "ready" -> switch (compiler.compile(result.get("intent"), picked, answers)) {
                case IntentCompiler.Ready ready -> ready(ready);
                case IntentCompiler.NeedsConnections needs -> Map.of("status", "needs_input", "questions",
                        needs.nodeTypes().stream().map(type -> Map.of("code", "CONNECTION", "field", type)).toList());
                case IntentCompiler.NeedsValues needs -> Map.of("status", "needs_input", "questions",
                        needs.missing().stream().map(m -> Map.of("code", "VALUE", "field", m.type() + "." + m.field())).toList());
                case IntentCompiler.Invalid ignored -> invalidIntent();
            };
            case "needs_input" -> codes(result.get("questions"), QUESTION_CODES, true)
                    .<Map<String, Object>>map(q -> Map.of("status", "needs_input", "questions", q)).orElseGet(WorkflowGenerationService::invalidIntent);
            case "unsupported" -> codes(result.get("reasons"), REASON_CODES, false)
                    .<Map<String, Object>>map(r -> Map.of("status", "unsupported", "reasons", r)).orElseGet(WorkflowGenerationService::invalidIntent);
            default -> invalidIntent();
        };
    }
    static List<Map<String,Object>> capabilities() {
        return NodeCatalog.supportedTypes().stream().sorted()
                .filter(t -> IntegrationReadiness.forType(t).configured())
                .map(t -> Map.<String,Object>of("type", t, "configFields", NodeCatalog.configFields(t).stream()
                        .filter(f -> !f.equals("connectionId") && !f.equals("schemaDescription")).sorted().toList())).toList();
    }
    private static Map<String,Object> ready(IntentCompiler.Ready ready) {
        Map<String,Object> layout = new LinkedHashMap<>();
        ready.layout().forEach((id,p) -> {
            Map<String,Object> entry = new LinkedHashMap<>(Map.of("x",p.x(),"y",p.y()));
            // N8: the web reads layout[nodeId].name as the step title; without one it labels the step by node type.
            if (ready.nodeNames().containsKey(id)) entry.put("name", ready.nodeNames().get(id));
            layout.put(id, entry);
        });
        Map<String,Object> out = new LinkedHashMap<>(); out.put("status","ready"); out.put("name",ready.name());
        out.put("definition",ready.definition()); out.put("layout",layout); return out;
    }
    private static Optional<List<Map<String,Object>>> codes(Object raw, Set<String> allowed, boolean field) {
        if (!(raw instanceof List<?> list) || list.isEmpty() || list.size() > 10) return Optional.empty();
        List<Map<String,Object>> out = new ArrayList<>();
        for (Object item:list) {
            if (!(item instanceof Map<?,?> map) || !(map.get("code") instanceof String code) || !allowed.contains(code)) return Optional.empty();
            if (!field) { out.add(Map.of("code",code)); continue; }
            if (!(map.get("field") instanceof String value) || value.isBlank() || value.length()>200) return Optional.empty();
            out.add(Map.of("code",code,"field",value));
        }
        return Optional.of(out);
    }
    private static Map<String,Object> invalidIntent() { return Map.of("status","unsupported","reasons",List.of(Map.of("code","INVALID_INTENT"))); }
}
