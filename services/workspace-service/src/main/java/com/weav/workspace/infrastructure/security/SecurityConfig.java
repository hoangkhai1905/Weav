package com.weav.workspace.infrastructure.security;

import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Clock;

@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties({JwtProperties.class, InternalServiceKeyProperties.class})
public class SecurityConfig {

    private static final DefaultBearerTokenResolver DEFAULT_BEARER = new DefaultBearerTokenResolver();

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            ApiAuthenticationEntryPoint authenticationEntryPoint,
            ApiAccessDeniedHandler accessDeniedHandler,
            InternalServiceKeyFilter internalServiceKeyFilter,
            RequestCorrelationFilter requestCorrelationFilter) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/oauth/google/callback").permitAll()
                        .requestMatchers("/internal/workspaces/**").authenticated()
                        .anyRequest().authenticated()
                )
                .httpBasic(AbstractHttpConfigurer::disable)
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(Customizer.withDefaults())
                        // Internal calls carry RS256 service JWTs that InternalServiceKeyFilter owns, not user HS256 tokens.
                        .bearerTokenResolver(request -> InternalServiceKeyFilter.isInternalRequest(request)
                                ? null : DEFAULT_BEARER.resolve(request))
                        .authenticationEntryPoint(authenticationEntryPoint))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .formLogin(AbstractHttpConfigurer::disable);

        http.addFilterBefore(internalServiceKeyFilter, UsernamePasswordAuthenticationFilter.class);
        http.addFilterBefore(requestCorrelationFilter, InternalServiceKeyFilter.class);

        return http.build();
    }

    @Bean
    public InternalServiceKeyFilter internalServiceKeyFilter(
            InternalServiceKeyProperties properties,
            ApiAuthenticationEntryPoint authenticationEntryPoint,
            InternalServiceJwtVerifier internalServiceJwtVerifier) {
        return new InternalServiceKeyFilter(properties, authenticationEntryPoint, internalServiceJwtVerifier);
    }

    @Bean
    public InternalServiceJwtVerifier internalServiceJwtVerifier(InternalServiceKeyProperties properties, Clock jwtClock) {
        return new InternalServiceJwtVerifier(properties.serviceJwksFile(), jwtClock);
    }

    @Bean
    public FilterRegistrationBean<InternalServiceKeyFilter> internalServiceKeyFilterRegistration(
            InternalServiceKeyFilter filter) {
        FilterRegistrationBean<InternalServiceKeyFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public RequestCorrelationFilter requestCorrelationFilter() {
        return new RequestCorrelationFilter();
    }

    @Bean
    public FilterRegistrationBean<RequestCorrelationFilter> requestCorrelationFilterRegistration(
            RequestCorrelationFilter filter) {
        FilterRegistrationBean<RequestCorrelationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public Clock jwtClock() {
        return Clock.systemUTC();
    }

    @Bean
    public JwtDecoder jwtDecoder(JwtProperties properties, Clock jwtClock) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(
                        new SecretKeySpec(
                                properties.accessSecret().getBytes(StandardCharsets.UTF_8),
                                "HmacSHA256"))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(properties, jwtClock));
        return decoder;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
