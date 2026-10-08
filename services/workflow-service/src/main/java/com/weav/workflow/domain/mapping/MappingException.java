package com.weav.workflow.domain.mapping;

/** A safe, non-retryable failure to parse or resolve workflow data mapping. */
public final class MappingException extends RuntimeException {
    public static final String CODE = "MAPPING_ERROR";

    private final String nodeId;
    private final String field;
    private final boolean missingValue;

    public MappingException(String message) {
        this(null, null, message);
    }

    public MappingException(String nodeId, String field, String message) {
        this(nodeId, field, message, false);
    }

    /** @param missingValue true when the referenced output or property does not exist (as opposed to a bad expression) */
    public MappingException(String nodeId, String field, String message, boolean missingValue) {
        super(message);
        this.nodeId = nodeId;
        this.field = field;
        this.missingValue = missingValue;
    }

    public boolean missingValue() {
        return missingValue;
    }

    public String code() {
        return CODE;
    }

    public String nodeId() {
        return nodeId;
    }

    public String field() {
        return field;
    }

    public boolean retryable() {
        return false;
    }

    MappingException withContext(String destinationNodeId, String destinationField) {
        if ((nodeId != null || destinationNodeId == null)
                && (field != null || destinationField == null)) {
            return this;
        }
        return new MappingException(
                nodeId == null ? destinationNodeId : nodeId,
                field == null ? destinationField : field,
                getMessage(), missingValue);
    }
}
