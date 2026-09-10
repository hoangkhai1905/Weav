package com.weav.identity.presentation.http;

import org.testcontainers.containers.GenericContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class MailCatcherTestSupport {

    private static final Pattern OTP = Pattern.compile("security code is ([0-9]{6})");

    private MailCatcherTestSupport() {
    }

    static String awaitOtpCode(
            GenericContainer<?> mailpit,
            ObjectMapper objectMapper,
            String recipient
    ) throws Exception {
        HttpClient client = HttpClient.newHttpClient();
        long deadline = System.nanoTime() + Duration.ofSeconds(8).toNanos();
        while (System.nanoTime() < deadline) {
            JsonNode messages = getMessages(client, mailpit, objectMapper);
            for (JsonNode message : messages.path("messages")) {
                if (!hasRecipient(message, recipient)) continue;
                String id = text(message, "ID", "id");
                if (id == null) continue;
                String detail = getMessage(client, mailpit, id);
                Matcher matcher = OTP.matcher(detail);
                if (matcher.find()) return matcher.group(1);
            }
            Thread.sleep(75);
        }
        throw new AssertionError("Mail catcher did not receive an OTP for the test recipient");
    }

    private static JsonNode getMessages(
            HttpClient client,
            GenericContainer<?> mailpit,
            ObjectMapper objectMapper
    ) throws Exception {
        HttpResponse<String> response = client.send(
                request(mailpit, "/api/v1/messages"), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        return objectMapper.readTree(response.body());
    }

    private static String getMessage(HttpClient client, GenericContainer<?> mailpit, String id) throws Exception {
        HttpResponse<String> response = client.send(
                request(mailpit, "/api/v1/message/" + id), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        return response.body();
    }

    private static HttpRequest request(GenericContainer<?> mailpit, String path) {
        return HttpRequest.newBuilder(URI.create(
                        "http://" + mailpit.getHost() + ":" + mailpit.getMappedPort(8025) + path))
                .timeout(Duration.ofSeconds(2))
                .GET()
                .build();
    }

    private static boolean hasRecipient(JsonNode message, String recipient) {
        for (JsonNode target : message.path("To")) {
            if (recipient.equalsIgnoreCase(text(target, "Address", "address"))) return true;
        }
        for (JsonNode target : message.path("to")) {
            if (recipient.equalsIgnoreCase(text(target, "Address", "address"))) return true;
        }
        return false;
    }

    private static String text(JsonNode node, String primary, String fallback) {
        JsonNode value = node.get(primary);
        if (value == null || value.isNull()) value = node.get(fallback);
        return value == null || value.isNull() ? null : value.asText();
    }
}
