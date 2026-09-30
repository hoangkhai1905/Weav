package com.weav.workflow.presentation.http.request;

import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.exception.BadRequestException;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;

public record GenerateWorkflowRequest(String prompt, String timezone, Map<String, UUID> connections) {
    public void validate() {
        if (prompt == null || prompt.isBlank() || prompt.codePointCount(0, prompt.length()) > 4000) {
            throw new BadRequestException("prompt must be 1-4000 characters");
        }
        if (timezone != null) {
            try {
                ZoneId.of(timezone);
            } catch (DateTimeException exception) {
                throw new BadRequestException("timezone must be an IANA zone");
            }
        }
        if (connections != null && (connections.size() > 10 || connections.entrySet().stream().anyMatch(entry ->
                entry.getValue() == null || !NodeCatalog.configFields(entry.getKey()).contains("connectionId")))) {
            throw new BadRequestException("connections must map connection-capable node types to connection IDs");
        }
    }
}
