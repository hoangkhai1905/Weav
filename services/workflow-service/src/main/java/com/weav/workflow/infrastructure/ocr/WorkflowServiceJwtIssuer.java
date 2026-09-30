package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Mints one short-lived Workflow-to-OCR service JWT per node attempt. */
@Component
public final class WorkflowServiceJwtIssuer {

    private static final String ISSUER = "weav-workflow";
    private static final String AUDIENCE = "weav-ocr";
    private static final String SCOPE = "ocr:extract";

    private final OcrClientProperties properties;
    private final ServiceJwtSigner signer;

    public WorkflowServiceJwtIssuer(OcrClientProperties properties, ResourceLoader resourceLoader) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.signer = new ServiceJwtSigner(resourceLoader, properties.keyId(), properties.privateKeyLocation(),
                properties.tokenLifetime());
    }

    public String issue(NodeExecutor.Context context, Instant now) {
        if (context == null || now == null) {
            throw unavailable();
        }
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("scope", SCOPE);
        claims.put("workspace_id", context.workspaceId().toString());
        claims.put("mode", "execution");
        claims.put("execution_id", context.executionId().toString());
        claims.put("node_execution_id", context.nodeExecutionId().toString());
        try {
            return signer.sign(ISSUER, AUDIENCE, claims, now);
        } catch (ServiceJwtSigner.Unavailable exception) {
            throw unavailable();
        }
    }

    private NodeExecutor.Failure unavailable() {
        return new NodeExecutor.Failure(
                "DEPENDENCY_NOT_CONFIGURED", "OCR service authentication is not configured.", false);
    }

}
