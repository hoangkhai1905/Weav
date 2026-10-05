package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.security.ServiceJwtSigner;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AiClientProperties.class)
public class AiClientConfiguration {
    @Bean("aiRestClient")
    RestClient aiRestClient(AiClientProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.readTimeout());
        return RestClient.builder().requestFactory(factory).build();
    }

    @Bean("aiServiceJwtSigner")
    ServiceJwtSigner aiServiceJwtSigner(AiClientProperties properties, ResourceLoader resourceLoader) {
        return new ServiceJwtSigner(resourceLoader, properties.keyId(), properties.privateKeyLocation(), properties.tokenLifetime());
    }

    @Bean
    NodeExecutor aiExtractExecutor(AiClient client) {
        return new AiNodeExecutor("ai.extract", client);
    }

    @Bean
    NodeExecutor aiClassifyExecutor(AiClient client) {
        return new AiNodeExecutor("ai.classify", client);
    }

    @Bean
    NodeExecutor aiSummarizeExecutor(AiClient client) {
        return new AiNodeExecutor("ai.summarize", client);
    }

    @Bean
    NodeExecutor aiGenerateExecutor(AiClient client) {
        return new AiNodeExecutor("ai.generate", client);
    }
}
