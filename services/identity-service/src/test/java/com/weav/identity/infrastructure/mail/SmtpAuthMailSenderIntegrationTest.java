package com.weav.identity.infrastructure.mail;

import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.infrastructure.config.MailProperties;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Verifies SMTP delivery against a disposable local mail catcher only. */
@Testcontainers
class SmtpAuthMailSenderIntegrationTest {

    @Container
    static final GenericContainer<?> MAILPIT = new GenericContainer<>(
            DockerImageName.parse("axllent/mailpit:v1.21.8"))
            .withExposedPorts(1025, 8025);

    @Test
    void deliversMessageToDisposableMailCatcher() throws Exception {
        MailProperties properties = new MailProperties();
        properties.setHost(MAILPIT.getHost());
        properties.setPort(MAILPIT.getMappedPort(1025));
        properties.setFrom("no-reply@example.test");
        properties.setConnectionTimeout(Duration.ofSeconds(3));
        properties.setReadTimeout(Duration.ofSeconds(3));
        properties.setWriteTimeout(Duration.ofSeconds(3));

        new SmtpAuthMailSender(properties).send(new AuthMailSender.Message(
                "recipient@example.test", "Mail catcher test", "disposable body"));

        String messages = awaitMessages();
        assertTrue(messages.contains("recipient@example.test"));
        assertTrue(messages.contains("Mail catcher test"));
        assertTrue(messages.contains("disposable body"));
    }

    private static String awaitMessages() throws Exception {
        URI endpoint = URI.create("http://" + MAILPIT.getHost() + ":"
                + MAILPIT.getMappedPort(8025) + "/api/v1/messages");
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(1))
                .GET()
                .build();

        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            if (!response.body().contains("messages\":[]")) return response.body();
            Thread.sleep(50);
        }
        throw new AssertionError("Mail catcher did not receive the message in time");
    }
}
