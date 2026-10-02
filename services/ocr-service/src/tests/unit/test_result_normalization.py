#!/usr/bin/env python3
"""Unit tests for OCR result normalization, reading order, Unicode NFC, confidence, and output limits."""

from __future__ import annotations

import unicodedata
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from src.domain.errors import (
    InvalidOptionsError,
    OutputLimitExceededError,
)
from src.domain.models.ocr_result import (
    BoundingBox,
    PageInfo,
    TextBlock,
    calculate_weighted_confidence,
    normalize_raw_text,
)
from src.domain.ports.document_loader_port import LoadedDocument
from src.domain.ports.ocr_engine_port import ExtractionOptions
from src.infrastructure.engines.paddle_ocr_engine_adapter import (
    MAX_BLOCKS_LIMIT,
    PaddleOcrEngineAdapter,
    resolve_paddle_language,
)
from src.infrastructure.processors.pdf_renderer import RenderedPage

# ---------------------------------------------------------------------------
# Test Doubles for Engine Inference
# ---------------------------------------------------------------------------


class MockOcrInstance:
    """Mock OCR engine returning deterministic detection structures."""

    def __init__(self, detections_by_page: list[Any] | None = None) -> None:
        self.detections_by_page = list(detections_by_page or [])
        self.call_count = 0

    def ocr(self, image: Any, cls: bool = True) -> Any:
        self.call_count += 1
        if self.detections_by_page:
            return self.detections_by_page.pop(0)
        return []


class MockPaddle3ResultEngine:
    """PaddleOCR 3.x-shaped predictor returning a mapping-like result."""

    def __init__(self) -> None:
        self.return_word_box: bool | None = None
        self.received_shape: tuple[int, ...] | None = None

    def predict(self, image: Any, *, return_word_box: bool = False) -> list[dict[str, Any]]:
        self.return_word_box = return_word_box
        self.received_shape = tuple(image.shape)
        return [
            {
                "rec_polys": [np.asarray([[10, 10], [90, 10], [90, 30], [10, 30]])],
                "rec_texts": ["Tie\u0302\u0301n"],
                "rec_scores": np.asarray([0.91]),
            }
        ]


class MockPaddle3StreamingEngine(MockPaddle3ResultEngine):
    """PaddleOCR 3.x-shaped predictor returning a lazy iterator."""

    def predict(self, image: Any, *, return_word_box: bool = False):
        return iter(super().predict(image, return_word_box=return_word_box))


class MockRenderer:
    """Mock page renderer returning simulated page images."""

    def __init__(self, pages: list[RenderedPage] | None = None) -> None:
        self.pages = pages or []

    def render_document(self, doc: LoadedDocument) -> Any:
        yield from self.pages


# ---------------------------------------------------------------------------
# Unit Test Suite: Language Mapping Policy
# ---------------------------------------------------------------------------


class TestLanguageMappingPolicy:
    """Tests WEAV language resolution to ensure 'vi+en' is never passed verbatim to Paddle."""

    def test_vietnamese_mapping(self):
        paddle_code, resolved = resolve_paddle_language("vi")
        assert paddle_code == "vi"
        assert resolved == "vi"

    def test_english_mapping(self):
        paddle_code, resolved = resolve_paddle_language("en")
        assert paddle_code == "en"
        assert resolved == "en"

    def test_bilingual_vi_plus_en_never_passed_verbatim(self):
        """'vi+en' must map to Vietnamese-capable key 'vi', never verbatim or latin."""
        paddle_code, resolved = resolve_paddle_language("vi+en")
        assert paddle_code != "vi+en", "Language 'vi+en' must not be passed verbatim to PaddleOCR"
        assert paddle_code != "latin", "Language 'vi+en' must never resolve to non-Vietnamese 'latin'"
        assert paddle_code == "vi", "Language 'vi+en' must resolve to Vietnamese-capable profile key 'vi'"
        assert resolved != "latin", "resolvedLanguage for 'vi+en' must not be 'latin'"
        assert resolved != "latin-multilingual", "resolvedLanguage for 'vi+en' must not be 'latin-multilingual'"
        assert resolved == "vi", "Resolved language metadata must explicitly indicate 'vi'"

    def test_unsupported_language_raises_invalid_options(self):
        with pytest.raises(InvalidOptionsError):
            resolve_paddle_language("fr")  # type: ignore[arg-type]


class TestPaddleInputCompatibility:
    """Tests the SDK-boundary conversion from internal grayscale to HxWxC."""

    def test_grayscale_image_is_expanded_for_paddle3(self):
        adapter = PaddleOcrEngineAdapter()
        engine = MockPaddle3ResultEngine()

        adapter._run_engine_inference(engine, np.zeros((32, 48), dtype=np.uint8))

        assert engine.received_shape == (32, 48, 3)

    def test_paddle3_prediction_iterator_is_materialized(self):
        adapter = PaddleOcrEngineAdapter()
        engine = MockPaddle3StreamingEngine()

        result = adapter._run_engine_inference(
            engine,
            np.zeros((32, 48), dtype=np.uint8),
        )

        assert isinstance(result, list)
        assert result[0]["rec_texts"] == ["Tie\u0302\u0301n"]


# ---------------------------------------------------------------------------
# Unit Test Suite: Reading Order & Unicode Normalization
# ---------------------------------------------------------------------------


class TestReadingOrderAndUnicodeNormalization:
    """Tests 2D reading-order sorting and Unicode NFC normalization."""

    def test_unicode_nfc_normalization(self):
        """Decomposed characters (NFD) must be normalized to canonical precomposed NFC."""
        # NFD: "T" + "i" + "e" + combining circumflex + combining acute
        nfd_text = "Ti\u0065\u0302\u0301n"  # "Tiến" in NFD
        assert len(nfd_text) == 6

        nfc_normalized = unicodedata.normalize("NFC", nfd_text)
        assert len(nfc_normalized) == 4
        assert nfc_normalized == "Tiến"

    def test_reading_order_sorting_across_columns_and_lines(self):
        """Lines higher on the page appear first; within the same line, left comes before right."""
        adapter = PaddleOcrEngineAdapter()

        # Unsorted blocks on a page
        blocks = [
            TextBlock(
                id="b3",
                order=0,
                text="Right Column Line 1",
                confidence=0.95,
                page=1,
                boundingBox=BoundingBox(x=350.0, y=50.0, width=200.0, height=20.0),
            ),
            TextBlock(
                id="b1",
                order=0,
                text="Left Column Line 1",
                confidence=0.98,
                page=1,
                boundingBox=BoundingBox(x=50.0, y=50.0, width=200.0, height=20.0),
            ),
            TextBlock(
                id="b4",
                order=0,
                text="Line 2 Full Width",
                confidence=0.92,
                page=1,
                boundingBox=BoundingBox(x=50.0, y=120.0, width=500.0, height=20.0),
            ),
        ]

        sorted_blocks = adapter._sort_reading_order(blocks)
        texts = [b.text for b in sorted_blocks]

        # Top line sorted left-to-right, followed by line 2
        assert texts == ["Left Column Line 1", "Right Column Line 1", "Line 2 Full Width"]

    def test_raw_text_assembly_with_page_separator(self):
        """Multi-page raw text uses \n for lines and \n\f\n for page boundaries."""
        blocks = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Page 1 Header",
                confidence=0.95,
                page=1,
                boundingBox=BoundingBox(x=50.0, y=50.0, width=200.0, height=20.0),
            ),
            TextBlock(
                id="p1-b2",
                order=1,
                text="Page 1 Body",
                confidence=0.92,
                page=1,
                boundingBox=BoundingBox(x=50.0, y=100.0, width=200.0, height=20.0),
            ),
            TextBlock(
                id="p2-b1",
                order=2,
                text="Page 2 Content",
                confidence=0.88,
                page=2,
                boundingBox=BoundingBox(x=50.0, y=50.0, width=200.0, height=20.0),
            ),
        ]

        raw_text = normalize_raw_text(blocks, total_pages=2)
        expected = "Page 1 Header\nPage 1 Body\n\f\nPage 2 Content"
        assert raw_text == expected


# ---------------------------------------------------------------------------
# Unit Test Suite: Weighted Confidence & Quality Classification
# ---------------------------------------------------------------------------


class TestWeightedConfidenceCalculation:
    """Tests confidence score calculation weighted by non-whitespace Unicode code points."""

    def test_empty_blocks_yields_none_confidence_and_empty_quality(self):
        score, quality = calculate_weighted_confidence([])
        assert score is None
        assert quality == "EMPTY"

    def test_whitespace_only_blocks_yields_none_confidence_and_empty_quality(self):
        blocks = [
            TextBlock(
                id="b1",
                order=0,
                text="   \t\n  ",
                confidence=0.95,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=10.0, width=10.0, height=10.0),
            )
        ]
        score, quality = calculate_weighted_confidence(blocks)
        assert score is None
        assert quality == "EMPTY"

    def test_weighted_confidence_weights_by_non_whitespace_character_count(self):
        """Block with 10 characters at 0.90 and block with 30 characters at 0.50 -> (9 + 15)/40 = 0.60."""
        blocks = [
            # 10 non-whitespace chars, conf 0.90
            TextBlock(
                id="b1",
                order=0,
                text="1234567890",
                confidence=0.90,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=10.0, width=10.0, height=10.0),
            ),
            # 30 non-whitespace chars, conf 0.50
            TextBlock(
                id="b2",
                order=1,
                text="abcdefghij abcdefghij abcdefghij",  # 30 chars (excluding spaces)
                confidence=0.50,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=30.0, width=10.0, height=10.0),
            ),
        ]

        score, quality = calculate_weighted_confidence(blocks)
        # Weighted avg: (10 * 0.90 + 30 * 0.50) / 40 = 24.0 / 40 = 0.60
        assert score == 0.60
        # Score < 0.70 must be classified as LOW_CONFIDENCE
        assert quality == "LOW_CONFIDENCE"

    def test_high_confidence_classified_as_ok(self):
        blocks = [
            TextBlock(
                id="b1",
                order=0,
                text="High Confidence Recognition",
                confidence=0.98,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=10.0, width=100.0, height=20.0),
            )
        ]
        score, quality = calculate_weighted_confidence(blocks)
        assert score == 0.98
        assert quality == "OK"


# ---------------------------------------------------------------------------
# Unit Test Suite: Warnings & Output Limits
# ---------------------------------------------------------------------------


class TestWarningsAndOutputLimits:
    """Tests extraction warnings (BLANK_PAGE, LOW_CONFIDENCE) and output cap enforcement."""

    @pytest.mark.asyncio
    async def test_blank_page_generates_warning(self, tmp_path: Path):
        """Page with no recognized detections generates BLANK_PAGE warning."""
        mock_renderer = MockRenderer([
            RenderedPage(page_number=1, image=np.zeros((100, 100, 3), dtype=np.uint8), width=100, height=100)
        ])
        mock_ocr = MockOcrInstance(detections_by_page=[[]])  # 0 detections

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=mock_renderer,  # type: ignore[arg-type]
            ocr_instance_map={"vi": mock_ocr},
        )

        doc = LoadedDocument(
            file_path=tmp_path / "blank.png",
            file_name="blank.png",
            mime_type="image/png",
            size_bytes=100,
            pages=1,
            page_info=[PageInfo(page=1, width=100, height=100)],
        )

        result = await adapter.extract(doc, ExtractionOptions(language="vi+en"))
        assert len(result.blocks) == 0
        assert any(w.code == "BLANK_PAGE" for w in result.warnings)

    @pytest.mark.asyncio
    async def test_paddle_3_result_mapping_is_normalized(self, tmp_path: Path):
        """PaddleOCR 3.x rec_* arrays are converted to canonical WEAV blocks."""
        mock_renderer = MockRenderer([
            RenderedPage(page_number=1, image=np.zeros((100, 100, 3), dtype=np.uint8), width=100, height=100)
        ])
        mock_ocr = MockPaddle3ResultEngine()
        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=mock_renderer,  # type: ignore[arg-type]
            ocr_instance_map={"vi": mock_ocr},
        )
        doc = LoadedDocument(
            file_path=tmp_path / "mapped.png",
            file_name="mapped.png",
            mime_type="image/png",
            size_bytes=100,
            pages=1,
            page_info=[PageInfo(page=1, width=100, height=100)],
        )

        result = await adapter.extract(doc, ExtractionOptions(language="vi+en"))

        assert mock_ocr.return_word_box is False
        assert result.resolved_language == "vi"
        assert len(result.blocks) == 1
        assert result.blocks[0].text == "Tiến"
        assert result.blocks[0].boundingBox.x == 10.0
        assert result.blocks[0].boundingBox.width == 80.0

    @pytest.mark.asyncio
    async def test_low_confidence_block_generates_warning(self, tmp_path: Path):
        """Block with confidence < 0.50 generates LOW_CONFIDENCE warning with blockId."""
        poly = [[10, 10], [90, 10], [90, 30], [10, 30]]
        mock_renderer = MockRenderer([
            RenderedPage(page_number=1, image=np.zeros((100, 100, 3), dtype=np.uint8), width=100, height=100)
        ])
        # Score 0.42 < 0.50 threshold
        mock_ocr = MockOcrInstance(detections_by_page=[[[[poly, ("Faint Text", 0.42)]]]])

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=mock_renderer,  # type: ignore[arg-type]
            ocr_instance_map={"vi": mock_ocr},
            low_confidence_threshold=0.50,
        )

        doc = LoadedDocument(
            file_path=tmp_path / "faint.png",
            file_name="faint.png",
            mime_type="image/png",
            size_bytes=100,
            pages=1,
            page_info=[PageInfo(page=1, width=100, height=100)],
        )

        result = await adapter.extract(doc, ExtractionOptions(language="vi+en"))
        assert len(result.blocks) == 1
        low_conf_warnings = [w for w in result.warnings if w.code == "LOW_CONFIDENCE"]
        assert len(low_conf_warnings) == 1
        assert low_conf_warnings[0].page == 1
        assert low_conf_warnings[0].blockId == "p1-b1"

    @pytest.mark.asyncio
    async def test_output_caps_exceeding_max_blocks_raises_error(self, tmp_path: Path):
        """Block count exceeding 20,000 raises OutputLimitExceededError."""
        # Generate 20,001 detections
        poly = [[10, 10], [90, 10], [90, 30], [10, 30]]
        huge_detections = [[[poly, (f"Text {i}", 0.95)] for i in range(MAX_BLOCKS_LIMIT + 1)]]

        mock_renderer = MockRenderer([
            RenderedPage(page_number=1, image=np.zeros((100, 100, 3), dtype=np.uint8), width=100, height=100)
        ])
        mock_ocr = MockOcrInstance(detections_by_page=huge_detections)

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=mock_renderer,  # type: ignore[arg-type]
            ocr_instance_map={"vi": mock_ocr},
        )

        doc = LoadedDocument(
            file_path=tmp_path / "huge.png",
            file_name="huge.png",
            mime_type="image/png",
            size_bytes=100,
            pages=1,
            page_info=[PageInfo(page=1, width=100, height=100)],
        )

        with pytest.raises(OutputLimitExceededError) as exc_info:
            await adapter.extract(doc, ExtractionOptions(language="vi+en"))

        assert exc_info.value.code == "OUTPUT_LIMIT_EXCEEDED"
        assert exc_info.value.status_code == 422
