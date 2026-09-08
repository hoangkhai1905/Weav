package com.weav.identity.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "weav.mail")
public class MailProperties {

    private String host;
    private int port = 25;
    private String username;
    private String password;
    private String from;
    private boolean auth;
    private boolean startTls;
    private boolean startTlsRequired;
    private boolean ssl;
    private Duration connectionTimeout = Duration.ofSeconds(3);
    private Duration readTimeout = Duration.ofSeconds(5);
    private Duration writeTimeout = Duration.ofSeconds(5);
    private int queueCapacity = 100;
    private int corePoolSize = 1;
    private int maxPoolSize = 2;

    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }
    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }
    public String getFrom() { return from; }
    public void setFrom(String from) { this.from = from; }
    public boolean isAuth() { return auth; }
    public void setAuth(boolean auth) { this.auth = auth; }
    public boolean isStartTls() { return startTls; }
    public void setStartTls(boolean startTls) { this.startTls = startTls; }
    public boolean isStartTlsRequired() { return startTlsRequired; }
    public void setStartTlsRequired(boolean startTlsRequired) { this.startTlsRequired = startTlsRequired; }
    public boolean isSsl() { return ssl; }
    public void setSsl(boolean ssl) { this.ssl = ssl; }
    public Duration getConnectionTimeout() { return connectionTimeout; }
    public void setConnectionTimeout(Duration connectionTimeout) { this.connectionTimeout = connectionTimeout; }
    public Duration getReadTimeout() { return readTimeout; }
    public void setReadTimeout(Duration readTimeout) { this.readTimeout = readTimeout; }
    public Duration getWriteTimeout() { return writeTimeout; }
    public void setWriteTimeout(Duration writeTimeout) { this.writeTimeout = writeTimeout; }
    public int getQueueCapacity() { return queueCapacity; }
    public void setQueueCapacity(int queueCapacity) { this.queueCapacity = queueCapacity; }
    public int getCorePoolSize() { return corePoolSize; }
    public void setCorePoolSize(int corePoolSize) { this.corePoolSize = corePoolSize; }
    public int getMaxPoolSize() { return maxPoolSize; }
    public void setMaxPoolSize(int maxPoolSize) { this.maxPoolSize = maxPoolSize; }

    public boolean isConfigured() {
        return host != null && !host.isBlank() && from != null && !from.isBlank();
    }

    public void validate() {
        if (port < 1 || port > 65535) throw new IllegalArgumentException("port must be 1..65535");
        rejectLineBreaks(host, "host");
        rejectLineBreaks(from, "from");
        requirePositive(connectionTimeout, "connectionTimeout");
        requirePositive(readTimeout, "readTimeout");
        requirePositive(writeTimeout, "writeTimeout");
        if (queueCapacity < 1) throw new IllegalArgumentException("queueCapacity must be positive");
        if (corePoolSize < 1 || maxPoolSize < corePoolSize) {
            throw new IllegalArgumentException("mail executor pool sizes are invalid");
        }
        if (startTlsRequired && !startTls) {
            throw new IllegalArgumentException("startTlsRequired requires startTls");
        }
        if (auth && (username == null || username.isBlank() || password == null || password.isBlank())) {
            throw new IllegalArgumentException("authenticated SMTP requires username and password");
        }
        if (auth && !startTls && !ssl) {
            throw new IllegalArgumentException("authenticated SMTP requires TLS");
        }
    }

    private static void requirePositive(Duration value, String name) {
        if (value == null || value.isNegative() || value.toMillis() < 1) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }

    private static void rejectLineBreaks(String value, String name) {
        if (value != null && (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0)) {
            throw new IllegalArgumentException(name + " must not contain line breaks");
        }
    }
}
