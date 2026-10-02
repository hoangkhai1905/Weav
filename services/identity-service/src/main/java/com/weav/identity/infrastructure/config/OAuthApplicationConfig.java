package com.weav.identity.infrastructure.config;

import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.port.out.KeyedFingerprint;
import com.weav.identity.application.port.out.OAuthProviderClient;
import com.weav.identity.application.port.out.OAuthTransactionStore;
import com.weav.identity.application.usecase.CompleteGoogleLoginUseCase;
import com.weav.identity.application.usecase.LinkGoogleAccountUseCase;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;

import java.security.SecureRandom;

/** Registers OAuth properties without changing the existing core-auth wiring. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(OAuthProperties.class)
public class OAuthApplicationConfig {

    @Bean
    public OAuthConfiguration oauthConfiguration(OAuthProperties properties) {
        return properties.validateAndBuild();
    }

    /**
     * The coordinator is available only when the validated provider/store
     * adapters are enabled. Core authentication remains bootable with OAuth
     * disabled and therefore does not acquire a partially wired flow bean.
    */
    @Bean
    @Conditional(OAuthEnabledCondition.class)
    @ConditionalOnBean({
            OAuthProviderClient.class,
            OAuthTransactionStore.class,
            KeyedFingerprint.class,
            SecureRandom.class,
            LinkGoogleAccountUseCase.class,
            CompleteGoogleLoginUseCase.class
    })
    public OAuthFlowCoordinator oauthFlowCoordinator(
            OAuthConfiguration configuration,
            OAuthProviderClient providerClient,
            OAuthTransactionStore transactionStore,
            KeyedFingerprint keyedFingerprint,
            SecureRandom otpSecureRandom,
            LinkGoogleAccountUseCase linkUseCase,
            CompleteGoogleLoginUseCase loginUseCase
    ) {
        return new OAuthFlowCoordinator(
                configuration,
                providerClient,
                transactionStore,
                keyedFingerprint,
                otpSecureRandom,
                linkUseCase,
                loginUseCase);
    }
}
