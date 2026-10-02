package com.weav.workspace.infrastructure.security;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.AuthenticationEntryPoint;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InternalServiceKeyFilterTest {

    @Test
    void rejectsMissingOrWrongKeyAndAllowsCorrectKeyAtNonRootContext() throws Exception {
        AtomicBoolean entryPointCalled = new AtomicBoolean();
        AuthenticationEntryPoint entryPoint = (request, response, exception) -> {
            entryPointCalled.set(true);
            response.setStatus(401);
        };
        InternalServiceKeyFilter filter = new InternalServiceKeyFilter(
                props(false), entryPoint, null);
        FilterChain chain = (request, response) -> ((MockHttpServletResponse) response).setStatus(200);

        MockHttpServletRequest missing = internalRequest(null);
        MockHttpServletResponse missingResponse = new MockHttpServletResponse();
        filter.doFilter(missing, missingResponse, chain);
        assertEquals(401, missingResponse.getStatus());
        assertTrue(entryPointCalled.get());

        MockHttpServletRequest wrong = internalRequest("wrong-key");
        MockHttpServletResponse wrongResponse = new MockHttpServletResponse();
        filter.doFilter(wrong, wrongResponse, chain);
        assertEquals(401, wrongResponse.getStatus());

        MockHttpServletRequest valid = internalRequest("workspace-key-0123456789-abcdefghijklmnop");
        MockHttpServletResponse validResponse = new MockHttpServletResponse();
        filter.doFilter(valid, validResponse, chain);
        assertEquals(200, validResponse.getStatus());
    }

    @Test
    void nonInternalRequestPassesThroughWithoutAKey() throws Exception {
        InternalServiceKeyFilter filter = new InternalServiceKeyFilter(
                props(false),
                (request, response, exception) -> response.setStatus(401), null);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/workspace/workspaces");
        request.setContextPath("/workspace");
        request.setServletPath("/workspaces");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (request1, response1) ->
                ((MockHttpServletResponse) response1).setStatus(204));

        assertEquals(204, response.getStatus());
    }

    @Test
    void missingConfigurationFailsClosedForInternalRequest() throws Exception {
        InternalServiceKeyFilter filter = new InternalServiceKeyFilter(
                new InternalServiceKeyProperties("", null, false),
                (request, response, exception) -> response.setStatus(401), null);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(internalRequest("workspace-key-0123456789-abcdefghijklmnop"), response, (request, response1) ->
                ((MockHttpServletResponse) response1).setStatus(200));

        assertEquals(401, response.getStatus());
    }

    private MockHttpServletRequest internalRequest(String key) {
        MockHttpServletRequest request = new MockHttpServletRequest(
                "GET", "/workspace/internal/workspaces/id/users/id/access");
        request.setContextPath("/workspace");
        request.setServletPath("/internal/workspaces/id/users/id/access");
        if (key != null) {
            request.addHeader(InternalServiceKeyFilter.HEADER_NAME, key);
        }
        return request;
    }

    static InternalServiceKeyProperties props(boolean requireJwt) {
        return new InternalServiceKeyProperties("workspace-key-0123456789-abcdefghijklmnop", null, requireJwt);
    }

    @Test
    void staticKeyIsRejectedWhenServiceJwtIsRequired() throws Exception {
        InternalServiceKeyFilter filter = new InternalServiceKeyFilter(
                props(true), (request, response, exception) -> response.setStatus(401), null);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(internalRequest("workspace-key-0123456789-abcdefghijklmnop"), response, (request, response1) ->
                ((MockHttpServletResponse) response1).setStatus(200));

        assertEquals(401, response.getStatus());
    }

    @Test
    void shortStaticKeyFailsStartupValidation() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                () -> new InternalServiceKeyProperties("too-short", null, false));
        // unset stays valid: the endpoints then simply fail closed
        new InternalServiceKeyProperties("", null, false);
    }
}
