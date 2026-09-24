package com.weav.workflow.infrastructure.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import com.sun.net.httpserver.HttpsServer;
import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import javax.net.ssl.ExtendedSSLSession;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.X509ExtendedKeyManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SNIServerName;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpTransportIntegrationTest {

    private static final char[] TEST_KEY_PASSWORD = "weav-http-test-only".toCharArray();
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void sendsToApprovedAddressWhileRetainingOriginalHostAndDecodesJson() throws Exception {
        AtomicReference<String> requestMethod = new AtomicReference<>();
        AtomicReference<String> requestPath = new AtomicReference<>();
        AtomicReference<String> requestHost = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        start(exchange -> {
            requestMethod.set(exchange.getRequestMethod());
            requestPath.set(exchange.getRequestURI().toString());
            requestHost.set(exchange.getRequestHeaders().getFirst("Host"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "application/json", "{\"ok\":true}");
        }, "/resource");

        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/resource?existing=1");
        PinnedHttpTransport transport = transport();
        PinnedHttpTransport.HttpResponse response = transport.execute(
                approved(uri), "POST", Map.of("Content-Type", "application/json"),
                Map.of("q", "two"), Map.of("name", "value"));

        assertEquals(200, response.status());
        assertEquals(Map.of("ok", true), response.data());
        assertEquals("POST", requestMethod.get());
        assertEquals("/resource?existing=1&q=two", requestPath.get());
        assertTrue(requestHost.get().startsWith("public.example.test:"));
        assertEquals("{\"name\":\"value\"}", requestBody.get());
    }

    @Test
    void doesNotFollowRedirectsToAnotherDestination() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        start(exchange -> {
            calls.incrementAndGet();
            exchange.getResponseHeaders().set("Location", "http://127.0.0.1/private");
            respond(exchange, 302, "text/plain", "redirect");
        }, "/redirect");

        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/redirect");
        PinnedHttpTransport.HttpResponse response = transport().execute(
                approved(uri), "GET", Map.of(), null, null);

        assertEquals(302, response.status());
        assertEquals(1, calls.get());
    }

    @Test
    void rejectsOversizedResponseBeforeReturningData() throws Exception {
        start(exchange -> respond(exchange, 200, "text/plain", "123456789"), "/large");
        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/large");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 1024, 8, 4096, new ObjectMapper());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> bounded.execute(approved(uri), "GET", Map.of(), null, null));

        assertEquals("HTTP_RESPONSE_TOO_LARGE", failure.code());
        assertTrue(failure.safeMessage().toLowerCase().contains("response"));
    }

    @Test
    void rejectsResponseHeadersAboveConfiguredLimit() throws Exception {
        start(exchange -> {
            exchange.getResponseHeaders().set("X-Large", "h".repeat(200));
            respond(exchange, 200, "text/plain", "ok");
        }, "/large-headers");
        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/large-headers");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 1024, 1024, 64, new ObjectMapper());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> bounded.execute(approved(uri), "GET", Map.of(), null, null));

        assertEquals("HTTP_RESPONSE_TOO_LARGE", failure.code());
    }

    @Test
    void rejectsRequestBodyWhileSerializingPastConfiguredLimit() {
        URI uri = URI.create("http://public.example.test/resource");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 16, 1024, 4096, new ObjectMapper());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> bounded.execute(approved(uri), "POST", Map.of(), null, Map.of("value", "x".repeat(256))));

        assertEquals("HTTP_REQUEST_TOO_LARGE", failure.code());
    }

    @Test
    void doesNotDecompressAResponseBeforeApplyingTheBodyLimit() throws Exception {
        byte[] compressed = gzip("x".repeat(128 * 1024));
        start(exchange -> {
            exchange.getResponseHeaders().set("Content-Encoding", "gzip");
            byte[] response = compressed;
            exchange.getResponseHeaders().set("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, response.length);
            try (exchange; OutputStream output = exchange.getResponseBody()) {
                output.write(response);
            }
        }, "/compressed");
        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/compressed");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 1024, 4096, 4096, new ObjectMapper());

        PinnedHttpTransport.HttpResponse response = bounded.execute(
                approved(uri), "GET", Map.of(), null, null);

        String data = (String) response.data();
        assertEquals(200, response.status());
        assertTrue(data.length() < 4096);
        assertEquals("gzip", responseHeader(response.headers(), "Content-Encoding"), response.headers().toString());
    }

    @Test
    void enforcesAnAbsoluteCallDeadlineWhenTheServerKeepsSendingData() throws Exception {
        start(exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, 0);
            try (exchange; OutputStream output = exchange.getResponseBody()) {
                for (int index = 0; index < 30; index++) {
                    output.write('x');
                    output.flush();
                    try {
                        Thread.sleep(80);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            } catch (IOException ignored) {
                // The client cancels the socket at its absolute deadline.
            }
        }, "/drip");
        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/drip");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofMillis(400), 1024, 1024, 4096, new ObjectMapper());
        long startedAt = System.nanoTime();

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> bounded.execute(approved(uri), "GET", Map.of(), null, null));
        long elapsed = System.nanoTime() - startedAt;

        assertEquals("HTTP_TIMEOUT", failure.code());
        assertTrue(failure.retryable());
        assertTrue(elapsed < Duration.ofSeconds(2).toNanos());
    }

    @Test
    void keepsOriginalSheetsHostnameForTrustedTlsSniAndHostHeader() throws Exception {
        AtomicReference<String> requestHost = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicInteger requests = new AtomicInteger();
        TlsFixture fixture = startTls(exchange -> {
            requests.incrementAndGet();
            requestHost.set(exchange.getRequestHeaders().getFirst("Host"));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.getResponseHeaders().set("X-Echo", "Bearer sheets-test-token");
            exchange.getResponseHeaders().set("Set-Cookie", "session=private");
            respond(exchange, 200, "application/json", "{\"ok\":true}");
        }, "/v4/spreadsheets/book/values/A1");
        URI uri = URI.create("https://sheets.googleapis.com:" + fixture.server().getAddress().getPort()
                + "/v4/spreadsheets/book/values/A1");
        PinnedHttpTransport transport = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 1024, 1024, 4096,
                new ObjectMapper(), new OutboundTargetPolicy(), fixture.clientContext());

        PinnedHttpTransport.HttpResponse response = transport.executeWithAuthentication(
                approved(uri), "GET", Map.of(), Map.of("Authorization", "Bearer sheets-test-token"), null, null);

        assertEquals(200, response.status());
        assertEquals(Map.of("ok", true), response.data());
        assertEquals("[REDACTED]", responseHeader(response.headers(), "X-Echo"), response.headers().toString());
        assertTrue(response.headers().keySet().stream().noneMatch(name -> name.equalsIgnoreCase("Set-Cookie")));
        assertEquals("sheets.googleapis.com", fixture.sniHost().get());
        assertTrue(requestHost.get().startsWith("sheets.googleapis.com:"));
        assertEquals("Bearer sheets-test-token", authorization.get());
        assertEquals(1, requests.get());
    }

    @Test
    void restrictsTrustedBearerEntryPointToTheFixedSheetsHttpsApi() {
        AtomicInteger dnsLookups = new AtomicInteger();
        OutboundTargetPolicy policy = new OutboundTargetPolicy(host -> {
            dnsLookups.incrementAndGet();
            return new InetAddress[]{loopbackAddress()};
        });
        PinnedHttpTransport transport = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(1), 1024, 1024, 4096,
                new ObjectMapper(), policy, null);

        for (URI uri : List.of(
                URI.create("https://attacker.example.test/v4/spreadsheets/book/values/A1"),
                URI.create("http://sheets.googleapis.com/v4/spreadsheets/book/values/A1"),
                URI.create("https://sheets.googleapis.com/other/path"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeGoogleSheetsWithBearerToken(
                            uri, "GET", null, null, "sheets-test-token"));
            assertEquals("HTTP_REQUEST_INVALID", failure.code());
        }

        assertEquals(0, dnsLookups.get());

        OutboundTargetPolicy unavailableDns = new OutboundTargetPolicy(host -> {
            dnsLookups.incrementAndGet();
            throw new UnknownHostException("synthetic DNS failure");
        });
        PinnedHttpTransport approvalChecked = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(1), 1024, 1024, 4096,
                new ObjectMapper(), unavailableDns, null);
        NodeExecutor.Failure approvalFailure = assertThrows(NodeExecutor.Failure.class,
                () -> approvalChecked.executeGoogleSheetsWithBearerToken(
                        URI.create("https://sheets.googleapis.com/v4/spreadsheets/book/values/A1"),
                        "GET", null, null, "sheets-test-token"));
        assertEquals("DNS_RESOLUTION_FAILED", approvalFailure.code());
        assertEquals(1, dnsLookups.get());
    }

    @Test
    void rejectsTrustedCertificateForWrongOriginalHostname() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        TlsFixture fixture = startTls(exchange -> {
            requests.incrementAndGet();
            respond(exchange, 200, "text/plain", "should not arrive");
        }, "/resource");
        URI uri = URI.create("https://wrong.example.test:" + fixture.server().getAddress().getPort() + "/resource");
        PinnedHttpTransport transport = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 1024, 1024, 4096,
                new ObjectMapper(), new OutboundTargetPolicy(), fixture.clientContext());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> transport.execute(approved(uri), "GET", Map.of(), null, null));

        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failure.code());
        assertEquals("wrong.example.test", fixture.sniHost().get());
        assertEquals(0, requests.get());
    }

    @Test
    void mapsReadTimeoutToRetryableSafeFailure() throws Exception {
        start(exchange -> {
            try {
                Thread.sleep(500);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "text/plain", "late");
        }, "/slow");
        URI uri = URI.create("http://public.example.test:" + server.getAddress().getPort() + "/slow");
        PinnedHttpTransport bounded = new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofMillis(100), 1024, 1024, 4096, new ObjectMapper());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> bounded.execute(approved(uri), "GET", Map.of(), null, null));

        assertEquals("HTTP_TIMEOUT", failure.code());
        assertTrue(failure.retryable());
    }

    private PinnedHttpTransport transport() {
        return new PinnedHttpTransport(
                Duration.ofSeconds(1), Duration.ofSeconds(2), 64 * 1024,
                64 * 1024, 16 * 1024, new ObjectMapper());
    }

    private TlsFixture startTls(Handler handler, String path) throws Exception {
        X509Certificate caCertificate = certificate("/http-transport-tls/ca-cert.pem");
        X509Certificate serverCertificate = certificate("/http-transport-tls/server-cert.pem");
        PrivateKey serverKey = privateKey("/http-transport-tls/server-key.pem");
        AtomicReference<String> sniHost = new AtomicReference<>();

        KeyStore identity = KeyStore.getInstance("PKCS12");
        identity.load(null, null);
        identity.setKeyEntry("server", serverKey, TEST_KEY_PASSWORD,
                new Certificate[]{serverCertificate, caCertificate});
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(identity, TEST_KEY_PASSWORD);
        X509ExtendedKeyManager delegate = (X509ExtendedKeyManager) keyManagers.getKeyManagers()[0];
        SSLContext serverContext = SSLContext.getInstance("TLS");
        serverContext.init(new X509ExtendedKeyManager[]{new SniCapturingKeyManager(delegate, sniHost)}, null,
                new SecureRandom());

        KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
        trust.load(null, null);
        trust.setCertificateEntry("weav-http-test-ca", caCertificate);
        TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trustManagers.init(trust);
        SSLContext clientContext = SSLContext.getInstance("TLS");
        clientContext.init(null, trustManagers.getTrustManagers(), new SecureRandom());

        HttpsServer httpsServer = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        httpsServer.setHttpsConfigurator(new HttpsConfigurator(serverContext) {
            @Override
            public void configure(HttpsParameters parameters) {
                parameters.setSSLParameters(getSSLContext().getDefaultSSLParameters());
            }
        });
        httpsServer.createContext(path, handler::handle);
        httpsServer.start();
        server = httpsServer;
        return new TlsFixture(httpsServer, clientContext, sniHost);
    }

    private static X509Certificate certificate(String resource) throws Exception {
        try (var input = HttpTransportIntegrationTest.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IOException("TLS test certificate is missing");
            }
            return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
    }

    private static PrivateKey privateKey(String resource) throws Exception {
        try (var input = HttpTransportIntegrationTest.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IOException("TLS test key is missing");
            }
            String pem = new String(input.readAllBytes(), StandardCharsets.US_ASCII)
                    .replace("-----BEGIN PRIVATE KEY-----", "")
                    .replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            return KeyFactory.getInstance("RSA").generatePrivate(
                    new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
        }
    }

    private OutboundTargetPolicy loopbackPolicy() {
        return new OutboundTargetPolicy(ignored -> new InetAddress[]{loopbackAddress()});
    }

    private static InetAddress loopbackAddress() {
        try {
            return InetAddress.getByName("127.0.0.1");
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }

    private static byte[] gzip(String value) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (var gzip = new java.util.zip.GZIPOutputStream(output)) {
            gzip.write(value.getBytes(StandardCharsets.UTF_8));
        }
        return output.toByteArray();
    }

    private static String responseHeader(Map<String, String> headers, String name) {
        return headers.entrySet().stream()
                .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(null);
    }

    private OutboundTargetPolicy.ApprovedTarget approved(URI uri) {
        try {
            return new OutboundTargetPolicy.ApprovedTarget(
                    uri, List.of(InetAddress.getByName("127.0.0.1")));
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }

    private void start(Handler handler, String path) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(path, handler::handle);
        server.start();
    }

    private static void respond(HttpExchange exchange, int status, String contentType, String body)
            throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, bytes.length);
        try (exchange) {
            exchange.getResponseBody().write(bytes);
        }
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }

    private record TlsFixture(HttpsServer server, SSLContext clientContext, AtomicReference<String> sniHost) {
    }

    private static final class SniCapturingKeyManager extends X509ExtendedKeyManager {

        private final X509ExtendedKeyManager delegate;
        private final AtomicReference<String> observedSni;

        private SniCapturingKeyManager(
                X509ExtendedKeyManager delegate,
                AtomicReference<String> observedSni) {
            this.delegate = delegate;
            this.observedSni = observedSni;
        }

        @Override
        public String chooseEngineServerAlias(String keyType, java.security.Principal[] issuers, SSLEngine engine) {
            capture(engine.getHandshakeSession());
            return delegate.chooseEngineServerAlias(keyType, issuers, engine);
        }

        @Override
        public String chooseServerAlias(String keyType, java.security.Principal[] issuers, Socket socket) {
            if (socket instanceof SSLSocket sslSocket) {
                capture(sslSocket.getHandshakeSession());
            }
            return delegate.chooseServerAlias(keyType, issuers, socket);
        }

        private void capture(SSLSession session) {
            if (session instanceof ExtendedSSLSession extended) {
                for (SNIServerName serverName : extended.getRequestedServerNames()) {
                    if (serverName instanceof SNIHostName hostName) {
                        observedSni.set(hostName.getAsciiName());
                        return;
                    }
                }
            }
        }

        @Override
        public String[] getClientAliases(String keyType, java.security.Principal[] issuers) {
            return delegate.getClientAliases(keyType, issuers);
        }

        @Override
        public String chooseClientAlias(
                String[] keyTypes, java.security.Principal[] issuers, Socket socket) {
            return delegate.chooseClientAlias(keyTypes, issuers, socket);
        }

        @Override
        public String[] getServerAliases(String keyType, java.security.Principal[] issuers) {
            return delegate.getServerAliases(keyType, issuers);
        }

        @Override
        public X509Certificate[] getCertificateChain(String alias) {
            return delegate.getCertificateChain(alias);
        }

        @Override
        public PrivateKey getPrivateKey(String alias) {
            return delegate.getPrivateKey(alias);
        }
    }
}
