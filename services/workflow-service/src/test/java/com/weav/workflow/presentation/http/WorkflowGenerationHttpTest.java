package com.weav.workflow.presentation.http;

import com.weav.workflow.WorkflowDraftTestConfiguration;
import com.weav.workflow.application.port.out.AiGenerationPort;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.weav.workflow.infrastructure.web.WorkflowRequestBodyLimitFilter;

@SpringBootTest(properties = "weav.workflow.ai.generation-enabled=true")
@Import({WorkflowDraftTestConfiguration.class, WorkflowGenerationHttpTest.FakeAiConfiguration.class})
class WorkflowGenerationHttpTest {
    private static final String SECRET = "workflow-test-access-secret-with-at-least-32-utf8-bytes";
    private static final UUID USER = UUID.fromString("20000000-0000-0000-0000-000000000051");
    @Autowired WebApplicationContext context;
    @Autowired WorkflowDraftTestConfiguration.DraftWorkspaceBoundary boundary;
    @Autowired FakeAi ai;
    @Autowired WorkflowRequestBodyLimitFilter requestBodyLimitFilter;
    private MockMvc mvc;
    private UUID workspace;

    @BeforeEach
    void setUp() {
        boundary.reset();
        workspace = UUID.randomUUID();
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(requestBodyLimitFilter)
                .apply(SecurityMockMvcConfigurers.springSecurity()).build();
        ai.reset();
    }

    @Test void unauthenticatedIs401() throws Exception {
        mvc.perform(post("/workspaces/{id}/workflows/generate", workspace).contentType(MediaType.APPLICATION_JSON)
                .content("{\"prompt\":\"ping\"}")).andExpect(status().isUnauthorized());
    }

    @Test void malformedJsonDuplicateKeysAndUnknownFieldsAre400() throws Exception {
        String auth = "Bearer " + token(USER);
        mvc.perform(post("/workspaces/{id}/workflows/generate", workspace).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\"a\",\"prompt\":\"b\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/workspaces/{id}/workflows/generate", workspace).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\"a\",\"x\":1}"))
                .andExpect(status().isBadRequest());
    }

    @Test void blankPromptOrOver4000CodePointsIs400() throws Exception {
        String auth = "Bearer " + token(USER);
        mvc.perform(post("/workspaces/{id}/workflows/generate", workspace).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\" \"}")).andExpect(status().isBadRequest());
        String longPrompt = "x".repeat(4001);
        mvc.perform(post("/workspaces/{id}/workflows/generate", workspace).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"prompt\":\"" + longPrompt + "\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test void invalidTimezoneIs400() throws Exception {
        mvc.perform(request("{\"prompt\":\"ping\",\"timezone\":\"Mars/Olympus\"}")).andExpect(status().isBadRequest());
    }

    @Test void connectionForANodeTypeWithoutConnectionIdIs400() throws Exception {
        UUID connection = UUID.randomUUID();
        mvc.perform(request("{\"prompt\":\"ping\",\"connections\":{\"http.request\":\"" + connection + "\"}}"))
                .andExpect(status().isOk());
        mvc.perform(request("{\"prompt\":\"ping\",\"connections\":{\"ai.summarize\":\"" + connection + "\"}}"))
                .andExpect(status().isBadRequest());
    }

    @Test void exhaustedAiQuotaIs429() throws Exception {
        ai.failure = new com.weav.workflow.application.node.NodeExecutor.Failure("AI_QUOTA_EXCEEDED", "quota", false);
        mvc.perform(request("{\"prompt\":\"ping\"}")).andExpect(status().isTooManyRequests())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content()
                        .string(org.hamcrest.Matchers.containsString("AI_QUOTA_EXCEEDED")));
    }

    @Test void bodyOver32KiBIs413() throws Exception {
        mvc.perform(request("{\"prompt\":\"" + "x".repeat(33 * 1024) + "\"}")).andExpect(status().isPayloadTooLarge());
    }

    @Test void readyResponseShape() throws Exception {
        mvc.perform(request("{\"prompt\":\"ping\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ready"))
                .andExpect(jsonPath("$.definition.nodes[0].id").value("start"))
                .andExpect(jsonPath("$.layout.start.x").value(100));
        assertTrue(ai.calls > 0);
    }

    @Test void existingDraftRoutesStillWork() throws Exception {
        mvc.perform(get("/workspaces/{workspaceId}/workflows/{workflowId}", workspace, UUID.randomUUID())
                .header("Authorization", "Bearer " + token(USER)))
                .andExpect(status().isNotFound());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request(String body) throws Exception {
        return post("/workspaces/{id}/workflows/generate", workspace).header("Authorization", "Bearer " + token(USER))
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }
    private String token(UUID subject) throws Exception {
        long now = Instant.now().getEpochSecond();
        String h = enc(Map.of("alg", "HS256", "typ", "JWT"));
        Map<String,Object> claims = new LinkedHashMap<>();
        claims.put("iss","weav-identity"); claims.put("sub",subject.toString()); claims.put("aud",List.of("weav-api"));
        claims.put("iat",now); claims.put("nbf",now); claims.put("exp",now+300);
        claims.put("jti",UUID.randomUUID().toString()); claims.put("sid",UUID.randomUUID().toString());
        claims.put("system_role","USER"); claims.put("user_status","ACTIVE"); claims.put("token_use","access");
        String p = enc(claims);
        String input = h + "." + p;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return input + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
    }
    private String enc(Object value) throws Exception {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                new tools.jackson.databind.ObjectMapper().writeValueAsBytes(value));
    }

    @TestConfiguration
    static class FakeAiConfiguration {
        @Bean @Primary FakeAi fakeAi() { return new FakeAi(); }
    }
    static class FakeAi implements AiGenerationPort {
        int calls;
        com.weav.workflow.application.node.NodeExecutor.Failure failure;
        void reset() { calls = 0; failure = null; }
        public Map<String,Object> generate(UUID workspaceId, Map<String,Object> payload) {
            calls++;
            if (failure != null) throw failure;
            Map<String,Object> n1 = Map.of("id","start","type","trigger.manual","config",Map.of());
            Map<String,Object> n2 = Map.of("id","ping","type","http.request","config",
                    Map.of("method","GET","url","https://example.com"));
            Map<String,Object> n3 = Map.of("id","sum","type","ai.summarize","config",
                    Map.of("inputText","{{nodes.ping.output.body}}","maxLength",100));
            return Map.of("status","ready","intent",Map.of("name","Generated",
                    "nodes",List.of(n1,n2,n3),"edges",List.of(
                            Map.of("from","start","to","ping"),Map.of("from","ping","to","sum"))));
        }
    }
}
