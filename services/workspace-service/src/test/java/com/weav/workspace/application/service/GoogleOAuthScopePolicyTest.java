package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GoogleOAuthScopePolicyTest {

    private final GoogleOAuthScopePolicy policy = new GoogleOAuthScopePolicy();

    @Test
    void gmailRequestsIdentityMetadataAndSendScopes() {
        List<String> scopes = policy.requiredScopes(ConnectionProvider.GMAIL);

        assertEquals(List.of(
                "openid",
                "email",
                "https://www.googleapis.com/auth/gmail.metadata",
                "https://www.googleapis.com/auth/gmail.send"), scopes);
        assertFalse(scopes.stream().anyMatch(scope -> scope.contains("gmail.readonly") || scope.contains("mail.google.com")));
        assertTrue(policy.containsRequiredScopes(ConnectionProvider.GMAIL, scopes));
    }

    @Test
    void gmailGrantWithoutSendScopeIsRejectedSoOldConnectionsMustReconnect() {
        assertFalse(policy.containsRequiredScopes(ConnectionProvider.GMAIL, List.of(
                "openid", "email", "https://www.googleapis.com/auth/gmail.metadata")));
    }

    @Test
    void sheetsRequestsOnlyIdentityAndSpreadsheetsScopes() {
        List<String> scopes = policy.requiredScopes(ConnectionProvider.GOOGLE_SHEETS);

        assertEquals(List.of(
                "openid",
                "email",
                "https://www.googleapis.com/auth/spreadsheets"), scopes);
        assertFalse(scopes.stream().anyMatch(scope -> scope.contains("drive")));
        assertTrue(policy.containsRequiredScopes(ConnectionProvider.GOOGLE_SHEETS, scopes));
    }

    @Test
    void requiredScopeMembershipIsCaseSensitiveAndAllowsIncrementalPriorGrants() {
        List<String> granted = List.of(
                "openid",
                "email",
                "https://www.googleapis.com/auth/gmail.metadata",
                "https://www.googleapis.com/auth/gmail.send",
                "https://www.googleapis.com/auth/drive.file");

        assertTrue(policy.containsRequiredScopes(ConnectionProvider.GMAIL, granted));
        assertFalse(policy.containsRequiredScopes(ConnectionProvider.GMAIL, List.of(
                "openid", "email", "https://www.googleapis.com/auth/Gmail.metadata")));
    }

    @Test
    void acceptsGoogleUserinfoEmailScopeAsTheOpenIdEmailAlias() {
        String userinfoEmail = "https://www.googleapis.com/auth/userinfo.email";

        assertTrue(policy.containsRequiredScopes(ConnectionProvider.GMAIL, List.of(
                "openid", userinfoEmail, "https://www.googleapis.com/auth/gmail.metadata",
                "https://www.googleapis.com/auth/gmail.send")));
        assertTrue(policy.containsRequiredScopes(ConnectionProvider.GOOGLE_SHEETS, List.of(
                "openid", userinfoEmail, "https://www.googleapis.com/auth/spreadsheets")));
    }

    @Test
    void missingRequiredScopeFailsWithSecretFreeError() {
        BadRequestException failure = assertThrows(BadRequestException.class, () ->
                policy.requireRequiredScopes(ConnectionProvider.GOOGLE_SHEETS, List.of("openid", "email")));

        assertEquals("Google did not grant the required access", failure.getMessage());
    }

    @Test
    void nonGoogleProviderHasNoGoogleScopePolicy() {
        assertThrows(BadRequestException.class, () -> policy.requiredScopes(ConnectionProvider.HTTP));
        assertFalse(policy.containsRequiredScopes(ConnectionProvider.HTTP, List.of("openid", "email")));
    }
}
