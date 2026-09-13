package com.weav.workspace.infrastructure.web;

import com.weav.workspace.domain.exception.DependencyUnavailableException;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DependencyUnavailableExceptionHandlerTest {

    @Test
    void mapsDownstreamFailureToSanitized503Response() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/internal/directory/users/search");

        var response = new GlobalExceptionHandler().handleDomainException(
                new DependencyUnavailableException(), request);

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE.value(), response.getStatusCode().value());
        assertEquals("DEPENDENCY_UNAVAILABLE", response.getBody().error().code());
        assertEquals("A required dependency is temporarily unavailable", response.getBody().error().message());
    }
}
