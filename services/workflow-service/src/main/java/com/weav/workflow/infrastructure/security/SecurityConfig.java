package com.weav.workflow.infrastructure.security;

import com.weav.workflow.infrastructure.web.ApiErrorResponse;
import com.weav.workflow.infrastructure.web.CorrelationIdFilter;
import com.weav.workflow.infrastructure.workspace.WorkspaceClient;
import com.weav.workflow.infrastructure.workspace.WorkspaceClientProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.access.AccessDeniedException;
import tools.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties({JwtProperties.class, WorkspaceClientProperties.class})
public class SecurityConfig {

    private static final String WEBHOOK_PATH = "/webhooks/*";
    private static final String INTERNAL_USAGE_PATH = "/internal/workspaces/*/connections/*/usage";

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            ApiAuthenticationEntryPoint authenticationEntryPoint,
            ApiAccessDeniedHandler accessDeniedHandler,
            InternalServiceKeyFilter internalServiceKeyFilter,
            CorrelationIdFilter correlationIdFilter) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers(HttpMethod.HEAD, INTERNAL_USAGE_PATH).denyAll()
                        .requestMatchers(HttpMethod.GET, INTERNAL_USAGE_PATH).permitAll()
                        .requestMatchers(HttpMethod.POST, WEBHOOK_PATH).permitAll()
                        .anyRequest().authenticated())
                .httpBasic(AbstractHttpConfigurer::disable)
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(Customizer.withDefaults())
                        .authenticationEntryPoint(authenticationEntryPoint))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .formLogin(AbstractHttpConfigurer::disable);

        http.addFilterBefore(internalServiceKeyFilter, UsernamePasswordAuthenticationFilter.class);
        http.addFilterBefore(correlationIdFilter, InternalServiceKeyFilter.class);
        return http.build();
    }

    @Bean
    public InternalServiceKeyFilter internalServiceKeyFilter(
            @Value("${weav.internal.service-key:}") String configuredServiceKey,
            ApiAuthenticationEntryPoint authenticationEntryPoint) {
        return new InternalServiceKeyFilter(configuredServiceKey, authenticationEntryPoint);
    }

    @Bean
    public FilterRegistrationBean<InternalServiceKeyFilter> internalServiceKeyFilterRegistration(
            InternalServiceKeyFilter filter) {
        FilterRegistrationBean<InternalServiceKeyFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public CorrelationIdFilter correlationIdFilter() {
        return new CorrelationIdFilter();
    }

    @Bean
    public FilterRegistrationBean<CorrelationIdFilter> correlationIdFilterRegistration(
            CorrelationIdFilter filter) {
        FilterRegistrationBean<CorrelationIdFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public ApiAuthenticationEntryPoint apiAuthenticationEntryPoint(ObjectMapper objectMapper) {
        return new ApiAuthenticationEntryPoint(objectMapper);
    }

    @Bean
    public ApiAccessDeniedHandler apiAccessDeniedHandler(ObjectMapper objectMapper) {
        return new ApiAccessDeniedHandler(objectMapper);
    }

    @Bean
    public Clock jwtClock() {
        return Clock.systemUTC();
    }

    @Bean
    public JwtDecoder jwtDecoder(JwtProperties properties, Clock jwtClock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(
                        new SecretKeySpec(properties.accessSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(properties, jwtClock));
        return decoder;
    }

    @Bean
    public WorkspaceClient workspaceClient(WorkspaceClientProperties properties, ObjectMapper objectMapper) {
        return new WorkspaceClient(properties, objectMapper);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    public static final class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

        private final ObjectMapper objectMapper;

        public ApiAuthenticationEntryPoint(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        public void commence(
                HttpServletRequest request,
                HttpServletResponse response,
                AuthenticationException authenticationException) throws IOException {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            String correlationId = CorrelationIdFilter.requestId(request);
            response.setHeader(CorrelationIdFilter.HEADER_NAME, correlationId);
            objectMapper.writeValue(response.getOutputStream(), ApiErrorResponse.of(
                    "UNAUTHORIZED",
                    "Authentication is required",
                    HttpStatus.UNAUTHORIZED.value(),
                    com.weav.workflow.infrastructure.web.WebhookRequestPath.sanitizedPath(request),
                    List.of()));
        }
    }

    public static final class ApiAccessDeniedHandler implements AccessDeniedHandler {

        private final ObjectMapper objectMapper;

        public ApiAccessDeniedHandler(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        public void handle(
                HttpServletRequest request,
                HttpServletResponse response,
                AccessDeniedException accessDeniedException) throws IOException {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            String correlationId = CorrelationIdFilter.requestId(request);
            response.setHeader(CorrelationIdFilter.HEADER_NAME, correlationId);
            objectMapper.writeValue(response.getOutputStream(), ApiErrorResponse.of(
                    "FORBIDDEN",
                    "You do not have permission to perform this action",
                    HttpStatus.FORBIDDEN.value(),
                    com.weav.workflow.infrastructure.web.WebhookRequestPath.sanitizedPath(request),
                    List.of()));
        }
    }

    private static final class JwtAccessTokenValidator implements OAuth2TokenValidator<Jwt> {

        private static final String ACCESS_TOKEN_USE = "access";
        private static final Set<String> SYSTEM_ROLES = Set.of("USER", "ADMIN");
        private static final Set<String> USER_STATUSES = Set.of("ACTIVE", "DISABLED");
        private static final OAuth2Error INVALID_TOKEN =
                new OAuth2Error("invalid_token", "The access token is invalid", null);

        private final JwtProperties properties;
        private final Clock clock;

        private JwtAccessTokenValidator(JwtProperties properties, Clock clock) {
            this.properties = properties;
            this.clock = clock;
        }

        @Override
        public OAuth2TokenValidatorResult validate(Jwt token) {
            try {
                if (!hasExpectedIdentity(token)
                        || !hasExpectedAuthorizationClaims(token)
                        || !hasValidTimeClaims(token)) {
                    return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
                }
                return OAuth2TokenValidatorResult.success();
            } catch (RuntimeException exception) {
                return OAuth2TokenValidatorResult.failure(INVALID_TOKEN);
            }
        }

        private boolean hasExpectedIdentity(Jwt token) {
            return properties.issuer().equals(token.getClaimAsString("iss"))
                    && token.getAudience().contains(properties.audience())
                    && ACCESS_TOKEN_USE.equals(token.getClaimAsString("token_use"))
                    && isUuid(token.getSubject())
                    && isUuid(token.getId())
                    && isUuid(token.getClaimAsString("sid"));
        }

        private boolean hasExpectedAuthorizationClaims(Jwt token) {
            return SYSTEM_ROLES.contains(token.getClaimAsString("system_role"))
                    && USER_STATUSES.contains(token.getClaimAsString("user_status"));
        }

        private boolean hasValidTimeClaims(Jwt token) {
            Instant issuedAt = token.getIssuedAt();
            Instant notBefore = token.getNotBefore();
            Instant expiresAt = token.getExpiresAt();
            if (issuedAt == null || notBefore == null || expiresAt == null) {
                return false;
            }
            if (!expiresAt.isAfter(issuedAt) || !expiresAt.isAfter(notBefore)) {
                return false;
            }

            Instant now = clock.instant();
            if (issuedAt.isAfter(now.plus(properties.clockSkew()))
                    || notBefore.isAfter(now.plus(properties.clockSkew()))) {
                return false;
            }
            return expiresAt.plus(properties.clockSkew()).isAfter(now);
        }

        private boolean isUuid(String value) {
            if (value == null) {
                return false;
            }
            try {
                UUID.fromString(value);
                return true;
            } catch (IllegalArgumentException exception) {
                return false;
            }
        }
    }
}
