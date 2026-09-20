package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.GoogleOAuthCallbackResult;
import com.weav.workspace.application.usecase.CompleteConnectionOAuthUseCase;
import com.weav.workspace.infrastructure.config.GoogleOAuthProperties;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;

/** Public Google callback; redirects only to the server-configured frontend return URL. */
@RestController
public final class GoogleOAuthCallbackController {

    private final CompleteConnectionOAuthUseCase completeOAuth;
    private final GoogleOAuthProperties properties;

    public GoogleOAuthCallbackController(
            CompleteConnectionOAuthUseCase completeOAuth,
            GoogleOAuthProperties properties) {
        this.completeOAuth = completeOAuth;
        this.properties = properties;
    }

    @GetMapping("/oauth/google/callback")
    public ResponseEntity<Void> complete(
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String error) {
        GoogleOAuthCallbackResult result = completeOAuth.executeForCallback(state, code, error);
        return ResponseEntity.status(HttpStatus.FOUND)
                .location(frontendLocation(result))
                .cacheControl(CacheControl.noStore())
                .build();
    }

    private URI frontendLocation(GoogleOAuthCallbackResult result) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromUri(properties.frontendReturnUrl());
        if (result.connectionId() != null) {
            builder.queryParam("connectionId", result.connectionId());
        }
        if (result.succeeded()) {
            builder.queryParam("oauth", "success");
        } else {
            builder.queryParam("oauth", "failed");
            builder.queryParam("reason", result.failureReason().code());
        }
        return builder.build().encode().toUri();
    }
}
