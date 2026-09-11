#!/usr/bin/env python3
"""Domain models package."""

from src.domain.models.ocr_request import (
    ArtifactSource,
    BaseDomainModel,
    LanguageOption,
    OcrRequest,
    UploadSource,
    UrlSource,
    validate_single_source,
)
from src.domain.models.ocr_result import (
    BoundingBox,
    DocumentInfo,
    ExtractionMetadata,
    ExtractionWarning,
    OcrExtractionResult,
    PageInfo,
    PreprocessingRecord,
    TableCell,
    TableResult,
    TextBlock,
    TextResult,
    calculate_weighted_confidence,
    normalize_raw_text,
)

__all__ = [
    "ArtifactSource",
    "BaseDomainModel",
    "BoundingBox",
    "DocumentInfo",
    "ExtractionMetadata",
    "ExtractionWarning",
    "LanguageOption",
    "OcrExtractionResult",
    "OcrRequest",
    "PageInfo",
    "PreprocessingRecord",
    "TableCell",
    "TableResult",
    "TextBlock",
    "TextResult",
    "UploadSource",
    "UrlSource",
    "calculate_weighted_confidence",
    "normalize_raw_text",
    "validate_single_source",
]
