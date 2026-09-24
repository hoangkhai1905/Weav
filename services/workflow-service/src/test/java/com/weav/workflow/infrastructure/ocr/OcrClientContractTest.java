package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
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
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class OcrClientContractTest {

    @TempDir
    Path tempDir;

    @Test
    void postsPrivateServiceJwtRequestAndReturnsCheckedContractFixture() throws Exception {
        KeyPair keyPair = keyPair();
        Path privateKey = writePrivateKey(keyPair);
        OcrClientProperties properties = properties(true, true, true, true, true, true, privateKey);
        WorkflowServiceJwtIssuer issuer = new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader());
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        String fixture = Files.readString(contractFixture("success-with-tables.json"));
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestId = new AtomicReference<>();

        server.expect(requestTo("http://ocr.internal/v1/extractions"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(request -> authorization.set(request.getHeaders().getFirst("Authorization")))
                .andExpect(request -> requestId.set(request.getHeaders().getFirst("X-Request-ID")))
                .andExpect(header("Authorization", org.hamcrest.Matchers.startsWith("Bearer eyJ")))
                .andExpect(header("X-Request-ID", org.hamcrest.Matchers.matchesPattern(
                        "[0-9a-fA-F-]{36}")))
                .andExpect(header("traceparent",
                        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"))
                .andExpect(headerDoesNotExist("X-Workspace-ID"))
                .andExpect(content().json("""
                        {"source":{"type":"url","fileUrl":"https://approved.example/document.pdf?X-Amz-Signature=private"},
                         "language":"vi+en","detectTables":true}
                        """))
                .andRespond(request -> {
                    String generatedRequestId = request.getHeaders().getFirst("X-Request-ID");
                    String response = fixture.replace("eeb24fb2-df80-4dcb-b22d-3a4884799c73", generatedRequestId)
                            .replace("4c9d5ea3-7fa2-43ce-95b8-8c17042a969f", generatedRequestId);
                    return withSuccess(response, MediaType.APPLICATION_JSON).createResponse(request);
                });

        OcrClient client = new OcrClient(properties, issuer, builder.build(), new ObjectMapper(),
                java.time.Clock.fixed(Instant.parse("2026-09-23T01:02:03Z"), java.time.ZoneOffset.UTC));
        Map<String, Object> output = client.extract(context(), Map.of(
                "source", Map.of("type", "url",
                        "fileUrl", "https://approved.example/document.pdf?X-Amz-Signature=private"),
                "language", "vi+en",
                "detectTables", true));
        server.verify();

        assertEquals("1.0", output.get("schemaVersion"));
        assertEquals(requestId.get(), output.get("requestId"));
        Map<?, ?> text = assertInstanceOf(Map.class, output.get("text"));
        assertTrue(((String) text.get("rawText")).contains("Service Technical Specifications"));
        assertTrue(output.get("confidence") instanceof Number);
        Map<?, ?> document = assertInstanceOf(Map.class, output.get("document"));
        assertEquals(1, document.get("pages"));
        assertInstanceOf(java.util.List.class, output.get("blocks"));
        assertInstanceOf(java.util.List.class, output.get("tables"));
        assertInstanceOf(Map.class, output.get("metadata"));
        assertFalse(output.toString().contains("X-Amz-Signature=private"));
        assertTrue(authorization.get().startsWith("Bearer "));
        assertEquals("weav-workflow", com.nimbusds.jwt.SignedJWT.parse(
                authorization.get().substring("Bearer ".length())).getJWTClaimsSet().getIssuer());
        assertFalse(output.toString().contains(authorization.get()));
    }

    @Test
    void disabledDefaultAndEachUrlOrArtifactPrerequisiteFailBeforeAnyOutboundCall() throws Exception {
        KeyPair keyPair = keyPair();
        Path privateKey = writePrivateKey(keyPair);
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        NodeExecutor.Failure disabled = assertFailure(new OcrClient(
                properties(false, false, false, false, false, false, privateKey),
                new WorkflowServiceJwtIssuer(properties(false, false, false, false, false, false, privateKey),
                        new DefaultResourceLoader()),
                builder.build(), new ObjectMapper()),
                Map.of("source", Map.of("type", "url", "fileUrl", "https://approved.example/file.pdf")));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", disabled.code());

        for (OcrClientProperties gates : new OcrClientProperties[]{
                properties(true, false, true, true, true, true, privateKey),
                properties(true, true, true, false, true, true, privateKey),
                properties(true, true, true, true, false, true, privateKey)}) {
            assertEquals("DEPENDENCY_NOT_CONFIGURED", assertFailure(client(gates),
                    Map.of("source", Map.of("type", "url", "fileUrl", "https://approved.example/file.pdf")))
                    .code());
        }
        for (OcrClientProperties gates : new OcrClientProperties[]{
                properties(true, true, false, true, true, true, privateKey),
                properties(true, true, true, false, true, true, privateKey),
                properties(true, true, true, true, true, false, privateKey)}) {
            assertEquals("DEPENDENCY_NOT_CONFIGURED", assertFailure(client(gates),
                    Map.of("source", Map.of("type", "artifact",
                            "artifactId", "00000000-0000-0000-0000-000000000004")))
                    .code());
        }
        server.verify();
    }

    @Test
    void classifiesRetryableProviderErrorsWithoutExposingBodyOrSignedUrl() throws Exception {
        OcrClientProperties properties = properties(true, true, true, true, true, true,
                writePrivateKey(keyPair()));
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ocr.internal/v1/extractions"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"error":{"code":"SOURCE_TIMEOUT","message":"token=private","retryable":true},
                                 "requestId":"eeb24fb2-df80-4dcb-b22d-3a4884799c73"}
                                """));

        OcrClient client = new OcrClient(properties,
                new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader()),
                builder.build(), new ObjectMapper());
        NodeExecutor.Failure failure = assertFailure(client, Map.of(
                "source", Map.of("type", "url",
                        "fileUrl", "https://approved.example/file.pdf?token=private")));
        server.verify();

        assertEquals("SOURCE_TIMEOUT", failure.code());
        assertTrue(failure.retryable());
        assertFalse(failure.getMessage().contains("private"));
        assertFalse(failure.getMessage().contains("approved.example"));
    }

    @Test
    void rejectsMalformedSuccessResponsesWithoutSynthesizingOutput() throws Exception {
        OcrClientProperties properties = properties(true, true, true, true, true, true,
                writePrivateKey(keyPair()));
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ocr.internal/v1/extractions"))
                .andRespond(withSuccess("{\"schemaVersion\":\"1.0\",\"text\":{}}", MediaType.APPLICATION_JSON));

        OcrClient client = new OcrClient(properties,
                new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader()),
                builder.build(), new ObjectMapper());
        NodeExecutor.Failure failure = assertFailure(client,
                Map.of("source", Map.of("type", "url", "fileUrl", "https://approved.example/file.pdf")));
        server.verify();

        assertEquals("OCR_INVALID_RESPONSE", failure.code());
        assertFalse(failure.retryable());
    }

    private OcrClient client(OcrClientProperties properties) {
        return new OcrClient(properties,
                new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader()),
                RestClient.builder().build(), new ObjectMapper());
    }

    private NodeExecutor.Failure assertFailure(OcrClient client, Map<String, Object> request) {
        return org.junit.jupiter.api.Assertions.assertThrows(NodeExecutor.Failure.class,
                () -> client.extract(context(), request));
    }

    private NodeExecutor.Context context() {
        return new NodeExecutor.Context(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                "ocr-node", 1, "correlation", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    }

    private Path contractFixture(String fileName) {
        return Path.of("..", "..", "packages", "contracts", "http", "ocr", "examples", fileName);
    }

    private KeyPair keyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    private Path writePrivateKey(KeyPair keyPair) throws Exception {
        String encoded = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(keyPair.getPrivate().getEncoded());
        Path path = tempDir.resolve("workflow-test-private-key.pem");
        Files.writeString(path, "-----BEGIN PRIVATE KEY-----\n" + encoded + "\n-----END PRIVATE KEY-----\n");
        return path;
    }

    private OcrClientProperties properties(
            boolean enabled,
            boolean urlSourceEnabled,
            boolean artifactSourceEnabled,
            boolean serviceClaimsVerified,
            boolean urlAllowlistVerified,
            boolean artifactResolverVerified,
            Path privateKey) {
        return new OcrClientProperties(
                enabled, urlSourceEnabled, artifactSourceEnabled,
                serviceClaimsVerified, urlAllowlistVerified, artifactResolverVerified,
                java.net.URI.create("http://ocr.internal"), "workflow-test-key",
                privateKey == null ? "" : privateKey.toUri().toString(),
                Duration.ofSeconds(5), Duration.ofSeconds(30), Duration.ofSeconds(60), 1_048_576);
    }
}
