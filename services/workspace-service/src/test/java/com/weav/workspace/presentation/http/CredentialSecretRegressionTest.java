package com.weav.workspace.presentation.http;

import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.application.dto.ResolvedConnectionCredential;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.presentation.http.request.SaveCredentialRequest;
import com.weav.workspace.presentation.http.response.ResolvedConnectionHttpResponse;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CredentialSecretRegressionTest {

    @Test
    void credentialAndOAuthDiagnosticsRedactManualAndGoogleSecrets() {
        String telegramToken = "telegram-secret-123";
        String httpPassword = "http-password-123";
        String googleAccessToken = "google-access-secret";
        String googleRefreshToken = "google-refresh-secret";

        assertThat(new SaveCredentialCommand(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                Map.of("token", telegramToken),
                null).toString())
                .doesNotContain(telegramToken);
        assertThat(new SaveCredentialRequest(Map.of("password", httpPassword), null).toString())
                .doesNotContain(httpPassword);

        GoogleOAuthTokenResponse tokenResponse = new GoogleOAuthTokenResponse(
                googleAccessToken,
                googleRefreshToken,
                "Bearer",
                List.of("openid", "email", "spreadsheets"),
                3600);
        GoogleOAuthRefreshResponse refreshResponse = new GoogleOAuthRefreshResponse(
                googleAccessToken,
                googleRefreshToken,
                "Bearer",
                List.of("openid", "email", "spreadsheets"),
                3600);
        assertThat(tokenResponse.toString()).doesNotContain(googleAccessToken, googleRefreshToken);
        assertThat(refreshResponse.toString()).doesNotContain(googleAccessToken, googleRefreshToken);

        ResolvedConnectionCredential resolved = new ResolvedConnectionCredential(
                ConnectionProvider.GOOGLE_SHEETS,
                ConnectionAuthType.OAUTH2,
                Map.of("accessToken", googleAccessToken));
        assertThat(resolved.toString()).doesNotContain(googleAccessToken, googleRefreshToken);
        assertThat(ResolvedConnectionHttpResponse.from(resolved).toString())
                .doesNotContain(googleAccessToken, googleRefreshToken);
    }
}
