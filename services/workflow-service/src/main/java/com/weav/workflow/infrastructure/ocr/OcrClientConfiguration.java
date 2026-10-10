package com.weav.workflow.infrastructure.ocr;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;
import org.springframework.http.client.JdkClientHttpRequestFactory;

import java.net.http.HttpClient;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(OcrClientProperties.class)
public class OcrClientConfiguration {

    @Bean("ocrRestClient")
    RestClient ocrRestClient(OcrClientProperties properties) {
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(ocrHttpClient(properties));
        requestFactory.setReadTimeout(properties.readTimeout());
        return RestClient.builder().requestFactory(requestFactory).build();
    }

    // HTTP/1.1 only: the JDK default sends an h2c upgrade over plain http, which the OCR service's
    // uvicorn rejects ("Unsupported upgrade request") and then misreads the JSON body (400).
    static HttpClient ocrHttpClient(OcrClientProperties properties) {
        return HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }
}
