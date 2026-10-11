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

class SlackTeamsCredentialTest {

    private static final String TEAMS_OK = "https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sig=SECRET";

    private final CredentialPayloadCodec codec = new CredentialPayloadCodec(new ObjectMapper());

    @Test
    void slackAndTeamsAcceptOnlyTokenAuthType() {
        ConnectionProviderPolicy policy = new ConnectionProviderPolicy();
        for (ConnectionProvider provider : new ConnectionProvider[] {ConnectionProvider.SLACK, ConnectionProvider.TEAMS}) {
            policy.validate(provider, ConnectionAuthType.TOKEN);
            for (ConnectionAuthType other : ConnectionAuthType.values()) {
                if (other != ConnectionAuthType.TOKEN) {
                    assertThatThrownBy(() -> policy.validate(provider, other)).isInstanceOf(BadRequestException.class);
                }
            }
        }
    }

    @Test
    void acceptsSlackWebhookUrl() {
        assertThat(codec.encode(ConnectionProvider.SLACK, ConnectionAuthType.TOKEN,
                Map.of("token", "https://hooks.slack.com/services/T0123ABC/B0456DEF/abcDEF123456"))).isNotEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://hooks.slack.com.evil.test/services/T01/B01/x",
            "http://hooks.slack.com/services/T01/B01/x",
            "https://hooks.slack.com@evil.test/services/T01/B01/x",
            "https://hooks.slack.com:8443/services/T01/B01/x",
            "https://hooks.slack.com/services/T01/B01/x?x=1",
            "https://hooks.slack.com/services/t01/B01/x",
            "https://hooks.slack.com/services/T01/B01/x/extra",
            "https://hooks.slack.com/services/T01/B01/x\n",
            "not-a-url"})
    void rejectsOtherSlackUrlsWithoutEchoingThem(String url) {
        assertThatThrownBy(() -> codec.encode(ConnectionProvider.SLACK, ConnectionAuthType.TOKEN, Map.of("token", url)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageNotContaining("evil")
                .hasMessageNotContaining("services");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            TEAMS_OK,
            "https://PROD-12.westus.LOGIC.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://x.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=x"})
    void acceptsTeamsWorkflowUrls(String url) {
        assertThat(codec.encode(ConnectionProvider.TEAMS, ConnectionAuthType.TOKEN, Map.of("token", url)))
                .isNotEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "http://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://evil-logic.azure.com.evil.test/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://evillogic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://x.logic.azure.com@evil.test/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://x.logic.azure.com:8443/workflows/abc/triggers/manual/paths/invoke?sig=x",
            "https://x.logic.azure.com/other/abc/triggers/manual/paths/invoke?sig=x",
            "https://x.logic.azure.com/workflows/abc/triggers/manual/paths/other?sig=x",
            "https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke",
            "https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?xsig=1",
            "https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=",
            "https://x.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x#frag",
            "https://x.logic.azure.com/workflows/../triggers/manual/paths/invoke?sig=x",
            "https://outlook.office.com/webhook/abc/IncomingWebhook/def/ghi",
            "not-a-url"})
    void rejectsOtherTeamsUrlsWithoutEchoingThem(String url) {
        assertThatThrownBy(() -> codec.encode(ConnectionProvider.TEAMS, ConnectionAuthType.TOKEN, Map.of("token", url)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageNotContaining("evil")
                .hasMessageNotContaining("workflows");
    }
}
