package com.weav.identity.application.port.out;

import java.util.Objects;

/** Framework-free boundary for transactional authentication mail. */
public interface AuthMailSender {

    void send(Message message);

    record Message(String recipient, String subject, String body) {
        public Message {
            requireText(recipient, "recipient");
            requireText(subject, "subject");
            rejectHeaderInjection(recipient, "recipient");
            rejectHeaderInjection(subject, "subject");
            Objects.requireNonNull(body, "body must not be null");
        }

        private static void requireText(String value, String name) {
            if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        }

        private static void rejectHeaderInjection(String value, String name) {
            if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
                throw new IllegalArgumentException(name + " must not contain line breaks");
            }
        }

        @Override
        public String toString() {
            return "Message[recipient=<redacted>, subject=<redacted>, body=<redacted>]";
        }
    }
}
