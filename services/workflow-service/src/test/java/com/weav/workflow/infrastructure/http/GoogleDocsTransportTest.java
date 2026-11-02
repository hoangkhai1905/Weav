package com.weav.workflow.infrastructure.http;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.weav.workflow.application.node.NodeExecutor;
import java.net.URI;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class GoogleDocsTransportTest {

    private static final String TOKEN = "synthetic-docs-token";

    @ParameterizedTest
    @ValueSource(strings = {
            "http://docs.googleapis.com/v1/documents/abcdefghij:batchUpdate",
            "https://evil.example/v1/documents/abcdefghij:batchUpdate",
            "https://docs.googleapis.com:8443/v1/documents/abcdefghij:batchUpdate",
            "https://docs.googleapis.com/v1/documents/abc:batchUpdate",
            "https://docs.googleapis.com/v1/documents/abcdefghij",
            "https://docs.googleapis.com/v1/documents/abcdefghij:batchUpdate?x=1",
            "https://docs.googleapis.com/v1/documents/..%2Fabcdefghij:batchUpdate",
            "https://u@docs.googleapis.com/v1/documents/abcdefghij:batchUpdate"})
    void rejectsEveryDocsUriExceptTheBatchUpdateEndpoint(String uri) {
        assertThatThrownBy(() -> new PinnedHttpTransport()
                .executeGoogleDocsWithBearerToken(URI.create(uri), Map.of(), TOKEN))
                .isInstanceOfSatisfying(NodeExecutor.Failure.class, failure -> {
                    assertThat(failure.code()).isEqualTo("HTTP_REQUEST_INVALID");
                    assertThat(failure.getMessage()).doesNotContain(TOKEN);
                });
    }

    @Test
    void rejectsABlankToken() {
        URI uri = URI.create("https://docs.googleapis.com/v1/documents/abcdefghij:batchUpdate");
        assertThatThrownBy(() -> new PinnedHttpTransport().executeGoogleDocsWithBearerToken(uri, Map.of(), " "))
                .isInstanceOfSatisfying(NodeExecutor.Failure.class,
                        failure -> assertThat(failure.code()).isEqualTo("HTTP_REQUEST_INVALID"));
    }
}
