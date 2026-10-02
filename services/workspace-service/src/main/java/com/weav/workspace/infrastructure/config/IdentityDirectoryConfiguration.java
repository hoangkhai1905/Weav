package com.weav.workspace.infrastructure.config;

import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.infrastructure.identity.IdentityDirectoryHttpClient;
import com.weav.workspace.infrastructure.identity.IdentityDirectoryProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IdentityDirectoryProperties.class)
public class IdentityDirectoryConfiguration {

    @Bean
    public RestClient identityDirectoryRestClient(IdentityDirectoryProperties properties) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.connectTimeout());
        requestFactory.setReadTimeout(properties.readTimeout());
        return RestClient.builder()
                .baseUrl(properties.baseUrl().toString())
                .requestFactory(requestFactory)
                .build();
    }

    @Bean
    public IdentityDirectoryPort identityDirectoryPort(
            RestClient identityDirectoryRestClient,
            IdentityDirectoryProperties properties) {
        return new IdentityDirectoryHttpClient(identityDirectoryRestClient, properties);
    }
}
