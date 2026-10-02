package com.weav.identity.presentation.http.response;

import com.weav.identity.application.dto.OAuthAccountMetadata;

public record OAuthLinkExchangeResponse(
        String outcome,
        OAuthAccountMetadata oauthAccount
) {

    @Override
    public String toString() {
        return "OAuthLinkExchangeResponse[outcome=" + outcome + ", oauthAccount=<redacted>]";
    }
}
