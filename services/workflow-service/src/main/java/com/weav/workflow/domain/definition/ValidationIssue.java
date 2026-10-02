package com.weav.workflow.domain.definition;

/** A safe, node- and field-addressable definition validation diagnostic. */
public record ValidationIssue(String nodeId, String field, String code, String message) {
}
