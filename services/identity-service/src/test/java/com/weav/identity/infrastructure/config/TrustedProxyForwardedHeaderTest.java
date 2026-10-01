package com.weav.identity.infrastructure.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.tomcat.autoconfigure.servlet.TomcatServletWebServerAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.DispatcherServletAutoConfiguration;
import org.springframework.boot.webmvc.autoconfigure.WebMvcAutoConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * ID-2: X-Forwarded-For must only be honoured when the direct peer matches
 * IDENTITY_TRUSTED_PROXY_PATTERN (the gateway). A real embedded Tomcat is required because the
 * RemoteIpValve is not part of MockMvc. The client here connects from 127.0.0.1.
 */
class TrustedProxyForwardedHeaderTest {

    private static final String CLIENT_IP = "203.0.113.9";

    private static String remoteAddrSeenBy(int port) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/remote-addr"))
                .header("X-Forwarded-For", CLIENT_IP)
                .build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    @SpringBootConfiguration
    @ImportAutoConfiguration({
            TomcatServletWebServerAutoConfiguration.class,
            DispatcherServletAutoConfiguration.class,
            WebMvcAutoConfiguration.class})
    @Import(EchoController.class)
    static class App {
    }

    @RestController
    static class EchoController {
        @GetMapping("/remote-addr")
        String remoteAddr(HttpServletRequest request) {
            return request.getRemoteAddr();
        }
    }

    @Nested
    @SpringBootTest(classes = App.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
            properties = "IDENTITY_TRUSTED_PROXY_PATTERN=127[.]0[.]0[.]1")
    class TrustedGateway {
        @LocalServerPort
        int port;

        @Test
        void usesForwardedClientIpWhenPeerMatchesTrustedPattern() throws Exception {
            assertEquals(CLIENT_IP, remoteAddrSeenBy(port));
        }
    }

    @Nested
    @SpringBootTest(classes = App.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    class DefaultTrustsNobody {
        @LocalServerPort
        int port;

        @Test
        void ignoresForwardedHeaderWhenNoProxyIsTrusted() throws Exception {
            assertEquals("127.0.0.1", remoteAddrSeenBy(port));
        }
    }

    @Nested
    @SpringBootTest(classes = App.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
            properties = "IDENTITY_TRUSTED_PROXY_PATTERN=")
    class ExplicitEmptyTrustsNobody {
        @LocalServerPort
        int port;

        @Test
        void emptyPatternMustNotFallBackToTomcatPrivateRangeDefault() throws Exception {
            assertEquals("127.0.0.1", remoteAddrSeenBy(port));
        }
    }

    @Nested
    @SpringBootTest(classes = App.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
            properties = "IDENTITY_TRUSTED_PROXY_PATTERN=10[.]99[.]0[.]5")
    class UntrustedPeer {
        @LocalServerPort
        int port;

        @Test
        void ignoresForwardedHeaderFromPeerOutsideTrustedPattern() throws Exception {
            assertEquals("127.0.0.1", remoteAddrSeenBy(port));
        }
    }
}
