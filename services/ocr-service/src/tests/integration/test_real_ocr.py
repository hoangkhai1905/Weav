#!/usr/bin/env python3
"""Integration tests for real document OCR extraction (PNG, JPEG, WEBP, and multi-page PDF).

Requirements:
- Tests MUST NOT download models from the Internet.
- Skips cleanly when local runtime, model weights, or test corpus are absent.
- Does NOT hardcode exact text, exact pages, 98.4% confidence, or 850ms duration.
- Does NOT use exact float equality snapshots on recognition scores.
- Evaluates text recognition accuracy using Character Error Rate (CER) with tolerance.
"""

from __future__ import annotations

import json
import os
import unicodedata
from pathlib import Path
from typing import Any, ClassVar

import pytest

from src.domain.ports.ocr_engine_port import ExtractionOptions
from src.infrastructure.engines.paddle_ocr_engine_adapter import (
    PaddleOcrEngineAdapter,
)
from src.infrastructure.files.document_loader import DocumentLoader
from src.infrastructure.processors.opencv_preprocessor_adapter import (
    OpenCvPreprocessorAdapter,
)
from src.infrastructure.processors.pdf_renderer import PdfRenderer

# Optional local integration corpus and an explicit offline model manifest.
CORPUS_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "corpus"
MODEL_MANIFEST_ENV = "WEAV_OCR_MODEL_MANIFEST"

# Acceptance CER tolerance (e.g. <= 15% CER for clean printed documents)
MAX_ACCEPTABLE_CER = 0.15


def calculate_cer(reference: str, hypothesis: str) -> float:
    """Calculate Character Error Rate (CER) between normalized reference and hypothesis text."""
    ref = unicodedata.normalize("NFC", reference).strip()
    hyp = unicodedata.normalize("NFC", hypothesis).strip()

    if not ref:
        return 0.0 if not hyp else 1.0

    # Levenshtein distance matrix
    d = [[0] * (len(hyp) + 1) for _ in range(len(ref) + 1)]
    for i in range(len(ref) + 1):
        d[i][0] = i
    for j in range(len(hyp) + 1):
        d[0][j] = j

    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(
                d[i - 1][j] + 1,  # deletion
                d[i][j - 1] + 1,  # insertion
                d[i - 1][j - 1] + cost,  # substitution
            )

    return d[len(ref)][len(hyp)] / float(len(ref))


def calculate_wer(reference: str, hypothesis: str) -> float:
    """Calculate Word Error Rate (WER) between normalized reference and hypothesis text."""
    ref_norm = unicodedata.normalize("NFC", reference).strip()
    hyp_norm = unicodedata.normalize("NFC", hypothesis).strip()

    ref_words = ref_norm.split()
    hyp_words = hyp_norm.split()

    if not ref_words:
        return 0.0 if not hyp_words else 1.0

    d = [[0] * (len(hyp_words) + 1) for _ in range(len(ref_words) + 1)]
    for i in range(len(ref_words) + 1):
        d[i][0] = i
    for j in range(len(hyp_words) + 1):
        d[0][j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            cost = 0 if ref_words[i - 1] == hyp_words[j - 1] else 1
            d[i][j] = min(
                d[i - 1][j] + 1,  # deletion
                d[i][j - 1] + 1,  # insertion
                d[i - 1][j - 1] + cost,  # substitution
            )

    return d[len(ref_words)][len(hyp_words)] / float(len(ref_words))


class OcrBenchmarkReport:
    """In-memory benchmark report recording per-fixture CER, WER, and size metrics."""

    records: ClassVar[list[dict[str, Any]]] = []

    @classmethod
    def record(
        cls,
        fixture: str,
        lang: str,
        cer: float,
        wer: float,
        chars: int,
        words: int,
        blocks: int,
    ) -> None:
        cls.records.append(
            {
                "fixture": fixture,
                "lang": lang,
                "cer": cer,
                "wer": wer,
                "chars": chars,
                "words": words,
                "blocks": blocks,
            }
        )
        print(
            f"\n[OCR BENCHMARK REPORT] {fixture:<25} | lang: {lang:<5} | "
            f"CER: {cer * 100:6.2f}% | WER: {wer * 100:6.2f}% | "
            f"blocks: {blocks:3d} | chars: {chars:4d} | words: {words:4d}"
        )


def _check_local_inference_prerequisites() -> dict[str, dict[str, str]]:
    """Require an explicit local model manifest so tests can never download weights."""
    try:
        import cv2  # type: ignore # noqa: F401
    except ImportError:
        pytest.skip("PENDING RUNTIME: OpenCV (cv2) not installed in local environment")

    try:
        import paddle  # type: ignore # noqa: F401
        import paddleocr  # type: ignore # noqa: F401
    except ImportError as exc:
        pytest.skip(f"PENDING RUNTIME: PaddleOCR / PaddlePaddle not installed ({exc})")

    manifest_value = os.environ.get(MODEL_MANIFEST_ENV)
    if not manifest_value:
        pytest.skip(
            f"PENDING RUNTIME: set {MODEL_MANIFEST_ENV} to a local, non-PII model manifest"
        )

    manifest_path = Path(manifest_value).expanduser()
    if not manifest_path.is_file():
        pytest.skip(f"OFFLINE SAFETY: model manifest '{manifest_path}' is not a file")

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        pytest.skip(f"OFFLINE SAFETY: invalid local model manifest ({exc})")

    models = manifest.get("models") if isinstance(manifest, dict) else None
    if not isinstance(models, dict):
        pytest.skip("OFFLINE SAFETY: model manifest must contain a 'models' object")

    resolved: dict[str, dict[str, str]] = {}
    for lang in ("vi", "en"):
        config = models.get(lang)
        if not isinstance(config, dict):
            pytest.skip(f"OFFLINE SAFETY: model manifest has no '{lang}' configuration")
        resolved_config: dict[str, str] = {}
        for key in (
            "text_detection_model_name",
            "text_detection_model_dir",
            "text_recognition_model_name",
            "text_recognition_model_dir",
        ):
            value = config.get(key)
            if not isinstance(value, str):
                pytest.skip(f"OFFLINE SAFETY: '{lang}' is missing '{key}'")
            if key.endswith("_dir"):
                model_path = Path(value).expanduser()
                if model_path.is_dir():
                    resolved_path = model_path
                elif os.environ.get("OCR_MODEL_ROOT"):
                    clean_rel = value.lstrip("/\\")
                    if clean_rel.startswith(("models/", "models\\")):
                        clean_rel = clean_rel[7:].lstrip("/\\")
                    resolved_path = (
                        Path(os.environ["OCR_MODEL_ROOT"]).expanduser() / clean_rel
                    ).resolve()
                elif not model_path.is_absolute():
                    resolved_path = (manifest_path.parent / model_path).resolve()
                else:
                    resolved_path = model_path

                if not resolved_path.is_dir():
                    pytest.skip(
                        f"OFFLINE SAFETY: local model directory '{resolved_path}' is missing"
                    )
                resolved_config[key] = str(resolved_path)
            else:
                resolved_config[key] = value
        resolved[lang] = resolved_config
    return resolved


def _offline_engine_factory(model_configs: dict[str, dict[str, str]]):
    """Build PaddleOCR with caller-supplied local model directories only."""

    def create(paddle_lang: str):
        from paddleocr import PaddleOCR

        config = model_configs[paddle_lang]
        return PaddleOCR(
            text_detection_model_name=config["text_detection_model_name"],
            text_detection_model_dir=config["text_detection_model_dir"],
            text_recognition_model_name=config["text_recognition_model_name"],
            text_recognition_model_dir=config["text_recognition_model_dir"],
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            enable_mkldnn=False,
        )

    return create


class TestRealOcrInference:
    """Integration suite for real document extraction across supported media types."""

    @pytest.fixture(autouse=True)
    def require_prerequisites(self):
        self.model_configs = _check_local_inference_prerequisites()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "filename,lang,min_chars",
        [
            ("sample_vietnamese.png", "vi", 20),
            ("sample_english.jpg", "en", 20),
            ("sample_bilingual.webp", "vi+en", 30),
        ],
    )
    async def test_real_raster_image_ocr_with_cer_tolerance(
        self,
        filename: str,
        lang: str,
        min_chars: int,
    ):
        """Verify real raster images produce valid text within CER tolerance without hardcoding."""
        corpus_file = CORPUS_DIR / filename
        gt_file = CORPUS_DIR / f"{filename}.gt.txt"

        if not corpus_file.exists() or not gt_file.exists():
            pytest.skip(
                f"Local test corpus file '{filename}' or ground truth not found in {CORPUS_DIR}"
            )

        ground_truth = gt_file.read_text(encoding="utf-8")

        doc_loader = DocumentLoader()
        loaded_doc = doc_loader.validate_and_load(corpus_file, client_filename=filename)

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=PdfRenderer(),
            preprocessor=OpenCvPreprocessorAdapter(),
            ocr_factory=_offline_engine_factory(self.model_configs),
        )

        options = ExtractionOptions(language=lang, detect_tables=False)  # type: ignore[arg-type]
        result = await adapter.extract(loaded_doc, options)

        # Assertions without hardcoded scores or timings
        assert result.raw_text is not None
        assert len(result.raw_text.strip()) >= min_chars
        assert len(result.blocks) > 0

        # No exact float snapshotting: assert score stays strictly within valid probability bounds
        for block in result.blocks:
            assert 0.0 <= block.confidence <= 1.0
            # Ensure coordinates are within page bounds
            assert block.boundingBox.x >= 0.0
            assert block.boundingBox.y >= 0.0
            assert block.boundingBox.width > 0.0
            assert block.boundingBox.height > 0.0

        # Quality check via CER and WER
        cer = calculate_cer(ground_truth, result.raw_text)
        wer = calculate_wer(ground_truth, result.raw_text)
        OcrBenchmarkReport.record(
            fixture=filename,
            lang=lang,
            cer=cer,
            wer=wer,
            chars=len(result.raw_text.strip()),
            words=len(result.raw_text.strip().split()),
            blocks=len(result.blocks),
        )
        assert cer <= MAX_ACCEPTABLE_CER, (
            f"Character Error Rate ({cer:.3f}) exceeded tolerance ({MAX_ACCEPTABLE_CER}) for {filename}"
        )

    @pytest.mark.asyncio
    async def test_real_two_page_pdf_bilingual_extraction(self):
        """Verify 2-page bilingual PDF streams correctly and separates pages with \n\f\n."""
        pdf_file = CORPUS_DIR / "two_page_bilingual.pdf"
        gt_page1_file = CORPUS_DIR / "two_page_bilingual_p1.gt.txt"
        gt_page2_file = CORPUS_DIR / "two_page_bilingual_p2.gt.txt"

        if not pdf_file.exists():
            pytest.skip(
                f"2-page PDF corpus file '{pdf_file}' not present in local fixtures"
            )

        doc_loader = DocumentLoader()
        loaded_doc = doc_loader.validate_and_load(
            pdf_file, client_filename="two_page.pdf"
        )
        assert loaded_doc.pages == 2

        adapter = PaddleOcrEngineAdapter(
            pdf_renderer=PdfRenderer(),
            preprocessor=OpenCvPreprocessorAdapter(),
            ocr_factory=_offline_engine_factory(self.model_configs),
        )

        options = ExtractionOptions(language="vi+en", detect_tables=False)
        result = await adapter.extract(loaded_doc, options)

        assert result.raw_text is not None
        # Verify page separator presence
        assert "\n\f\n" in result.raw_text

        # Verify blocks exist for both page 1 and page 2
        pages_found = {b.page for b in result.blocks}
        assert pages_found == {1, 2}

        # If ground truth files exist, check CER and WER
        if gt_page1_file.exists() and gt_page2_file.exists():
            p1_expected = gt_page1_file.read_text(encoding="utf-8")
            p2_expected = gt_page2_file.read_text(encoding="utf-8")
            combined_expected = f"{p1_expected.strip()}\n\f\n{p2_expected.strip()}"

            cer = calculate_cer(combined_expected, result.raw_text)
            wer = calculate_wer(combined_expected, result.raw_text)
            OcrBenchmarkReport.record(
                fixture="two_page_bilingual.pdf",
                lang="vi+en",
                cer=cer,
                wer=wer,
                chars=len(result.raw_text.strip()),
                words=len(result.raw_text.strip().split()),
                blocks=len(result.blocks),
            )
            assert cer <= MAX_ACCEPTABLE_CER

    def test_cer_calculation_logic(self):
        """Unit verification of the CER and WER calculation helpers."""
        assert calculate_cer("abc", "abc") == 0.0
        assert calculate_cer("abc", "ab") == pytest.approx(1.0 / 3.0)
        assert calculate_cer("Tiếng Việt", "Tiếng Việt") == 0.0
        assert calculate_cer("abc", "xyz") == 1.0

        assert calculate_wer("hello world", "hello world") == 0.0
        assert calculate_wer("hello world", "hello") == 0.5
        assert calculate_wer("hello world", "hello there world") == 0.5
        assert calculate_wer("Tiếng Việt Nam", "Tiếng Việt") == pytest.approx(1.0 / 3.0)
        assert calculate_wer("hello world", "foo bar") == 1.0
        assert calculate_wer("", "") == 0.0
        assert calculate_wer("", "word") == 1.0
        assert calculate_wer("word", "") == 1.0
