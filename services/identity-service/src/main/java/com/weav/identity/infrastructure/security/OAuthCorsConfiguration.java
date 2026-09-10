package com.weav.identity.infrastructure.security;

import com.weav.identity.application.dto.OAuthConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/** CORS is exact-origin and credentials-safe for the web OAuth routes and current-user GET. */
@Configuration(proxyBeanMethods = false)
public class OAuthCorsConfiguration {

    @Bean
    public CorsConfigurationSource corsConfigurationSource(OAuthConfiguration configuration) {
        List<String> allowedOrigins = configuration.webClient()
                .map(registration -> List.copyOf(registration.allowedOrigins()))
                .orElseGet(List::of);

        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(allowedOrigins);
        cors.setAllowedMethods(List.of("GET", "POST", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Accept", "Authorization", "Content-Type", "X-XSRF-TOKEN"));
        cors.setAllowCredentials(true);
        cors.setMaxAge(600L);

        CorsConfiguration currentUserCors = new CorsConfiguration();
        currentUserCors.setAllowedOrigins(allowedOrigins);
        currentUserCors.setAllowedMethods(List.of("GET", "OPTIONS"));
        currentUserCors.setAllowedHeaders(List.of("Accept", "Authorization"));
        currentUserCors.setAllowCredentials(true);
        currentUserCors.setMaxAge(600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/auth/oauth/**", cors);
        source.registerCorsConfiguration("/auth/web/**", cors);
        source.registerCorsConfiguration("/users/me/oauth/**", cors);
        source.registerCorsConfiguration("/users/me/oauth-accounts/**", cors);
        source.registerCorsConfiguration("/users/me", currentUserCors);
        return source;
    }
}
