package com.weav.workspace.application.port.out;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.dto.GoogleOAuthRefreshResponse;
import com.weav.workspace.application.dto.GoogleOAuthTokenResponse;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.List;

/** Google authorization-code exchange and provider verification boundary. */
public interface GoogleOAuthPort {

    String authorizationUrl(ConnectionProvider provider, String state);

    GoogleOAuthTokenResponse exchangeAuthorizationCode(String authorizationCode);

    GoogleOAuthRefreshResponse refreshAccessToken(String refreshToken);

    ConnectionTestResult verify(
            ConnectionProvider provider,
            String accessToken,
            List<String> grantedScopes);
}
