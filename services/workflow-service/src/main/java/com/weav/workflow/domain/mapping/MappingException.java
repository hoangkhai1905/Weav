package com.weav.workflow.domain.mapping;

/** A safe, non-retryable failure to parse or resolve workflow data mapping. */
public final class MappingException extends RuntimeException {
    public static final String CODE = "MAPPING_ERROR";

    private final String nodeId;
    private final String field;

    public MappingException(String message) {
        this(null, null, message);
    }

    public MappingException(String nodeId, String field, String message) {
        super(message);
        this.nodeId = nodeId;
        this.field = field;
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
                getMessage());
    }
}
