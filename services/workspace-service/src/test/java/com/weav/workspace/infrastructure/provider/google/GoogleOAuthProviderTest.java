package com.weav.workspace.infrastructure.provider.google;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.service.GoogleOAuthScopePolicy;
import com.weav.workspace.domain.exception.AuthenticationRejectedException;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.infrastructure.config.GoogleOAuthProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GoogleOAuthProviderTest {

    private static final String CLIENT_ID = "synthetic-google-client-id";
    private static final String CLIENT_SECRET = "synthetic-google-client-secret";
    private static final String ACCESS_TOKEN = "synthetic-access-token";
    private static final String REFRESH_TOKEN = "synthetic-refresh-token";
    private static final String GMAIL_SCOPES =
            "openid email https://www.googleapis.com/auth/gmail.metadata";
    private static final String SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
    private static final String SHEETS_SCOPES = "openid email " + SHEETS_SCOPE;

    private HttpServer server;
    private final Map<String, Response> responses = new ConcurrentHashMap<>();
    private final List<CapturedRequest> requests = new CopyOnWriteArrayList<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void authorizationUrlUsesConfiguredRedirectAndExactLeastPrivilegeScopes() {
        String gmailUrl = provider().authorizationUrl(ConnectionProvider.GMAIL, "A".repeat(43));
        Map<String, String> gmail = query(URI.create(gmailUrl).getRawQuery());

        assertThat(URI.create(gmailUrl).getRawPath()).isEqualTo("/authorize");
        assertThat(gmail).containsEntry("client_id", CLIENT_ID)
                .containsEntry("redirect_uri", "http://localhost:8080/oauth/google/callback")
                .containsEntry("response_type", "code")
                .containsEntry("scope", GMAIL_SCOPES)
                .containsEntry("state", "A".repeat(43))
                .containsEntry("access_type", "offline")
                .containsEntry("include_granted_scopes", "true")
                .containsEntry("prompt", "consent");
        assertThat(gmail.get("scope")).doesNotContain("gmail.send", "drive");

        Map<String, String> sheets = query(URI.create(provider()
                .authorizationUrl(ConnectionProvider.GOOGLE_SHEETS, "B".repeat(43))).getRawQuery());
        assertThat(sheets.get("scope")).isEqualTo(SHEETS_SCOPES)
                .doesNotContain("drive");
        assertThat(provider().authorizationUrl(ConnectionProvider.GMAIL, "A".repeat(43)))
                .doesNotContain(CLIENT_SECRET);
        assertThatThrownBy(() -> provider().authorizationUrl(ConnectionProvider.GMAIL, "bad state"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void exchangesCodeThroughConfiguredClientAndRejectsMissingRefreshTokenSafely() {
        respond("/token", 200, tokenJson(GMAIL_SCOPES));

        GoogleOAuthTokenResponse tokens = provider().exchangeAuthorizationCode("synthetic-code");

        assertThat(tokens.accessToken()).isEqualTo(ACCESS_TOKEN);
        assertThat(tokens.refreshToken()).isEqualTo(REFRESH_TOKEN);
        assertThat(tokens.tokenType()).isEqualTo("Bearer");
        assertThat(tokens.grantedScopes()).containsExactly("openid", "email",
                "https://www.googleapis.com/auth/gmail.metadata");
        assertThat(tokens.expiresInSeconds()).isEqualTo(3600);
        assertThat(tokens.toString()).doesNotContain(ACCESS_TOKEN, REFRESH_TOKEN);

        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/token");
        assertThat(request.contentType()).startsWith("application/x-www-form-urlencoded");
        assertThat(form(request.body())).containsEntry("client_id", CLIENT_ID)
                .containsEntry("client_secret", CLIENT_SECRET)
                .containsEntry("code", "synthetic-code")
                .containsEntry("grant_type", "authorization_code")
                .containsEntry("redirect_uri", "http://localhost:8080/oauth/google/callback");

        requests.clear();
        respond("/token", 200, "{\"access_token\":\"new-access\",\"token_type\":\"Bearer\",");
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessage("A required dependency is temporarily unavailable");

        requests.clear();
        respond("/token", 200,
                "{\"access_token\":\"new-access\",\"token_type\":\"Bearer\","
                        + "\"expires_in\":3600,\"scope\":\"" + GMAIL_SCOPES + "\"}");
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google did not issue an offline refresh token; reconnect and grant access");
        assertThat(requests).hasSize(1);
    }

    @Test
    void exchangeErrorsAndMalformedTokenResponsesNeverReflectProviderBodiesOrAuthorizationCode() {
        respond("/token", 400,
                "{\"error\":\"invalid_grant\",\"error_description\":\"synthetic-code "
                        + CLIENT_SECRET + "\"}");
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Google authorization response is invalid or expired")
                .hasMessageNotContaining("synthetic-code")
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("invalid_grant");

        requests.clear();
        respond("/token", 503, "synthetic-code " + CLIENT_SECRET);
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessageNotContaining("synthetic-code")
                .hasMessageNotContaining(CLIENT_SECRET);

        requests.clear();
        respond("/token", 200,
                "{\"access_token\":\"a\",\"access_token\":\"b\",\"refresh_token\":\"r\","
                        + "\"token_type\":\"Bearer\",\"expires_in\":3600,\"scope\":\""
                        + GMAIL_SCOPES + "\"}");
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessageNotContaining("synthetic-code")
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("synthetic");

        requests.clear();
        respond("/token", 200, tokenJson(GMAIL_SCOPES) + " {}");
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("synthetic-code"))
                .isInstanceOf(DependencyUnavailableException.class);
    }

    @Test
    void refreshUsesGoogleTokenFormAndClassifiesOnlyConfirmedInvalidGrantAsAuthRejection() {
        respond("/token", 200, "{\"access_token\":\"refreshed-access\","
                + "\"token_type\":\"Bearer\",\"expires_in\":3600,\"scope\":\""
                + GMAIL_SCOPES + "\"}");

        GoogleOAuthRefreshResponse response = provider().refreshAccessToken(REFRESH_TOKEN);

        assertThat(response.accessToken()).isEqualTo("refreshed-access");
        assertThat(response.refreshToken()).isNull();
        assertThat(response.grantedScopes()).containsExactly("openid", "email",
                "https://www.googleapis.com/auth/gmail.metadata");
        assertThat(response.toString()).doesNotContain("refreshed-access", REFRESH_TOKEN);
        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/token");
        assertThat(request.contentType()).startsWith("application/x-www-form-urlencoded");
        assertThat(form(request.body())).containsEntry("client_id", CLIENT_ID)
                .containsEntry("client_secret", CLIENT_SECRET)
                .containsEntry("refresh_token", REFRESH_TOKEN)
                .containsEntry("grant_type", "refresh_token")
                .doesNotContainKey("code");

        requests.clear();
        respond("/token", 200, "{\"access_token\":\"rotated-access\","
                + "\"refresh_token\":\"rotated-refresh\",\"token_type\":\"Bearer\","
                + "\"expires_in\":1800,\"scope\":\"" + GMAIL_SCOPES + "\"}");
        assertThat(provider().refreshAccessToken(REFRESH_TOKEN).refreshToken()).isEqualTo("rotated-refresh");

        requests.clear();
        respond("/token", 400, "{\"error\":\"invalid_grant\",\"error_description\":\""
                + REFRESH_TOKEN + " " + CLIENT_SECRET + "\"}");
        assertThatThrownBy(() -> provider().refreshAccessToken(REFRESH_TOKEN))
                .isInstanceOf(AuthenticationRejectedException.class)
                .hasMessage("Connection authentication was rejected")
                .hasMessageNotContaining(REFRESH_TOKEN)
                .hasMessageNotContaining(CLIENT_SECRET)
                .hasMessageNotContaining("invalid_grant");

        requests.clear();
        respond("/token", 400, "{\"error\":\"invalid_client\"}");
        assertThatThrownBy(() -> provider().refreshAccessToken(REFRESH_TOKEN))
                .isInstanceOf(DependencyUnavailableException.class);

        requests.clear();
        respond("/token", 429, "synthetic throttling " + REFRESH_TOKEN);
        assertThatThrownBy(() -> provider().refreshAccessToken(REFRESH_TOKEN))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessageNotContaining(REFRESH_TOKEN);

        requests.clear();
        respond("/token", 200, "{\"access_token\":\"bad-shape\",\"token_type\":\"MAC\","
                + "\"expires_in\":3600,\"scope\":\"" + GMAIL_SCOPES + "\"}");
        assertThatThrownBy(() -> provider().refreshAccessToken(REFRESH_TOKEN))
                .isInstanceOf(DependencyUnavailableException.class);
    }

    @Test
    void verifiesGmailProfileAndClassifiesOnlyConfirmedAuthFailureAsInvalid() {
        respond("/gmail-profile", 200, "{\"emailAddress\":\"synthetic@example.test\",\"messagesTotal\":1}");

        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("GET");
        assertThat(request.path()).isEqualTo("/gmail-profile");
        assertThat(request.authorization()).isEqualTo("Bearer " + ACCESS_TOKEN);
        assertThat(request.body()).isEmpty();

        requests.clear();
        respond("/gmail-profile", 401, "{\"error\":\"synthetic auth detail\"}");
        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);

        requests.clear();
        respond("/gmail-profile", 429, "synthetic throttling details");
        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE);

        requests.clear();
        respond("/gmail-profile", 200, "{}");
        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE);
    }

    @Test
    void verifiesSheetsWithTokenInfoUsingDocumentedPostQueryAndChecksScopeAndAudience() {
        String userinfoEmailScope = "https://www.googleapis.com/auth/userinfo.email";
        respond("/tokeninfo", 200, "{\"scope\":\"openid " + userinfoEmailScope + " " + SHEETS_SCOPE
                + "\",\"issued_to\":\"" + CLIENT_ID + "\"}");

        assertThat(provider().verify(ConnectionProvider.GOOGLE_SHEETS, ACCESS_TOKEN, List.of(
                "openid", userinfoEmailScope, SHEETS_SCOPE)).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
        CapturedRequest request = onlyRequest();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.path()).isEqualTo("/tokeninfo");
        assertThat(request.rawQuery()).isEqualTo("access_token=" + ACCESS_TOKEN);
        assertThat(request.body()).isEmpty();
        assertThat(request.authorization()).isNull();

        requests.clear();
        respond("/tokeninfo", 200, "{\"scope\":\"openid email\",\"issued_to\":\""
                + CLIENT_ID + "\"}");
        assertThat(provider().verify(ConnectionProvider.GOOGLE_SHEETS, ACCESS_TOKEN, sheetsScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);

        requests.clear();
        respond("/tokeninfo", 200, "{\"scope\":\"" + SHEETS_SCOPES
                + "\",\"issued_to\":\"another-synthetic-client\"}");
        assertThat(provider().verify(ConnectionProvider.GOOGLE_SHEETS, ACCESS_TOKEN, sheetsScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);

        requests.clear();
        respond("/tokeninfo", 400, "{\"error\":\"invalid_token\",\"error_description\":\""
                + ACCESS_TOKEN + "\"}");
        assertThat(provider().verify(ConnectionProvider.GOOGLE_SHEETS, ACCESS_TOKEN, sheetsScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);

        requests.clear();
        respond("/tokeninfo", 429, "synthetic throttle details");
        assertThat(provider().verify(ConnectionProvider.GOOGLE_SHEETS, ACCESS_TOKEN, sheetsScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE);
    }

    @Test
    void doesNotFollowRedirectsOrSendRequestsWhenRequiredScopeIsAbsent() {
        responses.put("/gmail-profile",
                respond("/gmail-profile", 302, "redirect body")
                        .withHeader("Location", baseUrl() + "/redirect-target"));

        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE);
        assertThat(requests).hasSize(1);

        requests.clear();
        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, List.of("openid", "email")).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);
        assertThat(requests).isEmpty();
    }

    @Test
    void rejectsOversizedResponsesAndInvalidAuthorizationInputWithSanitizedFailures() {
        respond("/token", 200, tokenJson(GMAIL_SCOPES));
        assertThatThrownBy(() -> provider().exchangeAuthorizationCode("bad\ncode"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageNotContaining("bad");
        assertThat(requests).isEmpty();

        respond("/gmail-profile", 200, "x".repeat(64 * 1024 + 1));
        assertThat(provider().verify(ConnectionProvider.GMAIL, ACCESS_TOKEN, gmailScopes()).outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE);
    }

    @Test
    void googleClientPropertiesRedactCredentialsAndRejectUntrustedRedirects() {
        GoogleOAuthProperties properties = new GoogleOAuthProperties(
                CLIENT_ID,
                CLIENT_SECRET,
                URI.create("https://workspace.example.test/oauth/google/callback"),
                URI.create("https://app.example.test/connections"),
                Duration.ofMinutes(10));

        assertThat(properties.toString()).doesNotContain(CLIENT_ID, CLIENT_SECRET);
        assertThatThrownBy(() -> new GoogleOAuthProperties(
                CLIENT_ID,
                CLIENT_SECRET,
                URI.create("http://attacker.example.test/oauth/google/callback"),
                URI.create("https://app.example.test/connections"),
                Duration.ofMinutes(10)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new GoogleOAuthProperties(
                CLIENT_ID,
                CLIENT_SECRET,
                URI.create("https://workspace.example.test/oauth/google/callback?next=https://attacker.test"),
                URI.create("https://app.example.test/connections"),
                Duration.ofMinutes(10)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private GoogleOAuthProvider provider() {
        Duration timeout = Duration.ofSeconds(2);
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(timeout);
        RestClient restClient = RestClient.builder().requestFactory(requestFactory).build();
        GoogleOAuthProperties properties = new GoogleOAuthProperties(
                CLIENT_ID,
                CLIENT_SECRET,
                URI.create("http://localhost:8080/oauth/google/callback"),
                URI.create("http://localhost:3000/connections"),
                Duration.ofMinutes(10));
        GoogleOAuthProvider.Endpoints endpoints = new GoogleOAuthProvider.Endpoints(
                URI.create(baseUrl() + "/authorize"),
                URI.create(baseUrl() + "/token"),
                URI.create(baseUrl() + "/gmail-profile"),
                URI.create(baseUrl() + "/tokeninfo"));
        return new GoogleOAuthProvider(restClient, properties, new GoogleOAuthScopePolicy(),
                new ObjectMapper(), endpoints);
    }

    private void handle(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        requests.add(new CapturedRequest(
                exchange.getRequestMethod(),
                exchange.getRequestURI().getPath(),
                exchange.getRequestURI().getRawQuery(),
                exchange.getRequestHeaders().getFirst("Content-Type"),
                exchange.getRequestHeaders().getFirst("Authorization"),
                body));
        Response response = responses.getOrDefault(exchange.getRequestURI().getPath(), new Response(404, "{}"));
        if (response.location() != null) {
            exchange.getResponseHeaders().set("Location", response.location());
        }
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        byte[] responseBody = response.body().getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(response.status(), responseBody.length);
        try (var output = exchange.getResponseBody()) {
            output.write(responseBody);
        }
    }

    private Response respond(String path, int status, String body) {
        Response response = new Response(status, body);
        responses.put(path, response);
        return response;
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private CapturedRequest onlyRequest() {
        assertThat(requests).hasSize(1);
        return requests.getFirst();
    }

    private static String tokenJson(String scopes) {
        return "{\"access_token\":\"" + ACCESS_TOKEN
                + "\",\"refresh_token\":\"" + REFRESH_TOKEN
                + "\",\"token_type\":\"Bearer\",\"expires_in\":3600,\"scope\":\""
                + scopes + "\"}";
    }

    private static List<String> gmailScopes() {
        return List.of("openid", "email", "https://www.googleapis.com/auth/gmail.metadata");
    }

    private static List<String> sheetsScopes() {
        return List.of("openid", "email", "https://www.googleapis.com/auth/spreadsheets");
    }

    private static Map<String, String> query(String value) {
        return form(value);
    }

    private static Map<String, String> form(String value) {
        Map<String, String> parsed = new LinkedHashMap<>();
        if (value == null || value.isBlank()) {
            return parsed;
        }
        for (String pair : value.split("&")) {
            String[] parts = pair.split("=", 2);
            parsed.put(decode(parts[0]), parts.length == 1 ? "" : decode(parts[1]));
        }
        return parsed;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private record CapturedRequest(
            String method,
            String path,
            String rawQuery,
            String contentType,
            String authorization,
            String body) {
    }

    private record Response(int status, String body, String location) {
        Response(int status, String body) {
            this(status, body, null);
        }

        Response withHeader(String name, String value) {
            if (!"Location".equals(name)) {
                throw new IllegalArgumentException("Unsupported test response header");
            }
            return new Response(status, body, value);
        }
    }
}
