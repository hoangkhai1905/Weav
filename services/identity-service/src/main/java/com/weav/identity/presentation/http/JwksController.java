package com.weav.identity.presentation.http;

import com.weav.identity.infrastructure.security.JwtSigningKeys;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/** Public signing keys for access-token verifiers (ID-6). Public members only. */
@RestController
public class JwksController {

    private final JwtSigningKeys keys;

    public JwksController(JwtSigningKeys keys) {
        this.keys = keys;
    }

    @GetMapping(value = "/.well-known/jwks.json", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> jwks() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .body(keys.publicSet().toPublicJWKSet().toString());
    }
}
