package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DiscordCredentialTest {

    private final CredentialPayloadCodec codec = new CredentialPayloadCodec(new ObjectMapper());

    @Test
    void discordAcceptsOnlyTokenAuthType() {
        ConnectionProviderPolicy policy = new ConnectionProviderPolicy();
        policy.validate(ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN);
        for (ConnectionAuthType other : ConnectionAuthType.values()) {
            if (other != ConnectionAuthType.TOKEN) {
                assertThatThrownBy(() -> policy.validate(ConnectionProvider.DISCORD, other))
                        .isInstanceOf(BadRequestException.class);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://discord.com/api/webhooks/123456789012345678/abc_DEF-123",
            "https://discordapp.com/api/webhooks/1/x"})
    void acceptsDiscordWebhookUrls(String url) {
        assertThat(codec.encode(ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN, Map.of("token", url)))
                .isNotEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://discord.com.evil.test/api/webhooks/1/x",
            "http://discord.com/api/webhooks/1/x",
            "https://evil.test/https://discord.com/api/webhooks/1/x",
            "https://discord.com@evil.test/api/webhooks/1/x",
            "https://discord.com/api/webhooks/abc/x",
            "https://discord.com/api/webhooks/1/x?wait=true",
            "https://discord.com/api/webhooks/1/x/extra",
            "https://discord.com/api/webhooks/1/x\n",
            "not-a-url"})
    void rejectsOtherUrlsWithoutEchoingThem(String url) {
        assertThatThrownBy(() -> codec.encode(
                ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN, Map.of("token", url)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageNotContaining("evil")
                .hasMessageNotContaining("webhooks");
    }

    @Test
    void decodeRejectsAStoredNonDiscordUrl() {
        com.weav.workspace.domain.model.Connection connection = com.weav.workspace.domain.model.Connection.createNew(
                java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), "Alerts",
                ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN, Map.of());
        byte[] bad = "{\"token\":\"https://discord.com.evil.test/api/webhooks/1/x\"}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertThatThrownBy(() -> codec.decode(connection, bad)).isInstanceOf(BadRequestException.class);
        byte[] good = "{\"token\":\"https://discord.com/api/webhooks/1/x\"}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(codec.decode(connection, good)).containsKey("token");
    }

    @Test
    void rejectsWrongPayloadShape() {
        assertThatThrownBy(() -> codec.encode(
                ConnectionProvider.DISCORD, ConnectionAuthType.TOKEN, Map.of("apiKey", "x")))
                .isInstanceOf(BadRequestException.class);
    }
}
