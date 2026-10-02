package com.weav.workflow.infrastructure.web;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods = false)
public class WorkflowRequestBodyLimitConfiguration {

    @Bean
    WorkflowRequestBodyLimitFilter workflowRequestBodyLimitFilter(ObjectMapper objectMapper) {
        return new WorkflowRequestBodyLimitFilter(objectMapper);
    }

    @Bean
    FilterRegistrationBean<WorkflowRequestBodyLimitFilter> workflowRequestBodyLimitFilterRegistration(
            WorkflowRequestBodyLimitFilter filter) {
        FilterRegistrationBean<WorkflowRequestBodyLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.addUrlPatterns("/workspaces/*", "/webhooks/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
        return registration;
    }
}
