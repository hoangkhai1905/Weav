package com.weav.workflow.presentation.http.request;

import com.weav.workflow.domain.definition.NodeCatalog;
import com.weav.workflow.domain.exception.BadRequestException;
import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;

public record GenerateWorkflowRequest(String prompt, String timezone, Map<String, UUID> connections,
                                      Map<String, String> answers) {
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
        if (answers != null) {
            int total = prompt.codePointCount(0, prompt.length());
            for (Map.Entry<String, String> answer : answers.entrySet()) {
                if (answer.getKey() == null || answer.getKey().isBlank() || answer.getKey().length() > 200
                        || answer.getValue() == null || answer.getValue().isBlank()) {
                    throw new BadRequestException("answers must map a question to a non-empty text");
                }
                total += answer.getKey().length() + answer.getValue().codePointCount(0, answer.getValue().length()) + 6;
            }
            // The answers ride along with the prompt to the AI, whose input limit is 4000 characters.
            if (answers.size() > 10 || total > 3900) {
                throw new BadRequestException("answers are too long");
            }
        }
    }
}
