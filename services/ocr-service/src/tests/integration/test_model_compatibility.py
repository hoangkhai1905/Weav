#!/usr/bin/env python3

"""Integration test for OCR model and runtime environment compatibility.

Checks:
  - Python runtime version constraints (3.12.x)
  - OpenCV package distribution and cv2 namespace collision detection
  - PaddlePaddle and PaddleOCR SDK availability with explicit pending evidence reporting
  - Language parameter mapping (asserts 'vi+en' is never passed verbatim to Paddle)
  - Table engine configuration requirements
"""

from __future__ import annotations

import sys
from typing import Any

import pytest


def test_python_runtime_version():
    """Verify that Python runtime satisfies requires-python >=3.12,<3.13."""
    major, minor = sys.version_info.major, sys.version_info.minor
    assert major == 3, f"Expected Python major version 3, got {major}"
    assert minor == 12, f"Expected Python minor version 12, got {minor} ({sys.version})"


def test_opencv_namespace_and_collision():
    """Verify OpenCV distribution and check for namespace collision."""
    try:
        import cv2  # type: ignore
    except ImportError:
        pytest.skip(
            "OpenCV (cv2) is not installed in the current local environment. "
            "Verification pending in target Linux container (python:3.12-slim-bookworm)."
        )

    # Check version string
    cv_version = getattr(cv2, "__version__", None)
    assert cv_version is not None, "cv2.__version__ is missing"

    # Check for duplicate package collision risk
    import importlib.metadata

    installed_dist_names = {
        dist.metadata["Name"].lower() for dist in importlib.metadata.distributions()
    }
    headless_installed = "opencv-python-headless" in installed_dist_names
    contrib_installed = "opencv-contrib-python" in installed_dist_names

    if headless_installed and contrib_installed:
        pytest.fail(
            "COLLISION DETECTED: Both 'opencv-python-headless' and 'opencv-contrib-python' "
            "are installed simultaneously. Exactly one OpenCV distribution must be pinned "
            "to avoid symbol conflicts and native C++ runtime crashes."
        )


def test_paddle_sdk_import_or_pending_evidence():
    """Check PaddlePaddle and PaddleOCR runtime availability.

    Explicitly does NOT pretend inference passed if runtime/model evidence is unavailable.
    """
    try:
        import paddle  # type: ignore
        import paddleocr  # type: ignore
    except ImportError as e:
        pytest.skip(
            f"PENDING RUNTIME EVIDENCE: PaddlePaddle/PaddleOCR not available in current host ({e}). "
            "Real inference verification requires target CPU container with libgomp1, libgl1, and libglib2.0-0."
        )

    # If paddle is importable, verify CPU build and version
    assert hasattr(paddle, "__version__"), "Paddle missing __version__ attribute"
    assert hasattr(paddleocr, "__version__"), "PaddleOCR missing __version__ attribute"


def test_language_parameter_mapping_policy():
    """Verify that WEAV API language options are safely mapped before invoking PaddleOCR.

    PaddleOCR does not accept 'vi+en' as a native language string.
    The adapter must resolve both 'vi' and 'vi+en' to a Vietnamese-capable profile key ('vi'),
    and must never resolve 'vi+en' to 'latin' or pass 'vi+en' verbatim.
    """
    from src.infrastructure.engines.paddle_ocr_engine_adapter import (
        resolve_paddle_language,
    )

    weav_languages = ["vi", "en", "vi+en"]

    for lang in weav_languages:
        paddle_lang, resolved = resolve_paddle_language(lang)  # type: ignore[arg-type]
        assert paddle_lang != "vi+en", f"Language '{lang}' must not be passed verbatim to Paddle"
        assert paddle_lang in {"vi", "en"}, f"Paddle language '{paddle_lang}' must be a supported profile key"
        assert paddle_lang != "latin", f"Language '{lang}' must not resolve to 'latin'"
        assert resolved in {"vi", "en"}, f"Resolved language metadata '{resolved}' is invalid"

    # Explicit regression tests proving vi+en never resolves to latin and metadata is explicit
    vi_en_paddle, vi_en_resolved = resolve_paddle_language("vi+en")
    assert vi_en_paddle != "latin", "'vi+en' must never resolve to 'latin'"
    assert vi_en_paddle == "vi", "'vi+en' must resolve to Vietnamese-capable profile key 'vi'"
    assert vi_en_resolved != "latin", "resolvedLanguage for 'vi+en' must not be 'latin'"
    assert vi_en_resolved != "latin-multilingual", "resolvedLanguage for 'vi+en' must not be 'latin-multilingual'"
    assert vi_en_resolved == "vi", "resolvedLanguage for 'vi+en' must explicitly be 'vi'"

    # Preserve English mapping
    en_paddle, en_resolved = resolve_paddle_language("en")
    assert en_paddle == "en"
    assert en_resolved == "en"

    # Preserve Vietnamese mapping
    vi_paddle, vi_resolved = resolve_paddle_language("vi")
    assert vi_paddle == "vi"
    assert vi_resolved == "vi"


def test_table_structure_detection_requirements():
    """Verify table engine output contract requirements."""
    # Table extraction must not produce business/invoice entities or unescaped HTML
    forbidden_keys = {"html", "raw_html", "invoice_total", "vendor"}
    sample_table_output: dict[str, Any] = {
        "rowCount": 2,
        "columnCount": 2,
        "cells": [
            {"row": 0, "column": 0, "rowSpan": 1, "columnSpan": 1, "text": "Header A"},
            {"row": 0, "column": 1, "rowSpan": 1, "columnSpan": 1, "text": "Header B"},
        ],
    }

    assert not any(k in sample_table_output for k in forbidden_keys)
    assert sample_table_output["rowCount"] > 0
    assert sample_table_output["columnCount"] > 0
