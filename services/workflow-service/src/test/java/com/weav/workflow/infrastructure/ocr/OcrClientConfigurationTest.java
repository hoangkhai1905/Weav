package com.weav.workflow.infrastructure.ocr;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class OcrClientConfigurationTest {

    @Test
    void ocrHttpClientNeverOffersH2cUpgradeToTheOcrService() {
        OcrClientProperties properties = new OcrClientProperties(true, true, false, true, true, false,
                URI.create("http://ocr.internal"), "key-id", "file:///key.pem",
                Duration.ofSeconds(5), Duration.ofSeconds(100), Duration.ofSeconds(60), 1_048_576);

        HttpClient client = OcrClientConfiguration.ocrHttpClient(properties);

        assertThat(client.version()).isEqualTo(HttpClient.Version.HTTP_1_1);
        assertThat(client.followRedirects()).isEqualTo(HttpClient.Redirect.NEVER);
        assertThat(client.connectTimeout()).contains(Duration.ofSeconds(5));
    }
}
