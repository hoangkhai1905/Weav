package com.weav.workflow.infrastructure.ai;

import com.nimbusds.jwt.SignedJWT;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class AiClientContractTest {
    @Test
    void disabledFailsClosedWithoutCallingAi() {
        AiClientProperties properties = new AiClientProperties(false, false, java.net.URI.create("http://ai.internal"),
                "", "", java.time.Duration.ofSeconds(1), java.time.Duration.ofSeconds(1),
                java.time.Duration.ofSeconds(1), 1024);
        AiClient client = new AiClient(properties,
                new ServiceJwtSigner(new org.springframework.core.io.DefaultResourceLoader(), "", "",
                        java.time.Duration.ofSeconds(1)),
                RestClient.builder().build(), new ObjectMapper(), Clock.systemUTC());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(new NodeExecutor.Context(UUID.randomUUID(), UUID.randomUUID(),
                        UUID.randomUUID(), "node", 1, null, null), "summarize", Map.of("text", "t")));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", failure.code());
        assertFalse(failure.retryable());
    }

    private static final String TRACEPARENT =
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    @TempDir
    Path tempDir;

    private RestClient.Builder builder;
    private MockRestServiceServer server;
    private AiClient client;
    private AiClientProperties properties;

    @BeforeEach
    void setUp() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        String encoded = java.util.Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(keyPair.getPrivate().getEncoded());
        Path privateKey = tempDir.resolve("workflow-test-private-key.pem");
        Files.writeString(privateKey, "-----BEGIN PRIVATE KEY-----\n" + encoded
                + "\n-----END PRIVATE KEY-----\n");
        properties = new AiClientProperties(true, true, java.net.URI.create("http://ai.internal"),
                "workflow-test-key", privateKey.toUri().toString(), Duration.ofSeconds(5),
                Duration.ofSeconds(65), Duration.ofSeconds(90), 1_048_576);
        builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        client = new AiClient(properties,
                new ServiceJwtSigner(new DefaultResourceLoader(), properties.keyId(),
                        properties.privateKeyLocation(), properties.tokenLifetime()),
                builder.build(), new ObjectMapper(),
                Clock.fixed(Instant.parse("2026-09-23T01:02:03Z"), java.time.ZoneOffset.UTC));
    }

    @Test
    void requestIdIsStablePerExecutionNodeAttemptAndChangesWithAttempt() {
        UUID workspace = UUID.randomUUID();
        UUID execution = UUID.randomUUID();
        NodeExecutor.Context first = new NodeExecutor.Context(workspace, execution, UUID.randomUUID(), "node", 1, null, null);
        NodeExecutor.Context recovered = new NodeExecutor.Context(workspace, execution, UUID.randomUUID(), "node", 1, null, null);
        NodeExecutor.Context retry = new NodeExecutor.Context(workspace, execution, UUID.randomUUID(), "node", 2, null, null);
        assertEquals(AiClient.requestId(first), AiClient.requestId(recovered));
        org.junit.jupiter.api.Assertions.assertNotEquals(AiClient.requestId(first), AiClient.requestId(retry));
    }

    @Test
    void quotaExhaustionStopsTheCallBeforeAnyRequest() {
        AiClient limited = new AiClient(new AiClientProperties(true, true, java.net.URI.create("http://ai.internal"),
                "k", "p", Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1), 1024),
                new ServiceJwtSigner(new DefaultResourceLoader(), "", "", Duration.ofSeconds(1)),
                builder.build(), new ObjectMapper(), Clock.systemUTC(), workspaceId -> {
                    throw new NodeExecutor.Failure(AiQuota.EXCEEDED, "quota", false);
                });
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> limited.execute(context(), "summarize", Map.of("text", "t", "maxLength", 10)));
        assertEquals("AI_QUOTA_EXCEEDED", failure.code());
        assertFalse(failure.retryable());
        server.verify(); // no HTTP expectation was set, none was made
    }

    @Test
    void generateNodeIsCountedByTheQuotaAndSignsTheBoundPromptScope() throws Exception {
        java.util.List<UUID> counted = new java.util.ArrayList<>();
        AiClient counting = new AiClient(properties,
                new ServiceJwtSigner(new DefaultResourceLoader(), properties.keyId(),
                        properties.privateKeyLocation(), properties.tokenLifetime()),
                builder.build(), new ObjectMapper(),
                Clock.fixed(Instant.parse("2026-09-23T01:02:03Z"), java.time.ZoneOffset.UTC), counted::add);
        AtomicReference<String> token = new AtomicReference<>();
        server.expect(requestTo("http://ai.internal/v1/prompt"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> token.set(
                        request.getHeaders().getFirst("Authorization").substring("Bearer ".length())))
                .andRespond(request -> withSuccess("""
                        {"requestId":"%s","result":{"text":"hi","truncated":false}}
                        """.formatted(request.getHeaders().getFirst("X-Request-ID")), MediaType.APPLICATION_JSON)
                        .createResponse(request));

        NodeExecutor.Result result = new AiNodeExecutor("ai.generate", counting)
                .execute(context(), Map.of("prompt", "say hi"));

        assertEquals(Map.of("text", "hi", "truncated", false), result.output());
        assertEquals(java.util.List.of(context().workspaceId()), counted);
        assertEquals("ai:prompt", SignedJWT.parse(token.get()).getJWTClaimsSet().getStringClaim("scope"));
        server.verify();
    }

    @Test
    void generateNodeFailsWithQuotaExceededBeforeAnyRequest() {
        AiClient limited = new AiClient(properties,
                new ServiceJwtSigner(new DefaultResourceLoader(), "", "", Duration.ofSeconds(1)),
                builder.build(), new ObjectMapper(), Clock.systemUTC(), workspaceId -> {
                    throw new NodeExecutor.Failure(AiQuota.EXCEEDED, "quota", false);
                });
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.generate", limited).execute(context(), Map.of("prompt", "say hi")));
        assertEquals("AI_QUOTA_EXCEEDED", failure.code());
        assertFalse(failure.retryable());
        server.verify(); // no HTTP expectation was set, none was made
    }

    @Test
    void sendsBoundServiceJwtAndReturnsResult() throws Exception {
        AtomicReference<String> requestId = new AtomicReference<>();
        AtomicReference<String> token = new AtomicReference<>();
        server.expect(requestTo("http://ai.internal/v1/summarize"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> {
                    requestId.set(request.getHeaders().getFirst("X-Request-ID"));
                    token.set(request.getHeaders().getFirst("Authorization").substring("Bearer ".length()));
                })
                .andExpect(header("traceparent", TRACEPARENT))
                .andExpect(header("X-Correlation-ID", "correlation"))
                .andExpect(headerDoesNotExist("X-Workspace-ID"))
                .andRespond(request -> withSuccess("""
                        {"requestId":"%s","result":{"summary":"ok","truncated":false}}
                        """.formatted(request.getHeaders().getFirst("X-Request-ID")), MediaType.APPLICATION_JSON)
                        .createResponse(request));

        Map<String, Object> result = client.execute(context(), "summarize",
                Map.of("text", "t", "maxLength", 10));

        assertEquals(Map.of("summary", "ok", "truncated", false), result);
        var claims = SignedJWT.parse(token.get()).getJWTClaimsSet();
        assertEquals("weav-ai", claims.getAudience().get(0));
        assertEquals("ai:summarize", claims.getStringClaim("scope"));
        assertEquals(requestId.get(), claims.getStringClaim("request_id"));
        assertEquals(context().workspaceId().toString(), claims.getStringClaim("workspace_id"));
        assertEquals("execution", claims.getStringClaim("mode"));
        server.verify();
    }

    @ParameterizedTest
    @CsvSource({
            "429, AI_BUSY, AI_BUSY, true",
            "503, AI_PROVIDER_UNAVAILABLE, AI_PROVIDER_UNAVAILABLE, true",
            "504, AI_TIMEOUT, AI_TIMEOUT, true",
            "502, AI_OUTPUT_INVALID, AI_OUTPUT_INVALID, false",
            "502, AI_PROVIDER_AUTH, DEPENDENCY_NOT_CONFIGURED, false",
            "503, AI_NOT_CONFIGURED, DEPENDENCY_NOT_CONFIGURED, false",
            "401, UNAUTHENTICATED, DEPENDENCY_NOT_CONFIGURED, false",
            "403, FORBIDDEN, DEPENDENCY_NOT_CONFIGURED, false",
            "422, AI_SCHEMA_INVALID, CONFIGURATION_ERROR, false",
            "400, INVALID_REQUEST, CONFIGURATION_ERROR, false",
            "500, INTERNAL_ERROR, INTERNAL_ERROR, false",
            "503, SOMETHING_NEW, AI_RESPONSE_INVALID, false"})
    void retryabilityComesFromTheAiCodeNotTheStatus(int status, String aiCode,
                                                      String failureCode, boolean retryable) {
        server.expect(requestTo("http://ai.internal/v1/summarize")).andRespond(withStatus(HttpStatus.valueOf(status))
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"error\":{\"code\":\"" + aiCode + "\",\"message\":\"x\",\"requestId\":null}}"));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(context(), "summarize", Map.of("text", "t", "maxLength", 10)));
        assertEquals(failureCode, failure.code());
        assertEquals(retryable, failure.retryable());
    }

    @Test
    void nonJsonErrorBodyIsNotRetryable() {
        server.expect(requestTo("http://ai.internal/v1/summarize")).andRespond(withStatus(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.TEXT_HTML).body("<html>bad gateway</html>"));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(context(), "summarize", Map.of("text", "t", "maxLength", 10)));
        assertEquals("AI_RESPONSE_INVALID", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void rejectsMismatchedRequestIdAndDuplicateKeys() {
        server.expect(requestTo("http://ai.internal/v1/summarize")).andRespond(request -> withSuccess(
                "{\"requestId\":\"00000000-0000-0000-0000-000000000099\",\"result\":{}}",
                MediaType.APPLICATION_JSON).createResponse(request));
        NodeExecutor.Failure mismatched = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(context(), "summarize", Map.of("text", "t", "maxLength", 10)));
        assertEquals("AI_RESPONSE_INVALID", mismatched.code());

        server.reset();
        AtomicReference<String> duplicateRequestId = new AtomicReference<>();
        server.expect(requestTo("http://ai.internal/v1/summarize")).andRespond(request -> {
            duplicateRequestId.set(request.getHeaders().getFirst("X-Request-ID"));
            return withSuccess("{\"requestId\":\"" + duplicateRequestId.get()
                    + "\",\"result\":{},\"result\":{}}", MediaType.APPLICATION_JSON).createResponse(request);
        });
        NodeExecutor.Failure duplicate = assertThrows(NodeExecutor.Failure.class,
                () -> client.execute(context(), "summarize", Map.of("text", "t", "maxLength", 10)));
        assertEquals("AI_RESPONSE_INVALID", duplicate.code());
    }

    /** X-15: no stored correlation id means no header, rather than a made-up one. */
    @Test
    void omitsCorrelationHeaderWhenTheExecutionHasNone() {
        server.expect(requestTo("http://ai.internal/v1/summarize"))
                .andExpect(headerDoesNotExist("X-Correlation-ID"))
                .andRespond(request -> withSuccess("""
                        {"requestId":"%s","result":{"summary":"ok","truncated":false}}
                        """.formatted(request.getHeaders().getFirst("X-Request-ID")), MediaType.APPLICATION_JSON)
                        .createResponse(request));
        client.execute(new NodeExecutor.Context(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "ai-node", 1, null, null), "summarize", Map.of("text", "t", "maxLength", 10));
        server.verify();
    }

    private NodeExecutor.Context context() {
        return new NodeExecutor.Context(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                "ai-node", 1, "correlation", TRACEPARENT);
    }
}
