package com.weav.identity.infrastructure.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.util.StringUtils;

/**
 * Enables OAuth infrastructure only when the operator explicitly enables it
 * or supplies provider credentials. Empty template values therefore keep the
 * core Identity application bootable without registering OAuth routes.
 *
 * <p>An explicit non-false value intentionally enables the configuration so
 * {@link OAuthProperties} can reject invalid modes and incomplete settings at
 * startup instead of silently disabling a requested provider.</p>
 */
public final class OAuthEnabledCondition implements Condition {

    private static final String ENABLED_PROPERTY = "weav.oauth.enabled";
    private static final String CLIENT_ID_PROPERTY = "weav.oauth.google.client-id";
    private static final String CLIENT_SECRET_PROPERTY = "weav.oauth.google.client-secret";

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String configured = context.getEnvironment().getProperty(ENABLED_PROPERTY);
        if (StringUtils.hasText(configured)) {
            return !"false".equalsIgnoreCase(configured.trim());
        }

        return StringUtils.hasText(context.getEnvironment().getProperty(CLIENT_ID_PROPERTY))
                || StringUtils.hasText(context.getEnvironment().getProperty(CLIENT_SECRET_PROPERTY));
    }
}
