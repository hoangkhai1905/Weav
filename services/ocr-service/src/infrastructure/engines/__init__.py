#!/usr/bin/env python3
"""Engines package for native OCR and table inference adapters."""

from src.infrastructure.engines.paddle_ocr_engine_adapter import PaddleOcrEngineAdapter
from src.infrastructure.engines.paddle_table_engine_adapter import (
    PaddleTableEngineAdapter,
)

__all__ = [
    "PaddleOcrEngineAdapter",
    "PaddleTableEngineAdapter",
]
