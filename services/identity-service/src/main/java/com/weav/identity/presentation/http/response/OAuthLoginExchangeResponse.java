package com.weav.identity.presentation.http.response;

public record OAuthLoginExchangeResponse(
        String outcome,
        String accessToken,
        String tokenType,
        long expiresIn,
        UserResponse user
) {

    @Override
    public String toString() {
        return "OAuthLoginExchangeResponse[outcome=" + outcome
                + ", accessToken=<redacted>, tokenType=" + tokenType
                + ", expiresIn=" + expiresIn + ", userId="
                + (user == null ? "<none>" : user.id()) + "]";
    }
}
