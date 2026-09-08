package com.weav.identity.infrastructure.mail;

import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.infrastructure.config.MailProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class SmtpAuthMailSenderTest {

    @Test
    void sendsOnlyValidatedMessageFields() {
        JavaMailSender sender = mock(JavaMailSender.class);
        MailProperties properties = configuredProperties();
        SmtpAuthMailSender mailSender = new SmtpAuthMailSender(sender, properties);

        mailSender.send(new AuthMailSender.Message("person@example.com", "Authentication code", "code"));

        var captured = org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(sender).send(captured.capture());
        assertEquals("no-reply@example.com", captured.getValue().getFrom());
        assertEquals("person@example.com", captured.getValue().getTo()[0]);
        assertEquals("Authentication code", captured.getValue().getSubject());
        assertEquals("code", captured.getValue().getText());
    }

    @Test
    void providerFailureIsSanitized() {
        JavaMailSender sender = mock(JavaMailSender.class);
        doThrow(new IllegalStateException("secret provider diagnostics"))
                .when(sender).send(any(SimpleMailMessage.class));
        SmtpAuthMailSender mailSender = new SmtpAuthMailSender(sender, configuredProperties());

        DependencyUnavailableException failure = assertThrows(
                DependencyUnavailableException.class,
                () -> mailSender.send(new AuthMailSender.Message("person@example.com", "Subject", "body"))
        );

        assertFalse(failure.toString().contains("secret provider diagnostics"));
        assertTrue(failure.getMessage().contains("temporarily unavailable"));
    }

    @Test
    void authenticatedSmtpRequiresTlsAndCredentials() {
        MailProperties properties = configuredProperties();
        properties.setAuth(true);
        properties.setStartTls(false);
        properties.setSsl(false);
        properties.setUsername("");
        properties.setPassword("");

        assertThrows(IllegalArgumentException.class, properties::validate);
    }

    private static MailProperties configuredProperties() {
        MailProperties properties = new MailProperties();
        properties.setHost("smtp.example.com");
        properties.setFrom("no-reply@example.com");
        return properties;
    }
}
