#!/usr/bin/env python3
"""Port interface for image preprocessing operations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PreprocessingResult(BaseModel):
    """Result of preprocessing an individual page image."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    page: int = Field(..., ge=1)
    processed_image: Any = Field(..., description="Processed image array or buffer")
    steps_applied: list[str] = Field(default_factory=list, description="Names of operations applied")
    inverse_transform: Any | None = Field(default=None, description="Transform to map boxes back to canonical coords")


class PreprocessorPort(ABC):
    """Abstract port for OpenCV / image preprocessing adapters."""

    @abstractmethod
    def preprocess_page(
        self,
        page_image: Any,
        page_number: int,
    ) -> PreprocessingResult:
        """Apply targeted image enhancements (e.g. grayscale, contrast, deskew) for a given page."""
        ...

    def preprocess_page_fallback(
        self,
        page_image: Any,
        page_number: int,
    ) -> PreprocessingResult:
        """Apply targeted fallback enhancements (e.g. safe upscale, adaptive contrast) for low-quality results."""
        return self.preprocess_page(page_image, page_number)
