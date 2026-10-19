package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.valueobject.WorkflowStatus;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * List-view projection of a workflow: no draft definition or editor state, only the node types in it and the
 * non-trigger step types in run order (so a list can describe each workflow without loading its detail).
 */
public record WorkflowSummary(UUID id, String name, String description, WorkflowStatus status,
                              String schemaVersion, UUID currentVersionId, Instant createdAt,
                              Instant updatedAt, Instant publishedAt, List<String> nodeTypes,
                              List<String> stepTypes) {
    public WorkflowSummary {
        nodeTypes = List.copyOf(nodeTypes);
        stepTypes = List.copyOf(stepTypes);
    }

    /** A node's id and type as read from a draft; either may be null in a malformed draft. */
    public record NodeRef(String id, String type) {
    }

    /** An edge's endpoints as read from a draft; either may be null in a malformed draft. */
    public record Link(String source, String target) {
    }

    /**
     * Non-trigger node types in run order: breadth-first from the trigger nodes along the edges, then every node not
     * reached, in definition order. Same order as the web list's {@code orderedStepTypes}.
     */
    public static List<String> stepTypes(List<NodeRef> nodes, List<Link> links) {
        Map<String, String> typeById = new HashMap<>();
        for (NodeRef node : nodes) {
            if (node.id() != null) {
                typeById.put(node.id(), node.type());
            }
        }
        Map<String, List<String>> next = new HashMap<>();
        for (Link link : links) {
            if (link.source() != null && link.target() != null) {
                next.computeIfAbsent(link.source(), key -> new ArrayList<>()).add(link.target());
            }
        }
        ArrayDeque<String> queue = new ArrayDeque<>();
        for (NodeRef node : nodes) {
            if (node.id() != null && isTrigger(node.type())) {
                queue.add(node.id());
            }
        }
        Set<String> seen = new HashSet<>();
        List<String> types = new ArrayList<>();
        while (!queue.isEmpty()) {
            String id = queue.poll();
            if (!seen.add(id)) {
                continue;
            }
            addStep(types, typeById.get(id));
            queue.addAll(next.getOrDefault(id, List.of()));
        }
        for (NodeRef node : nodes) {
            if (node.id() == null || !seen.contains(node.id())) {
                addStep(types, node.type());
            }
        }
        return types;
    }

    private static boolean isTrigger(String type) {
        return type != null && type.startsWith("trigger.");
    }

    private static void addStep(List<String> types, String type) {
        if (type != null && !isTrigger(type)) {
            types.add(type);
        }
    }
}
