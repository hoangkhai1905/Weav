package com.weav.identity.presentation.http;

import com.weav.identity.TestcontainersConfiguration;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@Import(TestcontainersConfiguration.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AvatarHttpIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String ACCESS_KEY = "weavtest";
    private static final String SECRET_KEY = "weavtest-secret";
    private static final String BUCKET = "weav-avatar-http-test";

    @Container
    static final GenericContainer<?> minio = new GenericContainer<>(
            DockerImageName.parse("minio/minio:RELEASE.2024-06-04T19-20-08Z"))
            .withExposedPorts(9000)
            .withEnv("MINIO_ROOT_USER", ACCESS_KEY)
            .withEnv("MINIO_ROOT_PASSWORD", SECRET_KEY)
            .withCommand("server", "/data");

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @DynamicPropertySource
    static void storageProperties(DynamicPropertyRegistry registry) {
        registry.add("weav.avatar.storage.endpoint",
                () -> "http://" + minio.getHost() + ":" + minio.getMappedPort(9000));
        registry.add("weav.avatar.storage.region", () -> "us-east-1");
        registry.add("weav.avatar.storage.bucket", () -> BUCKET);
        registry.add("weav.avatar.storage.access-key", () -> ACCESS_KEY);
        registry.add("weav.avatar.storage.secret-key", () -> SECRET_KEY);
        registry.add("weav.avatar.storage.path-style-access", () -> "true");
    }

    @BeforeAll
    static void createBucket() {
        try (S3Client client = S3Client.builder()
                .endpointOverride(URI.create("http://" + minio.getHost() + ":" + minio.getMappedPort(9000)))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build()) {
            client.createBucket(builder -> builder.bucket(BUCKET));
        }
    }

    @Test
    @Order(1)
    void validatesLifecycleFetchesSignedImageAndHandlesConcurrentReplaceDelete() throws Exception {
        Account first = register("avatar.first");
        Account second = register("avatar.second");
        TokenResponse firstTokens = login(first.email());
        TokenResponse secondTokens = login(second.email());

        assertEquals(404, get("/users/me/avatar", firstTokens.accessToken()).statusCode());
        assertEquals(400, putAvatar(firstTokens.accessToken(), new byte[0], "image/png").statusCode());
        assertEquals(400, putAvatar(firstTokens.accessToken(), new byte[2 * 1024 * 1024 + 1], "image/png").statusCode());
        assertEquals(400, putAvatar(firstTokens.accessToken(), "not-an-image".getBytes(), "application/octet-stream").statusCode());
        assertEquals(400, putAvatar(firstTokens.accessToken(), png(4097, 1), "image/png").statusCode());

        HttpResponse<String> uploaded = putAvatar(firstTokens.accessToken(), png(32, 24), "image/png");
        assertEquals(200, uploaded.statusCode(), uploaded.body());
        JsonNode uploadedJson = objectMapper.readTree(uploaded.body());
        assertTrue(uploadedJson.get("avatarStorageKey").asText().startsWith("avatars/"));
        assertFalse(uploaded.body().contains("passwordHash"));

        HttpResponse<String> avatar = get("/users/me/avatar", firstTokens.accessToken());
        assertEquals(200, avatar.statusCode());
        assertEquals("no-store", avatar.headers().firstValue("Cache-Control").orElseThrow());
        JsonNode avatarJson = objectMapper.readTree(avatar.body());
        assertNotNull(avatarJson.get("url"));
        assertNotNull(avatarJson.get("expiresAt"));
        HttpResponse<byte[]> fetched = httpClient.send(
                HttpRequest.newBuilder(URI.create(avatarJson.get("url").asText())).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, fetched.statusCode());
        assertEquals((byte) 0x89, fetched.body()[0]);
        assertEquals((byte) 'P', fetched.body()[1]);

        assertEquals(404, get("/users/me/avatar", secondTokens.accessToken()).statusCode());

        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<HttpResponse<String>> replacementOne = executor.submit(() -> {
                await(start);
                return putAvatar(firstTokens.accessToken(), png(20, 20), "image/png");
            });
            Future<HttpResponse<String>> replacementTwo = executor.submit(() -> {
                await(start);
                return putAvatar(firstTokens.accessToken(), png(21, 21), "image/png");
            });
            start.countDown();
            assertEquals(200, replacementOne.get(30, SECONDS).statusCode());
            assertEquals(200, replacementTwo.get(30, SECONDS).statusCode());
        } finally {
            executor.shutdownNow();
        }
        assertEquals(200, get("/users/me/avatar", firstTokens.accessToken()).statusCode());

        CountDownLatch replaceDeleteStart = new CountDownLatch(1);
        ExecutorService replaceDeleteExecutor = Executors.newFixedThreadPool(2);
        try {
            Future<HttpResponse<String>> replacing = replaceDeleteExecutor.submit(() -> {
                await(replaceDeleteStart);
                return putAvatar(firstTokens.accessToken(), png(22, 22), "image/png");
            });
            Future<HttpResponse<String>> deleting = replaceDeleteExecutor.submit(() -> {
                await(replaceDeleteStart);
                return deleteAvatar(firstTokens.accessToken());
            });
            replaceDeleteStart.countDown();
            assertEquals(200, replacing.get(30, SECONDS).statusCode());
            assertEquals(204, deleting.get(30, SECONDS).statusCode());
        } finally {
            replaceDeleteExecutor.shutdownNow();
        }

        HttpResponse<String> afterReplaceDelete = get("/users/me/avatar", firstTokens.accessToken());
        assertTrue(afterReplaceDelete.statusCode() == 200 || afterReplaceDelete.statusCode() == 404);

        HttpResponse<String> deleted = deleteAvatar(firstTokens.accessToken());
        assertEquals(204, deleted.statusCode());
        assertTrue(deleted.body().isEmpty());
        assertEquals(404, get("/users/me/avatar", firstTokens.accessToken()).statusCode());

        assertEquals(204, deleteAvatar(firstTokens.accessToken()).statusCode());
        assertEquals(204, delete("/users/me/sessions", secondTokens.accessToken()).statusCode());
        assertEquals(401, get("/users/me/avatar", secondTokens.accessToken()).statusCode());
        assertEquals(401, putAvatar(secondTokens.accessToken(), png(8, 8), "image/png").statusCode());
        assertEquals(401, deleteAvatar(secondTokens.accessToken()).statusCode());

        TokenResponse disabledTokens = login(second.email());
        assertEquals(1, jdbcTemplate.update(
                "update identity.users set status = 'DISABLED' where id = ?", second.id()));
        assertEquals(401, get("/users/me/avatar", disabledTokens.accessToken()).statusCode());
        assertEquals(401, putAvatar(disabledTokens.accessToken(), png(8, 8), "image/png").statusCode());
        assertEquals(401, deleteAvatar(disabledTokens.accessToken()).statusCode());
        assertEquals(401, get("/users/me/avatar", null).statusCode());
    }

    @Test
    @Order(2)
    void mapsStorageOutageToNoStore503AfterACommittedReference() throws Exception {
        Account account = register("avatar.outage");
        TokenResponse tokens = login(account.email());
        assertEquals(200, putAvatar(tokens.accessToken(), png(8, 8), "image/png").statusCode());

        minio.stop();
        try {
            HttpResponse<String> response = get("/users/me/avatar", tokens.accessToken());
            assertEquals(503, response.statusCode());
            assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
            assertFalse(response.body().contains("AccessDeniedException"));
            assertFalse(response.body().contains(SECRET_KEY));
        } finally {
            // The container is intentionally left stopped; this test is last in this class's lifecycle.
        }
    }

    private Account register(String label) throws Exception {
        String email = label + "." + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        HttpResponse<String> response = post("/auth/register", Map.of(
                "email", email,
                "password", PASSWORD,
                "displayName", label));
        assertEquals(201, response.statusCode(), response.body());
        UserResponse user = objectMapper.readValue(response.body(), UserResponse.class);
        return new Account(user.id(), email);
    }

    private TokenResponse login(String email) throws Exception {
        HttpResponse<String> response = post("/auth/login", Map.of("email", email, "password", PASSWORD));
        assertEquals(200, response.statusCode(), response.body());
        return objectMapper.readValue(response.body(), TokenResponse.class);
    }

    private HttpResponse<String> putAvatar(String accessToken, byte[] content, String contentType) throws Exception {
        String boundary = "----weav-avatar-" + UUID.randomUUID();
        byte[] prefix = ("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"avatar.png\"\r\n"
                + "Content-Type: " + contentType + "\r\n\r\n").getBytes();
        byte[] suffix = ("\r\n--" + boundary + "--\r\n").getBytes();
        byte[] body = new byte[prefix.length + content.length + suffix.length];
        System.arraycopy(prefix, 0, body, 0, prefix.length);
        System.arraycopy(content, 0, body, prefix.length, content.length);
        System.arraycopy(suffix, 0, body, prefix.length + content.length, suffix.length);
        return httpClient.send(HttpRequest.newBuilder(uri("/users/me/avatar"))
                .header("Authorization", "Bearer " + accessToken)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(body))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path, String accessToken) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path));
        if (accessToken != null) {
            request.header("Authorization", "Bearer " + accessToken);
        }
        return httpClient.send(request.GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> deleteAvatar(String accessToken) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri("/users/me/avatar"))
                .header("Authorization", "Bearer " + accessToken)
                .DELETE()
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> delete(String path, String accessToken) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                .header("Authorization", "Bearer " + accessToken)
                .DELETE()
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, Object body) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static byte[] png(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                image.setRGB(x, y, new Color((x * 13) & 0xff, (y * 19) & 0xff, 120, 255).getRGB());
            }
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", output)) {
            throw new IllegalStateException("PNG writer unavailable");
        }
        return output.toByteArray();
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(30, SECONDS));
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted", exception);
        }
    }

    private record Account(UUID id, String email) {
    }
}
