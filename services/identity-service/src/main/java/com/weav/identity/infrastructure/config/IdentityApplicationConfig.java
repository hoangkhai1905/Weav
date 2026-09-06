package com.weav.identity.infrastructure.config;

import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.usecase.GetCurrentUserUseCase;
import com.weav.identity.application.usecase.LoginUseCase;
import com.weav.identity.application.usecase.LogoutUseCase;
import com.weav.identity.application.usecase.RefreshSessionUseCase;
import com.weav.identity.application.usecase.RegisterUserUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.infrastructure.persistence.SpringTransactionRunner;
import com.weav.identity.infrastructure.security.BcryptPasswordHasher;
import com.weav.identity.infrastructure.security.JwtAccessTokenIssuer;
import com.weav.identity.infrastructure.security.JwtAccessTokenValidator;
import com.weav.identity.infrastructure.security.JwtProperties;
import com.weav.identity.infrastructure.security.SecureRefreshTokenGenerator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;

@Configuration(proxyBeanMethods = false)
public class IdentityApplicationConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public PasswordHasher passwordHasher(PasswordEncoder passwordEncoder) {
        return new BcryptPasswordHasher(passwordEncoder);
    }

    @Bean
    public RefreshTokenGenerator refreshTokenGenerator() {
        return new SecureRefreshTokenGenerator(new SecureRandom());
    }

    @Bean
    public JwtEncoder jwtEncoder(JwtProperties properties) {
        return NimbusJwtEncoder.withSecretKey(accessTokenKey(properties))
                .algorithm(MacAlgorithm.HS256)
                .build();
    }

    @Bean
    public JwtDecoder jwtDecoder(JwtProperties properties, Clock clock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(accessTokenKey(properties))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(properties, clock));
        return decoder;
    }

    @Bean
    public AccessTokenIssuer accessTokenIssuer(JwtEncoder jwtEncoder, JwtProperties properties, Clock clock) {
        return new JwtAccessTokenIssuer(jwtEncoder, properties, clock);
    }

    @Bean
    public TransactionRunner transactionRunner(PlatformTransactionManager transactionManager) {
        return new SpringTransactionRunner(new TransactionTemplate(transactionManager));
    }

    @Bean
    public AuthInputPolicy authInputPolicy() {
        return new AuthInputPolicy();
    }

    @Bean
    public RegisterUserUseCase registerUserUseCase(
            UserRepository userRepository,
            PasswordHasher passwordHasher,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock
    ) {
        return new RegisterUserUseCase(
                userRepository,
                passwordHasher,
                transactionRunner,
                inputPolicy,
                clock
        );
    }

    @Bean
    public LoginUseCase loginUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            PasswordHasher passwordHasher,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock,
            JwtProperties properties
    ) {
        return new LoginUseCase(
                userRepository,
                sessionRepository,
                passwordHasher,
                refreshTokenGenerator,
                accessTokenIssuer,
                transactionRunner,
                inputPolicy,
                clock,
                properties.refreshExpiresIn()
        );
    }

    @Bean
    public GetCurrentUserUseCase getCurrentUserUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            Clock clock
    ) {
        return new GetCurrentUserUseCase(userRepository, sessionRepository, clock);
    }

    @Bean
    public RefreshSessionUseCase refreshSessionUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        return new RefreshSessionUseCase(
                userRepository,
                sessionRepository,
                refreshTokenGenerator,
                accessTokenIssuer,
                transactionRunner,
                clock
        );
    }

    @Bean
    public LogoutUseCase logoutUseCase(
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        return new LogoutUseCase(sessionRepository, refreshTokenGenerator, transactionRunner, clock);
    }

    private static SecretKey accessTokenKey(JwtProperties properties) {
        return new SecretKeySpec(
                properties.accessSecret().getBytes(StandardCharsets.UTF_8),
                "HmacSHA256"
        );
    }
}
