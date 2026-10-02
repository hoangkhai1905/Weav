package com.weav.identity.application.port.out;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthMailSenderTest {

    @Test
    void messageToStringDoesNotExposeRecipientSubjectOrBody() {
        String rendered = new AuthMailSender.Message(
                "person@example.com", "Authentication code", "OTP 123456").toString();

        assertFalse(rendered.contains("person@example.com"));
        assertFalse(rendered.contains("Authentication code"));
        assertFalse(rendered.contains("123456"));
        assertTrue(rendered.contains("redacted"));
    }

    @Test
    void messageRejectsHeaderInjection() {
        assertThrows(IllegalArgumentException.class,
                () -> new AuthMailSender.Message("person@example.com\r\nBcc: attacker@example.com", "subject", "body"));
        assertThrows(IllegalArgumentException.class,
                () -> new AuthMailSender.Message("person@example.com", "subject\nInjected", "body"));
    }
}
