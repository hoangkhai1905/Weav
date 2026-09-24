package com.weav.workflow.infrastructure.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;

/** Enforces the documented byte limit before draft request JSON is parsed. */
public final class WorkflowRequestBodyLimitFilter extends OncePerRequestFilter {

    public static final int MAX_REQUEST_BYTES = 1_048_576;

    private final ObjectMapper objectMapper;

    public WorkflowRequestBodyLimitFilter(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        boolean create = "POST".equalsIgnoreCase(request.getMethod())
                && path.matches(".*/workspaces/[^/]+/workflows/?");
        boolean save = "PUT".equalsIgnoreCase(request.getMethod())
                && path.matches(".*/workspaces/[^/]+/workflows/[^/]+/draft/?");
        boolean execution = "POST".equalsIgnoreCase(request.getMethod())
                && path.matches(".*/workspaces/[^/]+/workflows/[^/]+/executions/?");
        boolean webhook = WebhookRequestPath.isWebhookIngress(request);
        return !create && !save && !execution && !webhook;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_REQUEST_BYTES) {
            writeTooLarge(request, response);
            return;
        }

        LimitedRequest wrappedRequest = new LimitedRequest(request, MAX_REQUEST_BYTES);
        ContentCachingResponseWrapper wrappedResponse = new ContentCachingResponseWrapper(response);
        try {
            filterChain.doFilter(wrappedRequest, wrappedResponse);
        } catch (IOException | ServletException | RuntimeException exception) {
            if (!wrappedRequest.exceeded()) {
                throw exception;
            }
        }
        if (wrappedRequest.exceeded()) {
            wrappedResponse.resetBuffer();
            writeTooLarge(request, wrappedResponse);
        }
        wrappedResponse.copyBodyToResponse();
    }

    private void writeTooLarge(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String correlationId = CorrelationIdFilter.requestId(request);
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader(CorrelationIdFilter.HEADER_NAME, correlationId);
        objectMapper.writeValue(response.getOutputStream(), ApiErrorResponse.of(
                "REQUEST_TOO_LARGE",
                "Request body exceeds the supported size",
                HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE,
                WebhookRequestPath.sanitizedPath(request),
                List.of()));
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {

        private final int maximumBytes;
        private LimitedServletInputStream inputStream;
        private BufferedReader reader;

        private LimitedRequest(HttpServletRequest request, int maximumBytes) {
            super(request);
            this.maximumBytes = maximumBytes;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (inputStream == null) {
                inputStream = new LimitedServletInputStream(super.getInputStream(), maximumBytes);
            }
            return inputStream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            if (reader == null) {
                String encoding = getCharacterEncoding();
                Charset charset = encoding == null ? StandardCharsets.ISO_8859_1 : Charset.forName(encoding);
                reader = new BufferedReader(new InputStreamReader(getInputStream(), charset));
            }
            return reader;
        }

        private boolean exceeded() {
            return inputStream != null && inputStream.exceeded;
        }
    }

    private static final class LimitedServletInputStream extends ServletInputStream {

        private final ServletInputStream delegate;
        private final int maximumBytes;
        private int bytesRead;
        private boolean exceeded;

        private LimitedServletInputStream(ServletInputStream delegate, int maximumBytes) {
            this.delegate = delegate;
            this.maximumBytes = maximumBytes;
        }

        @Override
        public int read() throws IOException {
            if (exceeded) {
                throw new RequestBodyTooLargeException();
            }
            int value = delegate.read();
            if (value >= 0 && ++bytesRead > maximumBytes) {
                exceeded = true;
                throw new RequestBodyTooLargeException();
            }
            return value;
        }

        @Override
        public int read(byte[] bytes, int offset, int length) throws IOException {
            if (exceeded) {
                throw new RequestBodyTooLargeException();
            }
            if (length == 0) {
                return 0;
            }
            int allowed = Math.min(length, maximumBytes - bytesRead + 1);
            int count = delegate.read(bytes, offset, allowed);
            if (count > 0 && (bytesRead += count) > maximumBytes) {
                exceeded = true;
                throw new RequestBodyTooLargeException();
            }
            return count;
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener readListener) {
            delegate.setReadListener(readListener);
        }
    }

    private static final class RequestBodyTooLargeException extends IOException {
    }
}
