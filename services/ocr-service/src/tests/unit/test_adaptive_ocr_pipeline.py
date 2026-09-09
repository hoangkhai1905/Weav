#!/usr/bin/env python3
"""Unit tests for OCR adaptive fallback pipeline.

Validates:
- Fallback pass trigger conditions (low confidence, 0 blocks, short text).
- No fallback pass triggered when default pass is high quality (bounded latency).
- Strict upper bound on passes (maximum 1 fallback pass = max 2 total passes).
- Deterministic quality selection (weighted confidence + useful text, not blind text length).
- Protection against noisy / hallucinated longer text.
- Inverse coordinate transform preservation (canonical page coordinates and clamping).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
import pytest

from src.domain.models.ocr_result import BoundingBox, TextBlock
from src.domain.ports.document_loader_port import LoadedDocument, PageInfo
from src.domain.ports.ocr_engine_port import ExtractionOptions
from src.domain.ports.preprocessor_port import PreprocessingResult, PreprocessorPort
from src.infrastructure.engines.paddle_ocr_engine_adapter import (
    PaddleOcrEngineAdapter,
    compute_pass_quality_score,
)
from src.infrastructure.processors.opencv_preprocessor_adapter import (
    InverseCoordinateTransform,
)


def _make_dummy_loaded_doc(width: int = 1000, height: int = 1400) -> LoadedDocument:
    """Create a synthetic single-page LoadedDocument for testing."""
    return LoadedDocument(
        file_path="dummy.png",
        file_name="dummy.png",
        mime_type="image/png",
        size_bytes=1024,
        pages=1,
        page_info=[PageInfo(page=1, width=width, height=height, dpi=None)],
    )


class MockPdfRenderer:
    """Mock renderer yielding synthetic image arrays with specified geometry."""

    def __init__(self, width: int = 1000, height: int = 1400) -> None:
        self.width = width
        self.height = height

    def render_document(self, document: LoadedDocument):
        rendered = MagicMock()
        rendered.page_number = 1
        rendered.width = self.width
        rendered.height = self.height
        rendered.image = np.full((self.height, self.width), 255, dtype=np.uint8)
        yield rendered


class TestPassQualityScoring:
    """Tests deterministic scoring function combining weighted confidence and useful text."""

    def test_empty_blocks_scores_zero(self):
        score = compute_pass_quality_score([])
        assert score == 0.0

    def test_punctuation_noise_heavily_penalized(self):
        """Long string of punctuation/noise produces a low score despite many characters."""
        noisy_blocks = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="... --- ... !!! ??? ;;; ::: ~~~",
                confidence=0.45,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=200, height=20),
            )
        ]
        clean_blocks = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Cộng hòa Xã hội Chủ nghĩa",
                confidence=0.92,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=200, height=20),
            )
        ]
        score_noisy = compute_pass_quality_score(noisy_blocks)
        score_clean = compute_pass_quality_score(clean_blocks)

        assert score_clean > score_noisy
        # Noisy score should be strictly below 0.3
        assert score_noisy < 0.3

    def test_high_confidence_useful_text_scores_highest(self):
        blocks = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Doc lap - Tu do - Hanh phuc",
                confidence=0.95,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=200, height=20),
            )
        ]
        score = compute_pass_quality_score(blocks)
        assert score > 0.75

    def test_avoids_picking_solely_on_longer_noisy_text(self):
        """Pass 2 has more characters but lower confidence and lower useful content."""
        pass1_clean = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Hóa đơn giá trị gia tăng",
                confidence=0.91,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=200, height=20),
            )
        ]
        pass2_noisy_longer = [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Hóa đơn giá trị gia tăng |||||||||| ......... &&&&&&& ^^^^^",
                confidence=0.55,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=300, height=20),
            )
        ]
        score1 = compute_pass_quality_score(pass1_clean)
        score2 = compute_pass_quality_score(pass2_noisy_longer)

        assert score1 > score2, "Clean higher-confidence text must beat noisy longer text"


class TestAdaptiveFallbackTriggerAndBounds:
    """Tests execution bounds, fallback trigger rules, and pass limits."""

    @pytest.mark.asyncio
    async def test_fallback_not_triggered_when_pass1_is_high_quality(self):
        """When pass 1 achieves high confidence and valid text, fallback is never executed."""
        call_count = {"default": 0, "fallback": 0}

        class CountingPreprocessor(PreprocessorPort):
            def preprocess_page(self, page_image, page_number):
                call_count["default"] += 1
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale"],
                    inverse_transform=None,
                )

            def preprocess_page_fallback(self, page_image, page_number):
                call_count["fallback"] += 1
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale", "fallback_upscale"],
                    inverse_transform=None,
                )

        # Engine returning high confidence text
        def mock_engine(img):
            return [
                [
                    [[10.0, 10.0], [200.0, 10.0], [200.0, 30.0], [10.0, 30.0]],
                    ("Cong hoa Xa hoi Chu nghia Viet Nam", 0.94),
                ]
            ]

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(),
            preprocessor=CountingPreprocessor(),
            ocr_instance_map={"vi": mock_engine},
            fallback_enabled=True,
        )

        doc = _make_dummy_loaded_doc()
        result = await adapter.extract(doc, ExtractionOptions(language="vi"))

        assert call_count["default"] == 1
        assert call_count["fallback"] == 0
        assert len(result.blocks) == 1
        assert result.blocks[0].confidence == 0.94
        # Preprocessing record should reflect only default pass
        assert result.preprocessing[0].steps == ["grayscale"]

    @pytest.mark.asyncio
    async def test_fallback_triggered_when_pass1_has_zero_blocks(self):
        """When pass 1 produces 0 blocks, fallback is triggered and bounded to 1 fallback pass."""
        inference_calls = 0

        def mock_engine(img):
            nonlocal inference_calls
            inference_calls += 1
            if inference_calls == 1:
                # Pass 1: empty detections
                return []
            # Pass 2 (fallback): successfully detects text
            return [
                [
                    [[20.0, 20.0], [220.0, 20.0], [220.0, 40.0], [20.0, 40.0]],
                    ("Van ban phap quy", 0.88),
                ]
            ]

        fallback_called = False

        class TriggerPreprocessor(PreprocessorPort):
            def preprocess_page(self, page_image, page_number):
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale"],
                    inverse_transform=None,
                )

            def preprocess_page_fallback(self, page_image, page_number):
                nonlocal fallback_called
                fallback_called = True
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale", "fallback_upscale"],
                    inverse_transform=None,
                )

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(),
            preprocessor=TriggerPreprocessor(),
            ocr_instance_map={"vi": mock_engine},
            fallback_enabled=True,
        )

        doc = _make_dummy_loaded_doc()
        result = await adapter.extract(doc, ExtractionOptions(language="vi"))

        assert fallback_called is True
        assert inference_calls == 2, "Must run exactly 2 inference passes (pass 1 + 1 fallback)"
        assert len(result.blocks) == 1
        assert result.blocks[0].text == "Van ban phap quy"
        assert "fallback_upscale" in result.preprocessing[0].steps

    @pytest.mark.asyncio
    async def test_fallback_strictly_bounded_to_max_passes_on_blank_page(self):
        """Even on a genuinely blank document, total passes never exceeds 2."""
        inference_calls = 0

        def mock_engine(img):
            nonlocal inference_calls
            inference_calls += 1
            return []  # Both passes return empty

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(),
            preprocessor=None,  # Uses default OpenCvPreprocessorAdapter
            ocr_instance_map={"vi": mock_engine},
            fallback_enabled=True,
        )

        doc = _make_dummy_loaded_doc()
        result = await adapter.extract(doc, ExtractionOptions(language="vi"))

        assert inference_calls == 2, "Blank page must trigger at most 1 fallback pass (2 total)"
        assert len(result.blocks) == 0
        assert any(w.code == "BLANK_PAGE" for w in result.warnings)

    @pytest.mark.asyncio
    async def test_fallback_selection_prefers_better_confidence_pass(self):
        """When pass 1 has low confidence (0.40) and fallback has high (0.89), fallback is selected."""
        inference_calls = 0

        def mock_engine(img):
            nonlocal inference_calls
            inference_calls += 1
            if inference_calls == 1:
                return [
                    [
                        [[10.0, 10.0], [100.0, 10.0], [100.0, 30.0], [10.0, 30.0]],
                        ("fuzzy blurry text", 0.40),
                    ]
                ]
            return [
                [
                    [[10.0, 10.0], [100.0, 10.0], [100.0, 30.0], [10.0, 30.0]],
                    ("clear sharp text", 0.89),
                ]
            ]

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(),
            ocr_instance_map={"en": mock_engine},
            fallback_enabled=True,
        )

        doc = _make_dummy_loaded_doc()
        result = await adapter.extract(doc, ExtractionOptions(language="en"))

        assert result.blocks[0].text == "clear sharp text"
        assert result.blocks[0].confidence == 0.89

    @pytest.mark.asyncio
    async def test_fallback_preserves_canonical_coordinates_with_upscale(self):
        """When fallback upscales 2x, bounding box coordinates returned are in canonical page pixels."""
        canonical_w = 800
        canonical_h = 1000
        scale = 2.0

        # Preprocessor that simulates 2x upscale in fallback
        class UpscalingPreprocessor(PreprocessorPort):
            def preprocess_page(self, page_image, page_number):
                # Pass 1: low confidence triggers fallback
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale"],
                    inverse_transform=None,
                )

            def preprocess_page_fallback(self, page_image, page_number):
                inv = InverseCoordinateTransform(
                    scale_x=scale,
                    scale_y=scale,
                    canonical_width=canonical_w,
                    canonical_height=canonical_h,
                )
                upscaled_img = np.full((int(canonical_h * scale), int(canonical_w * scale)), 255, dtype=np.uint8)
                return PreprocessingResult(
                    page=page_number,
                    processed_image=upscaled_img,
                    steps_applied=["grayscale", "fallback_upscale"],
                    inverse_transform=inv,
                )

        # Engine returns coordinates in upscaled space [200, 300, 600, 380]
        # In canonical space, this should map to [100, 150, 200, 40]
        def mock_engine(img):
            if img.shape[0] == canonical_h:
                # Pass 1: low confidence
                return [
                    [
                        [[100.0, 150.0], [300.0, 150.0], [300.0, 190.0], [100.0, 190.0]],
                        ("faint text", 0.42),
                    ]
                ]
            else:
                # Pass 2: upscale 2x space
                return [
                    [
                        [[200.0, 300.0], [600.0, 300.0], [600.0, 380.0], [200.0, 380.0]],
                        ("canonical sharp text", 0.93),
                    ]
                ]

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(width=canonical_w, height=canonical_h),
            preprocessor=UpscalingPreprocessor(),
            ocr_instance_map={"en": mock_engine},
            fallback_enabled=True,
        )

        doc = _make_dummy_loaded_doc(width=canonical_w, height=canonical_h)
        result = await adapter.extract(doc, ExtractionOptions(language="en"))

        assert len(result.blocks) == 1
        block = result.blocks[0]
        assert block.text == "canonical sharp text"

        # Check that coordinates are inverted back from 2x upscaled space to canonical space
        assert abs(block.boundingBox.x - 100.0) <= 1.0
        assert abs(block.boundingBox.y - 150.0) <= 1.0
        assert abs(block.boundingBox.width - 200.0) <= 1.0
        assert abs(block.boundingBox.height - 40.0) <= 1.0

        # Boundary assertions: strictly within canonical page dimensions
        assert block.boundingBox.x + block.boundingBox.width <= canonical_w
        assert block.boundingBox.y + block.boundingBox.height <= canonical_h
    @pytest.mark.asyncio
    async def test_fallback_not_triggered_when_multi_block_page_has_single_low_confidence_block_but_good_average(
        self,
    ):
        """A page with multiple blocks where only one block has low confidence but average confidence is high must not run fallback."""
        call_count = {"default": 0, "fallback": 0}

        class CountingPreprocessor(PreprocessorPort):
            def preprocess_page(self, page_image, page_number):
                call_count["default"] += 1
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale"],
                    inverse_transform=None,
                )

            def preprocess_page_fallback(self, page_image, page_number):
                call_count["fallback"] += 1
                return PreprocessingResult(
                    page=page_number,
                    processed_image=page_image,
                    steps_applied=["grayscale", "fallback_upscale"],
                    inverse_transform=None,
                )

        # 4 blocks: 3 high confidence, 1 low confidence (<0.50), average > 0.80
        def mock_engine(img):
            return [
                [
                    [[10.0, 10.0], [200.0, 10.0], [200.0, 30.0], [10.0, 30.0]],
                    ("Cong hoa Xa hoi Chu nghia Viet Nam", 0.95),
                ],
                [
                    [[10.0, 35.0], [200.0, 35.0], [200.0, 55.0], [10.0, 55.0]],
                    ("Doc lap Tu do Hanh phuc", 0.94),
                ],
                [
                    [[10.0, 60.0], [200.0, 60.0], [200.0, 80.0], [10.0, 80.0]],
                    ("Hoa don gia tri gia tang", 0.92),
                ],
                [
                    [[10.0, 85.0], [100.0, 85.0], [100.0, 105.0], [10.0, 105.0]],
                    ("ky hieu", 0.42),
                ],
            ]

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=MockPdfRenderer(),
            preprocessor=CountingPreprocessor(),
            ocr_instance_map={"vi": mock_engine},
            fallback_enabled=True,
            low_confidence_threshold=0.50,
        )

        doc = _make_dummy_loaded_doc()
        result = await adapter.extract(doc, ExtractionOptions(language="vi"))

        assert call_count["default"] == 1
        assert call_count["fallback"] == 0, (
            "Fallback must not trigger when average confidence is good despite one weak block"
        )
        assert len(result.blocks) == 4
        assert result.preprocessing[0].steps == ["grayscale"]
        # Warning should still be recorded for the individual low-confidence block
        assert any(
            w.code == "LOW_CONFIDENCE" and w.blockId == "p1-b4"
            for w in result.warnings
        )
