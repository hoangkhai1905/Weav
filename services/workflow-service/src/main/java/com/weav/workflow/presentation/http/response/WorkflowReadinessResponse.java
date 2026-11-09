package com.weav.workflow.presentation.http.response;

import com.weav.workflow.application.service.WorkflowPublicationService;

import java.util.List;

/** Publish blockers of a draft; carries no message text, clients map {@code code} to wording. */
public record WorkflowReadinessResponse(boolean ready, List<Issue> issues) {

    public record Issue(String nodeId, String field, String code) {
    }

    public static WorkflowReadinessResponse from(WorkflowPublicationService.Readiness readiness) {
        return new WorkflowReadinessResponse(readiness.ready(), readiness.issues().stream()
                .map(issue -> new Issue(issue.nodeId(), issue.field(), issue.code())).toList());
    }
}
