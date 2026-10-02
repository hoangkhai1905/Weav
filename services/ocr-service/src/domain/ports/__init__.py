#!/usr/bin/env python3
"""Domain ports package."""

from src.domain.ports.artifact_resolver_port import (
    ArtifactDescriptor,
    ArtifactResolverPort,
)
from src.domain.ports.document_loader_port import DocumentLoaderPort, LoadedDocument
from src.domain.ports.ocr_engine_port import (
    EngineOcrResult,
    ExtractionOptions,
    OcrEnginePort,
)
from src.domain.ports.preprocessor_port import PreprocessingResult, PreprocessorPort
from src.domain.ports.table_engine_port import TableEnginePort

__all__ = [
    "ArtifactDescriptor",
    "ArtifactResolverPort",
    "DocumentLoaderPort",
    "EngineOcrResult",
    "ExtractionOptions",
    "LoadedDocument",
    "OcrEnginePort",
    "PreprocessingResult",
    "PreprocessorPort",
    "TableEnginePort",
]
