#!/usr/bin/env python3
"""Port interface for document loading, magic byte inspection, and metadata validation."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from src.domain.models.ocr_result import MimeTypeOption, PageInfo


class LoadedDocument(BaseModel):
    """Validated, locally spooled document ready for processing."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    file_path: Path = Field(..., description="Local path to verified document file")
    file_name: str = Field(..., description="Sanitized client basename")
    mime_type: MimeTypeOption = Field(..., description="Canonical verified media type")
    size_bytes: int = Field(..., ge=0, description="Exact byte size on disk")
    pages: int = Field(..., ge=1, le=10, description="Total page count (1-10)")
    page_info: list[PageInfo] = Field(..., description="Per-page geometry (width, height, dpi)")


class DocumentLoaderPort(ABC):
    """Abstract port for inspecting and validating document files."""

    @abstractmethod
    def validate_and_load(
        self,
        file_path: Path,
        client_filename: str | None = None,
    ) -> LoadedDocument:
        """Inspect magic bytes, verify decoder validity and canonical MIME type, enforce limits.

        Does NOT perform PDF rasterization or OCR inference.

        Raises:
            CorruptFileError: If header/body is malformed, truncated, or fails decoder check.
            UnsupportedMediaTypeError: If content is not PNG, JPEG, WEBP, or PDF.
            EncryptedPdfError: If PDF is encrypted.
            AnimatedImageUnsupportedError: If image contains animation (e.g. animated WEBP).
            DocumentLimitExceededError: If pages > 10 or dimensions exceed 10,000px / 20MP.
        """
        ...
