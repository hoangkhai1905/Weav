package com.weav.workspace.application.service;

import com.weav.workspace.application.dto.ResolvedConnectionCredential;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiCredentialTest {

    private static final String KEY = "sk-synthetic-key-123";

    private final CredentialPayloadCodec codec = new CredentialPayloadCodec(new ObjectMapper());

    @ParameterizedTest
    @EnumSource(value = ConnectionProvider.class, names = {"OPENAI", "ANTHROPIC", "GEMINI"})
    void tokenWithTokenFieldIsAccepted(ConnectionProvider provider) {
        new ConnectionProviderPolicy().validate(provider, ConnectionAuthType.TOKEN);
        assertThat(codec.encode(provider, ConnectionAuthType.TOKEN, Map.of("token", KEY))).isNotEmpty();
        assertThat(new ResolvedConnectionCredential(provider, ConnectionAuthType.TOKEN, Map.of("token", KEY)))
                .isNotNull();
    }

    @ParameterizedTest
    @EnumSource(value = ConnectionProvider.class, names = {"OPENAI", "ANTHROPIC", "GEMINI"})
    void otherAuthTypesAreRejected(ConnectionProvider provider) {
        ConnectionProviderPolicy policy = new ConnectionProviderPolicy();
        for (ConnectionAuthType other : ConnectionAuthType.values()) {
            if (other != ConnectionAuthType.TOKEN) {
                assertThatThrownBy(() -> policy.validate(provider, other)).isInstanceOf(BadRequestException.class);
            }
        }
        assertThatThrownBy(() -> new ResolvedConnectionCredential(
                provider, ConnectionAuthType.API_KEY, Map.of("apiKey", KEY)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @EnumSource(value = ConnectionProvider.class, names = {"OPENAI", "ANTHROPIC", "GEMINI"})
    void rejectsKeyWithControlCharacters(ConnectionProvider provider) {
        for (String bad : new String[] {"sk-abc\r\nX-Evil: 1", "sk-abc\n", "sk\u0000abc", "sk abc", "sk-é"}) {
            assertThatThrownBy(() -> codec.encode(provider, ConnectionAuthType.TOKEN, Map.of("token", bad)))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageNotContaining("Evil");
        }
    }

    @Test
    void rejectsOverlongKey() {
        assertThatThrownBy(() -> codec.encode(ConnectionProvider.OPENAI, ConnectionAuthType.TOKEN,
                Map.of("token", "k".repeat(4097)))).isInstanceOf(BadRequestException.class);
    }
}
