#!/usr/bin/env python3
"""Port interface for native OCR extraction engines."""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, ConfigDict, Field

from src.domain.models.ocr_request import LanguageOption
from src.domain.models.ocr_result import (
    ExtractionWarning,
    PreprocessingRecord,
    TextBlock,
)
from src.domain.ports.document_loader_port import LoadedDocument


class ExtractionOptions(BaseModel):
    """Runtime options passed to OCR engine and table extraction."""

    model_config = ConfigDict(extra="forbid")

    language: LanguageOption = "vi+en"
    detect_tables: bool = True


class EngineOcrResult(BaseModel):
    """Raw extraction result returned by the OCR engine adapter before application normalization."""

    model_config = ConfigDict(extra="forbid")

    blocks: list[TextBlock] = Field(default_factory=list)
    raw_text: str | None = Field(default=None)
    resolved_language: str = Field(default="vi")
    engine_name: str = Field(default="paddleocr")
    engine_version: str = Field(default="3.7.0")
    model_revision: str = Field(default="approved-model-manifest-id")
    preprocessing: list[PreprocessingRecord] = Field(default_factory=list)
    warnings: list[ExtractionWarning] = Field(default_factory=list)


class OcrEnginePort(ABC):
    """Abstract port for OCR recognition engines."""

    @abstractmethod
    async def extract(
        self,
        document: LoadedDocument,
        options: ExtractionOptions,
    ) -> EngineOcrResult:
        """Run OCR extraction over loaded document.

        Must NOT be called if request validation or document loading fails.
        """
        ...
