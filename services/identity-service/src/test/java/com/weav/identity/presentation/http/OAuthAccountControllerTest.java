package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.OAuthClientRegistration;
import com.weav.identity.application.dto.OAuthConfiguration;
import com.weav.identity.application.dto.OAuthSecret;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.usecase.ListOAuthAccountsUseCase;
import com.weav.identity.application.usecase.OAuthFlowCoordinator;
import com.weav.identity.application.usecase.UnlinkOAuthAccountUseCase;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.infrastructure.authstate.HmacKeyedFingerprint;
import com.weav.identity.infrastructure.security.AuthRateLimitExceededException;
import com.weav.identity.infrastructure.security.AuthRateLimiter;
import com.weav.identity.infrastructure.security.JwtProperties;
import com.weav.identity.presentation.http.oauth.OAuthCsrfTokenService;
import com.weav.identity.presentation.http.oauth.OAuthWebProtection;
import com.weav.identity.presentation.http.request.OAuthUnlinkRequest;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.jwt.Jwt;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OAuthAccountControllerTest {

    private static final Instant NOW = Instant.parse("2026-09-10T10:00:00Z");
    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ACCOUNT_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String PASSWORD_HASH = "bcrypt-hash";

    @Test
    void sessionRateLimitRunsBeforeUnlinkPasswordWork() {
        Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
        UserRepository userRepository = mock(UserRepository.class);
        UserSessionRepository sessionRepository = mock(UserSessionRepository.class);
        OAuthAccountRepository accountRepository = mock(OAuthAccountRepository.class);
        PasswordHasher passwordHasher = mock(PasswordHasher.class);
        User user = new User(
                USER_ID,
                "unlink-controller@example.com",
                PASSWORD_HASH,
                "Unlink Controller",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                NOW,
                NOW);
        UserSession session = new UserSession(
                SESSION_ID,
                USER_ID,
                "refresh-hash",
                null,
                null,
                NOW.plus(Duration.ofHours(1)),
                NOW);
        OAuthAccount account = new OAuthAccount(
                ACCOUNT_ID,
                USER_ID,
                OAuthProvider.GOOGLE,
                "subject",
                "unlink-controller@example.net",
                NOW,
                NOW);
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(userRepository.findByIdForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(accountRepository.findByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(Optional.of(account));
        when(accountRepository.findAllByUserId(USER_ID)).thenReturn(List.of(account));
        when(passwordHasher.matches(PASSWORD, PASSWORD_HASH)).thenReturn(true);
        when(accountRepository.deleteByIdAndUserId(ACCOUNT_ID, USER_ID)).thenReturn(true);

        CurrentIdentityGuard identityGuard = new CurrentIdentityGuard(userRepository, sessionRepository, clock);
        UnlinkOAuthAccountUseCase unlinkUseCase = new UnlinkOAuthAccountUseCase(
                identityGuard,
                userRepository,
                accountRepository,
                passwordHasher,
                new TransactionRunner() {
                    @Override
                    public <T> T required(java.util.function.Supplier<T> work) {
                        return work.get();
                    }
                },
                new AuthInputPolicy());
        AuthRateLimiter rateLimiter = new AuthRateLimiter(clock);
        OAuthCsrfTokenService csrfTokenService = new OAuthCsrfTokenService(
                enabledConfiguration(),
                new HmacKeyedFingerprint("controller-csrf-hmac-secret-012345678901234567"),
                new java.security.SecureRandom(),
                clock);
        String csrfToken = csrfTokenService.issue();
        OAuthWebProtection webProtection = new OAuthWebProtection(
                enabledConfiguration(),
                jwtProperties(),
                csrfTokenService);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Origin", "https://web.test");
        request.addHeader(OAuthWebProtection.CSRF_HEADER, csrfToken);
        request.setCookies(new Cookie(OAuthWebProtection.CSRF_COOKIE, csrfToken));

        OAuthAccountController controller = new OAuthAccountController(
                (OAuthFlowCoordinator) null,
                (ListOAuthAccountsUseCase) null,
                unlinkUseCase,
                webProtection,
                rateLimiter);
        Jwt jwt = Jwt.withTokenValue("access-token")
                .subject(USER_ID.toString())
                .claim("sid", SESSION_ID.toString())
                .header("alg", "none")
                .build();

        for (int attempt = 0; attempt < 5; attempt++) {
            controller.unlink(jwt, ACCOUNT_ID, new OAuthUnlinkRequest(PASSWORD), request);
        }

        assertThrows(AuthRateLimitExceededException.class,
                () -> controller.unlink(jwt, ACCOUNT_ID, new OAuthUnlinkRequest(PASSWORD), request));
        verify(passwordHasher, times(5)).matches(eq(PASSWORD), eq(PASSWORD_HASH));
    }

    private static OAuthConfiguration enabledConfiguration() {
        return OAuthConfiguration.enabled(
                new OAuthClientRegistration(
                        "web",
                        "web",
                        OAuthProvider.GOOGLE,
                        "google-client",
                        URI.create("http://127.0.0.1/auth/oauth/google/callback"),
                        URI.create("https://web.test/auth/callback"),
                        Set.of("https://web.test")),
                OAuthConfiguration.GOOGLE_ISSUER_URI,
                new OAuthSecret("provider-secret"),
                Duration.ofMinutes(10),
                Duration.ofSeconds(60),
                Duration.ofMinutes(10),
                Duration.ofSeconds(5),
                5,
                OAuthConfiguration.CookiePolicy.defaults(),
                Set.of());
    }

    private static JwtProperties jwtProperties() {
        return new JwtProperties(
                "access-secret-012345678901234567890123456789",
                "refresh-secret-012345678901234567890123456789",
                "weav",
                "weav-api",
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ofSeconds(30));
    }
}
