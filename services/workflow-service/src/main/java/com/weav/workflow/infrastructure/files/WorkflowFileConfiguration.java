package com.weav.workflow.infrastructure.files;

import com.weav.workflow.application.port.out.WorkflowFileStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

import java.net.URI;
import java.time.Clock;

/** Wires the S3 store when the settings are complete, otherwise the not-configured one. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(WorkflowFileProperties.class)
class WorkflowFileConfiguration {

    @Bean
    WorkflowFileStore workflowFileStore(
            WorkflowFileProperties properties,
            JdbcTemplate jdbc,
            @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema) {
        if (!properties.isConfigured()) {
            return new UnavailableWorkflowFileStore();
        }
        properties.validate();
        URI endpoint = URI.create(properties.getEndpoint());
        if (endpoint.getScheme() == null || endpoint.getHost() == null
                || endpoint.getRawQuery() != null || endpoint.getRawFragment() != null) {
            throw new IllegalArgumentException("workflow file store endpoint is invalid");
        }
        S3Client client = S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.of(properties.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(properties.getAccessKey(), properties.getSecretKey())))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(properties.isPathStyleAccess()).build())
                .build();
        return new S3WorkflowFileStore(client, new WorkflowFileRepository(jdbc, schema), properties,
                Clock.systemUTC());
    }
}
