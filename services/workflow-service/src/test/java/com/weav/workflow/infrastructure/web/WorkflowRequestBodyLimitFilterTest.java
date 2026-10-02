package com.weav.workflow.infrastructure.web;

import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.ServletInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;

import java.io.OutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowRequestBodyLimitFilterTest {

    private final WorkflowRequestBodyLimitFilter filter = new WorkflowRequestBodyLimitFilter(new ObjectMapper());

    @Test
    void boundsChunkedDraftBodyAndReturnsSafePayloadTooLargeResponse() throws Exception {
        byte[] body = new byte[WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES + 1];
        byte[] marker = "padding-secret-marker".getBytes(StandardCharsets.UTF_8);
        System.arraycopy(marker, 0, body, body.length - marker.length, marker.length);
        HttpServletRequest request = chunkedDraftRequest(body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainReached = new AtomicBoolean();

        filter.doFilter(request, response, (wrappedRequest, wrappedResponse) -> {
            chainReached.set(true);
            ServletInputStream input = wrappedRequest.getInputStream();
            assertThrows(IOException.class, () -> input.transferTo(OutputStream.nullOutputStream()));
            assertThrows(IOException.class, input::read);
        });

        assertTrue(chainReached.get());
        assertEquals(413, response.getStatus());
        assertEquals("REQUEST_TOO_LARGE", new ObjectMapper().readTree(response.getContentAsByteArray())
                .path("error").path("code").stringValue());
        assertFalse(new String(response.getContentAsByteArray(), StandardCharsets.UTF_8)
                .contains("padding-secret-marker"));
    }

    @Test
    void permitsChunkedDraftAtExactLimit() throws Exception {
        byte[] body = new byte[WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES];
        HttpServletRequest request = chunkedDraftRequest(body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainReached = new AtomicBoolean();

        filter.doFilter(request, response, (wrappedRequest, wrappedResponse) -> {
            chainReached.set(true);
            wrappedRequest.getInputStream().transferTo(OutputStream.nullOutputStream());
        });

        assertTrue(chainReached.get());
        assertEquals(200, response.getStatus());
    }

    @Test
    void boundsChunkedManualExecutionBodyBeforeJsonBinding() throws Exception {
        byte[] body = new byte[WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES + 1];
        byte[] marker = "execution-padding-secret-marker".getBytes(StandardCharsets.UTF_8);
        System.arraycopy(marker, 0, body, body.length - marker.length, marker.length);
        HttpServletRequest request = chunkedExecutionRequest(body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainReached = new AtomicBoolean();

        filter.doFilter(request, response, (wrappedRequest, wrappedResponse) -> {
            chainReached.set(true);
            assertThrows(IOException.class, () -> wrappedRequest.getInputStream()
                    .transferTo(OutputStream.nullOutputStream()));
        });

        assertTrue(chainReached.get());
        assertEquals(413, response.getStatus());
        assertEquals("REQUEST_TOO_LARGE", new ObjectMapper().readTree(response.getContentAsByteArray())
                .path("error").path("code").stringValue());
        assertFalse(new String(response.getContentAsByteArray(), StandardCharsets.UTF_8)
                .contains("execution-padding-secret-marker"));
    }

    @Test
    void doesNotFilterOtherWorkflowRequests() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/workspaces/1/workflows");
        request.setContent(new byte[WorkflowRequestBodyLimitFilter.MAX_REQUEST_BYTES + 1]);
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainReached = new AtomicBoolean();

        filter.doFilter(request, response, (wrappedRequest, wrappedResponse) -> chainReached.set(true));

        assertTrue(chainReached.get());
        assertEquals(200, response.getStatus());
    }

    private static HttpServletRequest chunkedDraftRequest(byte[] body) {
        MockHttpServletRequest request = new MockHttpServletRequest("PUT",
                "/workspaces/10000000-0000-0000-0000-000000000001"
                        + "/workflows/40000000-0000-0000-0000-000000000001/draft");
        request.setContent(body);
        request.setContentType("application/json");
        return new HttpServletRequestWrapper(request) {
            @Override
            public int getContentLength() {
                return -1;
            }

            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
    }

    private static HttpServletRequest chunkedExecutionRequest(byte[] body) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
                "/workspaces/10000000-0000-0000-0000-000000000001"
                        + "/workflows/40000000-0000-0000-0000-000000000001/executions");
        request.setContent(body);
        request.setContentType("application/json");
        return new HttpServletRequestWrapper(request) {
            @Override
            public int getContentLength() {
                return -1;
            }

            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
    }
}
