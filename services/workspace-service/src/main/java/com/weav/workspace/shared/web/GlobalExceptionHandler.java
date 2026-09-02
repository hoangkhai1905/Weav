package com.weav.workspace.shared.web;

import com.weav.workspace.shared.exception.ConflictException;
import com.weav.workspace.shared.exception.DomainException;
import com.weav.workspace.shared.exception.ForbiddenException;
import com.weav.workspace.shared.exception.InvalidStateException;
import com.weav.workspace.shared.exception.ResourceNotFoundException;
import com.weav.workspace.shared.exception.UnauthorizedException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.List;
import java.util.Objects;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ApiErrorResponse> handleDomainException(
            DomainException exception,
            HttpServletRequest request
    ) {
        HttpStatus status = statusFor(exception);
        return respond(status, exception.getCode(), exception.getMessage(), List.of(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleBodyValidation(
            MethodArgumentNotValidException exception,
            HttpServletRequest request
    ) {
        List<ApiErrorResponse.ErrorDetail> details = exception.getBindingResult().getFieldErrors().stream()
                .map(this::toDetail)
                .toList();

        List<ApiErrorResponse.ErrorDetail> globalErrors = exception.getBindingResult().getGlobalErrors().stream()
                .map(error -> new ApiErrorResponse.ErrorDetail("global", defaultMessage(error.getDefaultMessage())))
                .toList();

        return respond(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "Request validation failed",
                concat(details, globalErrors),
                request
        );
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodValidation(
            HandlerMethodValidationException exception,
            HttpServletRequest request
    ) {
        List<ApiErrorResponse.ErrorDetail> details = exception.getParameterValidationResults().stream()
                .flatMap(result -> result.getResolvableErrors().stream()
                        .map(error -> new ApiErrorResponse.ErrorDetail(
                                Objects.requireNonNullElse(result.getMethodParameter().getParameterName(), "request"),
                                defaultMessage(error.getDefaultMessage())
                        )))
                .toList();

        return respond(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "Request validation failed",
                details,
                request
        );
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(
            ConstraintViolationException exception,
            HttpServletRequest request
    ) {
        List<ApiErrorResponse.ErrorDetail> details = exception.getConstraintViolations().stream()
                .map(violation -> new ApiErrorResponse.ErrorDetail(
                        violation.getPropertyPath().toString(),
                        violation.getMessage()
                ))
                .toList();

        return respond(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "Request validation failed",
                details,
                request
        );
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleMalformedBody(
            HttpMessageNotReadableException exception,
            HttpServletRequest request
    ) {
        return respond(
                HttpStatus.BAD_REQUEST,
                "MALFORMED_REQUEST",
                "Request body is malformed",
                List.of(),
                request
        );
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiErrorResponse> handleMissingParameter(
            MissingServletRequestParameterException exception,
            HttpServletRequest request
    ) {
        return respond(
                HttpStatus.BAD_REQUEST,
                "MISSING_PARAMETER",
                "Required request parameter is missing",
                List.of(new ApiErrorResponse.ErrorDetail(exception.getParameterName(), "Required request parameter is missing")),
                request
        );
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(
            MethodArgumentTypeMismatchException exception,
            HttpServletRequest request
    ) {
        return respond(
                HttpStatus.BAD_REQUEST,
                "INVALID_PARAMETER",
                "Request parameter has an invalid value",
                List.of(new ApiErrorResponse.ErrorDetail(exception.getName(), "Invalid value")),
                request
        );
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleDataIntegrityViolation(
            DataIntegrityViolationException exception,
            HttpServletRequest request
    ) {
        log.warn("Data integrity violation on {}", request.getRequestURI(), exception);
        return respond(
                HttpStatus.CONFLICT,
                "CONFLICT",
                "Resource state conflicts with existing data",
                List.of(),
                request
        );
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpectedException(
            Exception exception,
            HttpServletRequest request
    ) {
        log.error("Unhandled exception on {}", request.getRequestURI(), exception);
        return respond(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "An unexpected error occurred",
                List.of(),
                request
        );
    }

    private ResponseEntity<ApiErrorResponse> respond(
            HttpStatus status,
            String code,
            String message,
            List<ApiErrorResponse.ErrorDetail> details,
            HttpServletRequest request
    ) {
        return ResponseEntity.status(status).body(
                ApiErrorResponse.of(code, message, status.value(), request.getRequestURI(), details)
        );
    }

    private HttpStatus statusFor(DomainException exception) {
        if (exception instanceof ResourceNotFoundException) {
            return HttpStatus.NOT_FOUND;
        }
        if (exception instanceof ConflictException) {
            return HttpStatus.CONFLICT;
        }
        if (exception instanceof UnauthorizedException) {
            return HttpStatus.UNAUTHORIZED;
        }
        if (exception instanceof ForbiddenException) {
            return HttpStatus.FORBIDDEN;
        }
        if (exception instanceof InvalidStateException) {
            return HttpStatus.UNPROCESSABLE_CONTENT;
        }
        return HttpStatus.BAD_REQUEST;
    }

    private ApiErrorResponse.ErrorDetail toDetail(FieldError error) {
        return new ApiErrorResponse.ErrorDetail(error.getField(), defaultMessage(error.getDefaultMessage()));
    }

    private String defaultMessage(String message) {
        return message == null || message.isBlank() ? "Invalid value" : message;
    }

    private List<ApiErrorResponse.ErrorDetail> concat(
            List<ApiErrorResponse.ErrorDetail> first,
            List<ApiErrorResponse.ErrorDetail> second
    ) {
        return java.util.stream.Stream.concat(first.stream(), second.stream()).toList();
    }
}
