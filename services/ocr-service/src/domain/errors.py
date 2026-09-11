#!/usr/bin/env python3
"""Domain error hierarchy and typed exceptions for the OCR Service.

Framework-independent domain errors matching the frozen API error codes
and HTTP status mappings defined in the OCR contract spec.
"""

from __future__ import annotations

import uuid
from typing import Any


class OcrDomainError(Exception):
    """Base domain exception for all OCR service operational and validation errors."""

    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.retryable = retryable
        self.details = details or {}

    def to_envelope(self, request_id: str | uuid.UUID) -> dict[str, Any]:
        """Format error as canonical API error envelope according to frozen contract."""
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "details": self.details,
            },
            "requestId": str(request_id),
        }

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(code='{self.code}', status_code={self.status_code}, "
            f"message='{self.message}', retryable={self.retryable})"
        )


class InvalidRequestError(OcrDomainError):
    """400: Multiple sources, invalid source parameters, malformed request, or invalid options."""

    def __init__(self, message: str = "Invalid extraction request", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="INVALID_REQUEST", status_code=400, retryable=False, details=details)


class UnauthenticatedError(OcrDomainError):
    """401: Missing or invalid authentication token."""

    def __init__(self, message: str = "Authentication required", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="UNAUTHENTICATED", status_code=401, retryable=False, details=details)


class ForbiddenError(OcrDomainError):
    """403: Caller lacks execution permission for workspace or resource."""

    def __init__(self, message: str = "Access forbidden", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="FORBIDDEN", status_code=403, retryable=False, details=details)


class ArtifactNotFoundError(OcrDomainError):
    """404: Artifact not found, expired, deleted, or cross-tenant access attempted."""

    def __init__(self, message: str = "Artifact not found", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="ARTIFACT_NOT_FOUND", status_code=404, retryable=False, details=details)


class FileTooLargeError(OcrDomainError):
    """413: Streamed byte size exceeds the 10 MiB (10,485,760 bytes) cap."""

    def __init__(
        self,
        message: str = "Document file size exceeds 10 MiB (10,485,760 bytes) limit",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, code="FILE_TOO_LARGE", status_code=413, retryable=False, details=details)


class DocumentLimitExceededError(OcrDomainError):
    """413: Page count exceeds 10 pages or image dimensions exceed limits (e.g., >10000px or >20MP/page)."""

    def __init__(
        self,
        message: str = "Document exceeds allowable page count (max 10) or dimension limits",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message, code="DOCUMENT_LIMIT_EXCEEDED", status_code=413, retryable=False, details=details
        )


class UnsupportedMediaTypeError(OcrDomainError):
    """415: Media type is unsupported or verified content does not match allowed types (PNG, JPEG, WEBP, PDF)."""

    def __init__(
        self,
        message: str = "Unsupported media type. Supported types: image/png, image/jpeg, image/webp, application/pdf",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message, code="UNSUPPORTED_MEDIA_TYPE", status_code=415, retryable=False, details=details
        )


class InvalidOptionsError(OcrDomainError):
    """422: Extraction options are semantically invalid."""

    def __init__(self, message: str = "Invalid extraction options", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="INVALID_OPTIONS", status_code=422, retryable=False, details=details)


class CorruptFileError(OcrDomainError):
    """422: File content is corrupted, truncated, or fails decoder signature validation."""

    def __init__(self, message: str = "Document file is corrupted or unreadable", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="CORRUPT_FILE", status_code=422, retryable=False, details=details)


class EncryptedPdfError(OcrDomainError):
    """422: PDF file is password protected or encrypted."""

    def __init__(self, message: str = "Encrypted or password-protected PDF is not supported", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="ENCRYPTED_PDF", status_code=422, retryable=False, details=details)


class AnimatedImageUnsupportedError(OcrDomainError):
    """422: Animated images (e.g., animated WEBP) are rejected in v1."""

    def __init__(self, message: str = "Animated images are not supported", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message=message, code="ANIMATED_IMAGE_UNSUPPORTED", status_code=422, retryable=False, details=details
        )


class SourceUrlNotAllowedError(OcrDomainError):
    """422: URL scheme is not HTTPS, port is not 443, host is disallowed, or SSRF policy triggered."""

    def __init__(self, message: str = "Source URL is not allowed by security policy", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message=message, code="SOURCE_URL_NOT_ALLOWED", status_code=422, retryable=False, details=details
        )


class SourceUnavailableError(OcrDomainError):
    """422: Upstream source returned 4xx or file is unreachable."""

    def __init__(self, message: str = "Source document is unavailable at the provided location", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="SOURCE_UNAVAILABLE", status_code=422, retryable=False, details=details)


class OutputLimitExceededError(OcrDomainError):
    """422: Extracted output exceeds size or structural limits."""

    def __init__(self, message: str = "Extracted document content exceeds output limits", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="OUTPUT_LIMIT_EXCEEDED", status_code=422, retryable=False, details=details)


class RateLimitedError(OcrDomainError):
    """429: Concurrency or rate quota exceeded."""

    def __init__(self, message: str = "Rate limit exceeded", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="RATE_LIMITED", status_code=429, retryable=True, details=details)


class InternalError(OcrDomainError):
    """500: Internal server processing error (sanitized message without internal paths/secrets)."""

    def __init__(self, message: str = "An internal error occurred while processing the document", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="INTERNAL_ERROR", status_code=500, retryable=False, details=details)


class SourceFetchFailedError(OcrDomainError):
    """502: Transient network or connection error when fetching external source."""

    def __init__(
        self,
        message: str = "Failed to fetch source document from remote server",
        retryable: bool = True,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, code="SOURCE_FETCH_FAILED", status_code=502, retryable=retryable, details=details)


class TableExtractionFailedError(OcrDomainError):
    """502: Table extraction pipeline failure."""

    def __init__(self, message: str = "Table extraction pipeline failed", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message=message, code="TABLE_EXTRACTION_FAILED", status_code=502, retryable=False, details=details
        )


class OcrBusyError(OcrDomainError):
    """503: OCR engine worker queue is saturated."""

    def __init__(self, message: str = "OCR engine is busy. Please retry later", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="OCR_BUSY", status_code=503, retryable=True, details=details)


class ModelNotReadyError(OcrDomainError):
    """503: Engine models are still loading or initializing."""

    def __init__(self, message: str = "OCR models are initializing", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="MODEL_NOT_READY", status_code=503, retryable=True, details=details)


class SourceTimeoutError(OcrDomainError):
    """504: Source fetch operation exceeded connection or read timeout."""

    def __init__(self, message: str = "Fetching source document timed out", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="SOURCE_TIMEOUT", status_code=504, retryable=False, details=details)


class OcrTimeoutError(OcrDomainError):
    """504: Document extraction exceeded processing deadline."""

    def __init__(self, message: str = "Document processing exceeded the allowed time", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="OCR_TIMEOUT", status_code=504, retryable=False, details=details)


class RequestTimeoutError(OcrDomainError):
    """504: Overall request deadline exceeded."""

    def __init__(self, message: str = "Request exceeded overall deadline", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="REQUEST_TIMEOUT", status_code=504, retryable=False, details=details)


class UploadTimeoutError(OcrDomainError):
    """408: Gateway client upload timed out."""

    def __init__(self, message: str = "Client upload timed out", details: dict[str, Any] | None = None) -> None:
        super().__init__(message=message, code="UPLOAD_TIMEOUT", status_code=408, retryable=False, details=details)
