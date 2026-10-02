#!/usr/bin/env python3
"""FastAPI dependency injection provider for the OCR Service."""

from __future__ import annotations

from src.application.use_cases.extract_text_use_case import ExtractTextUseCase
from src.domain.ports.artifact_resolver_port import ArtifactResolverPort
from src.infrastructure.engines.paddle_ocr_engine_adapter import PaddleOcrEngineAdapter
from src.infrastructure.engines.paddle_table_engine_adapter import (
    PaddleTableEngineAdapter,
)
from src.infrastructure.files.document_loader import DocumentLoader
from src.infrastructure.files.safe_url_fetcher import SafeUrlFetcher
from src.infrastructure.processors.opencv_preprocessor_adapter import (
    OpenCvPreprocessorAdapter,
)
from src.infrastructure.processors.pdf_renderer import PdfRenderer

_use_case: ExtractTextUseCase | None = None


def create_extract_text_use_case(
    artifact_resolver: ArtifactResolverPort | None = None,
) -> ExtractTextUseCase:
    """Create a fully wired ExtractTextUseCase with real infrastructure adapters.

    Only configures the artifact resolver boundary if its upstream client is available.
    Keeps direct DB access completely out of OCR.
    """
    document_loader = DocumentLoader()
    pdf_renderer = PdfRenderer()
    preprocessor = OpenCvPreprocessorAdapter()
    ocr_engine = PaddleOcrEngineAdapter(
        pdf_renderer=pdf_renderer,
        preprocessor=preprocessor,
    )
    table_engine = PaddleTableEngineAdapter(
        pdf_renderer=pdf_renderer,
    )
    url_fetcher = SafeUrlFetcher()

    return ExtractTextUseCase(
        document_loader=document_loader,
        ocr_engine=ocr_engine,
        artifact_resolver=artifact_resolver,
        url_fetcher=url_fetcher,
        table_engine=table_engine,
    )


def set_extract_text_use_case(use_case: ExtractTextUseCase | None) -> None:
    """Set the active singleton ExtractTextUseCase instance."""
    global _use_case
    _use_case = use_case


def get_extract_text_use_case() -> ExtractTextUseCase:
    """FastAPI dependency to retrieve the active ExtractTextUseCase."""
    global _use_case
    if _use_case is None:
        _use_case = create_extract_text_use_case()
    return _use_case
