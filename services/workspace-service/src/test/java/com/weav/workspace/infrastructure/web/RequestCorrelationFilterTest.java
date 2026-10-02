package com.weav.workspace.infrastructure.web;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RequestCorrelationFilterTest {

    private final RequestCorrelationFilter filter = new RequestCorrelationFilter();

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void preservesSafeIncomingIdAndClearsMdcAfterRequest() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestCorrelationFilter.HEADER_NAME, "request-42");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MDC.put(RequestCorrelationFilter.MDC_KEY, "stale-request-id");

        filter.doFilter(request, response, (servletRequest, servletResponse) -> {
            assertEquals("request-42", MDC.get(RequestCorrelationFilter.MDC_KEY));
            assertEquals("request-42", servletRequest.getAttribute(RequestCorrelationFilter.REQUEST_ID_ATTRIBUTE));
        });

        assertEquals("request-42", response.getHeader(RequestCorrelationFilter.HEADER_NAME));
        assertNull(MDC.get(RequestCorrelationFilter.MDC_KEY));
    }

    @Test
    void replacesUnsafeIdAndCleansMdcWhenChainFails() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestCorrelationFilter.HEADER_NAME, "unsafe request id");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThrows(IllegalStateException.class, () -> filter.doFilter(
                request,
                response,
                (FilterChain) (servletRequest, servletResponse) -> {
                    assertTrue(MDC.get(RequestCorrelationFilter.MDC_KEY).matches(
                            "[A-Za-z0-9._:-]{1,128}"));
                    throw new IllegalStateException("test failure");
                }));

        String generated = response.getHeader(RequestCorrelationFilter.HEADER_NAME);
        assertNotEquals("unsafe request id", generated);
        assertTrue(generated != null && !generated.isBlank());
        assertTrue(UUID.fromString(generated) != null);
        assertNull(MDC.get(RequestCorrelationFilter.MDC_KEY));
    }
}
