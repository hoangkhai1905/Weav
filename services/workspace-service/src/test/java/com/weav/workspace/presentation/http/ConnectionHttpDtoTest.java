package com.weav.workspace.presentation.http;

import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.presentation.http.request.CreateConnectionRequest;
import com.weav.workspace.presentation.http.request.SaveCredentialRequest;
import com.weav.workspace.presentation.http.request.UpdateConnectionRequest;
import com.weav.workspace.presentation.http.response.OAuthAuthorizationHttpResponse;
import com.weav.workspace.presentation.http.response.ResolvedConnectionHttpResponse;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectionHttpDtoTest {

    @Test
    void credentialBearingRequestAndResponseDiagnosticsAreRedacted() {
        String secret = "synthetic-secret-do-not-log";
        String state = "synthetic-oauth-state-do-not-log";

        assertThat(new CreateConnectionRequest(
                "HTTP account", ConnectionProvider.HTTP, ConnectionAuthType.API_KEY,
                Map.of("apiKey", secret)).toString())
                .doesNotContain(secret);
        assertThat(new SaveCredentialRequest(Map.of("apiKey", secret), null).toString())
                .doesNotContain(secret);
        assertThat(new UpdateConnectionRequest("HTTP account", Map.of("apiKey", secret)).toString())
                .doesNotContain(secret);
        assertThat(new OAuthAuthorizationHttpResponse(
                "https://accounts.google.test/authorize?state=" + state).toString())
                .doesNotContain(state);
        assertThat(new ResolvedConnectionHttpResponse(
                ConnectionProvider.GMAIL,
                ConnectionAuthType.OAUTH2,
                Map.of("accessToken", secret)).toString())
                .doesNotContain(secret);
    }
}
