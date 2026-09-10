package com.weav.identity.infrastructure.mail;

import com.weav.identity.application.port.out.AuthMailSender;
import com.weav.identity.domain.exception.DependencyUnavailableException;
import com.weav.identity.infrastructure.config.MailProperties;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.util.Objects;
import java.util.Properties;

/** SMTP adapter; provider failures are deliberately reduced to a fixed error. */
public final class SmtpAuthMailSender implements AuthMailSender {

    private final JavaMailSender sender;
    private final MailProperties properties;

    public SmtpAuthMailSender(MailProperties properties) {
        this(createSender(Objects.requireNonNull(properties, "properties must not be null")), properties);
    }

    public SmtpAuthMailSender(JavaMailSender sender, MailProperties properties) {
        this.sender = Objects.requireNonNull(sender, "sender must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    @Override
    public void send(Message message) {
        Objects.requireNonNull(message, "message must not be null");
        properties.validate();
        if (!properties.isConfigured()) throw new DependencyUnavailableException();
        try {
            SimpleMailMessage mail = new SimpleMailMessage();
            mail.setFrom(properties.getFrom());
            mail.setTo(message.recipient());
            mail.setSubject(message.subject());
            mail.setText(message.body());
            sender.send(mail);
        } catch (DependencyUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            // Never attach or expose provider diagnostics: SMTP messages may contain credentials or recipients.
            throw new DependencyUnavailableException();
        }
    }

    private static JavaMailSender createSender(MailProperties properties) {
        properties.validate();
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        if (properties.getHost() != null && !properties.getHost().isBlank()) {
            sender.setHost(properties.getHost());
        }
        sender.setPort(properties.getPort());
        if (properties.getUsername() != null) sender.setUsername(properties.getUsername());
        if (properties.getPassword() != null) sender.setPassword(properties.getPassword());

        Properties mail = sender.getJavaMailProperties();
        mail.put("mail.debug", "false");
        mail.put("mail.smtp.auth", Boolean.toString(properties.isAuth()));
        mail.put("mail.smtp.starttls.enable", Boolean.toString(properties.isStartTls()));
        mail.put("mail.smtp.starttls.required", Boolean.toString(properties.isStartTlsRequired()));
        mail.put("mail.smtp.ssl.enable", Boolean.toString(properties.isSsl()));
        mail.put("mail.smtp.ssl.checkserveridentity", "true");
        mail.put("mail.smtp.connectiontimeout", Long.toString(properties.getConnectionTimeout().toMillis()));
        mail.put("mail.smtp.timeout", Long.toString(properties.getReadTimeout().toMillis()));
        mail.put("mail.smtp.writetimeout", Long.toString(properties.getWriteTimeout().toMillis()));
        return sender;
    }
}
