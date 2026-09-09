#!/usr/bin/env python3
"""PaddleOCR 3.x engine adapter conforming to OcrEnginePort.

Guarantees:
- Safe language mapping: WEAV 'vi' and 'vi+en' map to the Vietnamese-capable profile key 'vi' (never 'latin' and never passed verbatim).
- Streaming page-at-a-time rendering and bounded memory execution.
- Measured OpenCV preprocessing with recorded steps and inverse coordinate transform.
- Canonical bounding box and polygon normalization (Unicode NFC, page coordinate clamping).
- Robust reading-order sorting and sequential 0-based ordering.
- Generation of non-fatal warnings (BLANK_PAGE, LOW_CONFIDENCE).
- Strict enforcement of output caps (max 20,000 blocks, max 1 MiB rawText).
- Fully testable with injected test doubles without network or model downloads.
- Optional offline model manifest support via WEAV_OCR_MODEL_MANIFEST environment variable.
"""

from __future__ import annotations

import os
import unicodedata
from collections.abc import Callable, Mapping
from numbers import Real
from pathlib import Path
from typing import Any

import numpy as np

from src.domain.errors import (
    InternalError,
    InvalidOptionsError,
    ModelNotReadyError,
    OutputLimitExceededError,
)
from src.domain.models.ocr_request import LanguageOption
from src.domain.models.ocr_result import (
    BoundingBox,
    ExtractionWarning,
    PreprocessingRecord,
    TextBlock,
    normalize_raw_text,
)
from src.domain.ports.document_loader_port import LoadedDocument
from src.domain.ports.ocr_engine_port import (
    EngineOcrResult,
    ExtractionOptions,
    OcrEnginePort,
)
from src.domain.ports.preprocessor_port import PreprocessorPort
from src.infrastructure.engines.model_manifest import (
    configured_manifest_path,
    load_model_profile,
)
from src.infrastructure.processors.opencv_preprocessor_adapter import (
    InverseCoordinateTransform,
    OpenCvPreprocessorAdapter,
)
from src.infrastructure.processors.pdf_renderer import PdfRenderer

# Maximum output limits defined in Spec Section 4
MAX_BLOCKS_LIMIT = 20000
MAX_RAW_TEXT_BYTES = 1048576  # 1 MiB UTF-8 payload cap
DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.50
MODEL_MANIFEST_ENV = "WEAV_OCR_MODEL_MANIFEST"
OCR_MODEL_ROOT_ENV = "OCR_MODEL_ROOT"


def compute_pass_quality_score(blocks: list[TextBlock]) -> float:
    """Calculate deterministic quality score in [0.0, 1.0] for an extraction candidate.

    Weighted average confidence + useful alphanumeric text content;
    penalizes hallucinated punctuation noise and avoids selecting solely on text length.
    """
    if not blocks:
        return 0.0

    total_chars = 0
    alnum_chars = 0
    weighted_conf_sum = 0.0

    for block in blocks:
        text = block.text.strip()
        non_ws = sum(1 for ch in text if not ch.isspace())
        if non_ws == 0:
            continue
        total_chars += non_ws
        alnum = sum(1 for ch in text if ch.isalnum())
        alnum_chars += alnum
        weighted_conf_sum += block.confidence * non_ws

    if total_chars == 0:
        return 0.0

    weighted_conf = weighted_conf_sum / total_chars
    alnum_ratio = alnum_chars / total_chars

    # Severe penalty for hallucinated or punctuation noise (e.g. "...---!!!")
    if alnum_ratio < 0.35:
        return max(0.0, min(1.0, weighted_conf * 0.15))

    # Useful content saturation (reaches 1.0 at ~150 alphanumeric characters)
    content_factor = min(1.0, alnum_chars / 150.0)

    # Composite deterministic score: 60% confidence, 20% alnum ratio, 20% content saturation
    raw_score = (weighted_conf * 0.60) + (alnum_ratio * 0.20) + (content_factor * 0.20)
    return max(0.0, min(1.0, round(raw_score, 4)))


def _as_python(value: Any) -> Any:
    """Convert numpy/Paddle containers into ordinary Python containers."""
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        return tolist()
    return value


def _result_value(result: Any, key: str) -> Any:
    """Read a PaddleOCR 3.x mapping-like result without assuming its concrete class."""
    try:
        if isinstance(result, Mapping):
            return result.get(key)
        getter = getattr(result, "get", None)
        if callable(getter):
            return getter(key)
        return result[key]
    except (KeyError, IndexError, TypeError, AttributeError):
        return None


def _is_sdk_result(value: Any) -> bool:
    """Return true for PaddleOCR 3.x OCRResult/dict-like objects."""
    return any(_result_value(value, key) is not None for key in ("rec_texts", "rec_scores", "rec_polys", "dt_polys"))


def _materialize_inference_result(value: Any) -> Any:
    """Materialize PaddleOCR 3.x lazy prediction iterators for normalization."""
    if isinstance(value, (list, tuple, Mapping, str, bytes)):
        return value
    if hasattr(value, "__iter__"):
        return list(value)
    return value


def _is_numeric(value: Any) -> bool:
    return isinstance(value, Real) or (
        not isinstance(value, (list, tuple, dict))
        and _can_float(value)
    )


def _can_float(value: Any) -> bool:
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def _is_point(value: Any) -> bool:
    value = _as_python(value)
    return isinstance(value, (list, tuple)) and len(value) >= 2 and _is_numeric(value[0]) and _is_numeric(value[1])


def _is_polygon(value: Any) -> bool:
    value = _as_python(value)
    return isinstance(value, (list, tuple)) and len(value) >= 4 and all(_is_point(point) for point in value)


def _sdk_detection_entries(raw_detections: Any) -> list[list[Any]] | None:
    """Extract PaddleOCR 3.x OCRResult fields into legacy-like detection entries."""
    candidate = raw_detections
    if isinstance(raw_detections, (list, tuple)):
        sdk_results = [item for item in raw_detections if _is_sdk_result(item)]
        if sdk_results:
            candidate = sdk_results[0]

    if not _is_sdk_result(candidate):
        return None

    polygons = _result_value(candidate, "rec_polys")
    if polygons is None:
        polygons = _result_value(candidate, "dt_polys")
    polygons = _as_python(polygons)

    if polygons is None:
        boxes = _as_python(_result_value(candidate, "rec_boxes"))
        if boxes is None:
            return []
        if boxes and _is_numeric(boxes[0]):
            boxes = [boxes]
        polygons = []
        for box in boxes:
            if isinstance(box, (list, tuple)) and len(box) >= 4:
                x1, y1, x2, y2 = (float(box[i]) for i in range(4))
                polygons.append([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])

    if _is_polygon(polygons):
        polygons = [polygons]
    polygons = [_as_python(polygon) for polygon in list(polygons or [])]

    texts = _as_python(_result_value(candidate, "rec_texts")) or []
    scores = _as_python(_result_value(candidate, "rec_scores")) or []
    if isinstance(texts, str):
        texts = [texts]
    if not isinstance(scores, (list, tuple)):
        scores = [scores]

    entries: list[list[Any]] = []
    for index, polygon in enumerate(polygons):
        text = texts[index] if index < len(texts) else ""
        score = scores[index] if index < len(scores) else 0.0
        entries.append([polygon, (text, score)])
    return entries


def _legacy_detection_entries(raw_detections: Any) -> list[Any]:
    """Normalize supported pre-3.x test/double shapes without confusing page wrappers."""
    if raw_detections is None:
        return []

    entries = raw_detections
    if not isinstance(entries, (list, tuple)):
        return []

    if _is_legacy_entry(entries):
        return [entries]

    if len(entries) == 1 and isinstance(entries[0], (list, tuple)):
        first = entries[0]
        if _is_legacy_entry(first):
            return list(entries)
        if len(first) == 1 and _is_legacy_entry(first[0]):
            return list(first)

    return list(entries)


def _is_legacy_entry(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and _is_polygon(value[0])
    )


def resolve_paddle_language(language: LanguageOption) -> tuple[str, str]:
    """Map WEAV API language options to PaddleOCR engine language string and resolved name.

    Returns:
        (paddle_lang_code, resolved_language_name)
    """
    if language == "vi":
        return "vi", "vi"
    elif language == "en":
        return "en", "en"
    elif language == "vi+en":
        # 'vi+en' must NEVER be passed verbatim to PaddleOCR.
        # Direct inference with 'latin' recognizers loses Vietnamese diacritics
        # because the 'latin' character set lacks the required Vietnamese diacritic profile.
        # Therefore, 'vi+en' resolves to the Vietnamese-capable profile key 'vi'.
        return "vi", "vi"
    raise InvalidOptionsError(f"Unsupported language option '{language}'")


class PaddleOcrEngineAdapter(OcrEnginePort):
    """Adapter executing OCR extraction via PaddleOCR SDK 3.x."""

    def __init__(
        self,
        pdf_renderer: PdfRenderer | None = None,
        preprocessor: PreprocessorPort | None = None,
        ocr_instance_map: dict[str, Any] | None = None,
        ocr_factory: Callable[[str], Any] | None = None,
        engine_name: str = "paddleocr",
        engine_version: str = "3.7.0",
        model_revision: str = "approved-model-manifest-id",
        low_confidence_threshold: float = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
        manifest_path: str | Path | None = None,
        model_root: str | Path | None = None,
        fallback_enabled: bool = True,
    ) -> None:
        self.pdf_renderer = pdf_renderer or PdfRenderer()
        self.preprocessor = preprocessor or OpenCvPreprocessorAdapter()
        self.engine_name = engine_name
        self.engine_version = engine_version
        self.model_revision = model_revision
        self.low_confidence_threshold = low_confidence_threshold
        self.fallback_enabled = fallback_enabled
        self._manifest_path = manifest_path
        if model_root is not None and str(model_root).strip():
            self._model_root = Path(model_root).expanduser()
        elif os.environ.get("OCR_MODEL_ROOT", "").strip():
            self._model_root = Path(os.environ["OCR_MODEL_ROOT"]).expanduser()
        else:
            self._model_root = None

        self._ocr_instances: dict[str, Any] = dict(ocr_instance_map or {})
        self._ocr_factory = ocr_factory

    def _should_trigger_fallback(self, blocks: list[TextBlock]) -> bool:
        """Determine if page results warrant an adaptive fallback pass.

        Conservative trigger policy:
        - Fallback if no blocks detected (zero blocks / potentially blank page).
        - Fallback if total useful text content is very short (< 3 alphanumeric characters).
        - Fallback if average confidence across the entire page is below low_confidence_threshold.
        - Does NOT trigger fallback merely because a single block has low confidence.
        """
        if not blocks:
            return True
        total_alnum = sum(sum(1 for ch in b.text if ch.isalnum()) for b in blocks)
        if total_alnum < 3:
            return True
        avg_confidence = sum(b.confidence for b in blocks) / len(blocks)
        return avg_confidence < self.low_confidence_threshold


    async def extract(
        self,
        document: LoadedDocument,
        options: ExtractionOptions,
    ) -> EngineOcrResult:
        """Run OCR extraction over loaded document adhering to boundaries and output caps."""
        paddle_lang, resolved_lang = resolve_paddle_language(options.language)
        ocr_engine = self._get_or_create_engine(paddle_lang)

        all_blocks: list[TextBlock] = []
        all_preprocessing: list[PreprocessingRecord] = []
        all_warnings: list[ExtractionWarning] = []
        current_order = 0

        # Stream document pages one by one (bounded memory)
        page_stream = self.pdf_renderer.render_document(document)

        for rendered_page in page_stream:
            page_num = rendered_page.page_number
            # The renderer is authoritative for canonical pixel geometry after
            # EXIF/PDF rotation or a safe DPI adjustment.
            canonical_w = rendered_page.width
            canonical_h = rendered_page.height

            # 1. Default pass: measured image preprocessing & inference
            proc_result_1 = self.preprocessor.preprocess_page(
                rendered_page.image,
                page_number=page_num,
            )
            raw_detections_1 = self._run_engine_inference(ocr_engine, proc_result_1.processed_image)
            blocks_1, warnings_1 = self._normalize_page_detections(
                raw_detections=raw_detections_1,
                page_num=page_num,
                canonical_w=canonical_w,
                canonical_h=canonical_h,
                inverse_transform=proc_result_1.inverse_transform,
            )

            chosen_blocks = blocks_1
            chosen_warnings = warnings_1
            chosen_steps = proc_result_1.steps_applied

            # 2. Adaptive fallback pass (strictly bounded: max 1 fallback pass per page)
            if self.fallback_enabled and self._should_trigger_fallback(blocks_1):
                proc_result_2 = self.preprocessor.preprocess_page_fallback(
                    rendered_page.image,
                    page_number=page_num,
                )
                raw_detections_2 = self._run_engine_inference(ocr_engine, proc_result_2.processed_image)
                blocks_2, warnings_2 = self._normalize_page_detections(
                    raw_detections=raw_detections_2,
                    page_num=page_num,
                    canonical_w=canonical_w,
                    canonical_h=canonical_h,
                    inverse_transform=proc_result_2.inverse_transform,
                )

                score_1 = compute_pass_quality_score(blocks_1)
                score_2 = compute_pass_quality_score(blocks_2)

                if score_2 > score_1:
                    chosen_blocks = blocks_2
                    chosen_warnings = warnings_2
                    chosen_steps = proc_result_2.steps_applied

            all_preprocessing.append(
                PreprocessingRecord(page=page_num, steps=chosen_steps)
            )
            all_warnings.extend(chosen_warnings)

            # 3. Sort blocks in canonical reading order (top-to-bottom, left-to-right)
            sorted_page_blocks = self._sort_reading_order(chosen_blocks)

            # 5. Assign sequential global order and IDs
            for idx, block in enumerate(sorted_page_blocks):
                block_id = f"p{page_num}-b{idx + 1}"
                updated_block = TextBlock(
                    id=block_id,
                    order=current_order,
                    text=block.text,
                    confidence=block.confidence,
                    page=page_num,
                    boundingBox=block.boundingBox,
                    polygon=block.polygon,
                )
                all_blocks.append(updated_block)
                current_order += 1

                # Check block confidence warning
                if updated_block.confidence < self.low_confidence_threshold:
                    all_warnings.append(
                        ExtractionWarning(
                            code="LOW_CONFIDENCE",
                            message=f"Low recognition confidence ({updated_block.confidence:.2f}) on page {page_num}",
                            page=page_num,
                            blockId=block_id,
                        )
                    )

        # Whole-document blank check
        if not all_blocks:
            all_warnings.append(
                ExtractionWarning(
                    code="BLANK_PAGE",
                    message="Document contains no detected text",
                )
            )

        # Enforce output caps
        if len(all_blocks) > MAX_BLOCKS_LIMIT:
            raise OutputLimitExceededError(
                f"Extracted blocks count ({len(all_blocks)}) exceeds limit of {MAX_BLOCKS_LIMIT}"
            )

        raw_text = normalize_raw_text(all_blocks, document.pages)
        if len(raw_text.encode("utf-8")) > MAX_RAW_TEXT_BYTES:
            raise OutputLimitExceededError(
                f"Extracted rawText exceeds limit of {MAX_RAW_TEXT_BYTES} UTF-8 bytes"
            )

        return EngineOcrResult(
            blocks=all_blocks,
            raw_text=raw_text,
            resolved_language=resolved_lang,
            engine_name=self.engine_name,
            engine_version=self.engine_version,
            model_revision=self.model_revision,
            preprocessing=all_preprocessing,
            warnings=all_warnings,
        )

    def _normalize_page_detections(
        self,
        raw_detections: Any,
        page_num: int,
        canonical_w: int,
        canonical_h: int,
        inverse_transform: Any | None,
    ) -> tuple[list[TextBlock], list[ExtractionWarning]]:
        """Normalize raw engine bounding coordinates, text Unicode NFC, and confidence scores."""
        blocks: list[TextBlock] = []
        warnings: list[ExtractionWarning] = []

        if not raw_detections or raw_detections == [None]:
            warnings.append(
                ExtractionWarning(
                    code="BLANK_PAGE",
                    message=f"Page {page_num} contains no detected text",
                    page=page_num,
                )
            )
            return blocks, warnings

        # PaddleOCR 3.x returns a mapping-like OCRResult with rec_* arrays;
        # legacy doubles may return nested [polygon, (text, score)] entries.
        lines = _sdk_detection_entries(raw_detections)
        if lines is None:
            lines = _legacy_detection_entries(raw_detections)

        if not lines or lines == [None]:
            warnings.append(
                ExtractionWarning(
                    code="BLANK_PAGE",
                    message=f"Page {page_num} contains no detected text",
                    page=page_num,
                )
            )
            return blocks, warnings

        for entry in lines:
            if not entry or len(entry) < 2:
                continue

            raw_poly, raw_text_info = entry[0], entry[1]

            # Parse text and confidence
            if isinstance(raw_text_info, (list, tuple)):
                text_str = str(raw_text_info[0]) if len(raw_text_info) > 0 else ""
                try:
                    score = float(raw_text_info[1]) if len(raw_text_info) > 1 else 0.0
                except (TypeError, ValueError):
                    score = 0.0
            else:
                text_str = str(raw_text_info)
                score = 0.0

            # Normalize text to Unicode NFC
            text = unicodedata.normalize("NFC", text_str).strip()
            if not text:
                continue

            # Clamp score to [0.0, 1.0]
            confidence = max(0.0, min(1.0, round(score, 4)))

            # Parse polygon points: [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
            poly_points: list[list[float]] = []
            if isinstance(raw_poly, (list, tuple)):
                for pt in raw_poly:
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        poly_points.append([float(pt[0]), float(pt[1])])

            if len(poly_points) < 4:
                continue

            # Apply inverse coordinate transform back to canonical page pixels
            if isinstance(inverse_transform, InverseCoordinateTransform):
                canonical_poly = inverse_transform.transform_polygon(poly_points)
                # Compute enclosing bounding box
                xs = [p[0] for p in canonical_poly]
                ys = [p[1] for p in canonical_poly]
                bx = min(xs)
                by = min(ys)
                bw = max(xs) - bx
                bh = max(ys) - by
            else:
                canonical_poly = poly_points
                xs = [p[0] for p in poly_points]
                ys = [p[1] for p in poly_points]
                bx = min(xs)
                by = min(ys)
                bw = max(xs) - bx
                bh = max(ys) - by

            # Clamp bounding box coordinates strictly within page dimensions
            clamped_x = max(0.0, min(float(canonical_w - 1.0), bx))
            clamped_y = max(0.0, min(float(canonical_h - 1.0), by))
            clamped_w = max(1.0, min(bw, float(canonical_w) - clamped_x))
            clamped_h = max(1.0, min(bh, float(canonical_h) - clamped_y))

            bbox = BoundingBox(
                x=round(clamped_x, 2),
                y=round(clamped_y, 2),
                width=round(clamped_w, 2),
                height=round(clamped_h, 2),
            )

            # Clamp polygon points as well
            clamped_poly = [
                [
                    round(max(0.0, min(float(canonical_w), p[0])), 2),
                    round(max(0.0, min(float(canonical_h), p[1])), 2),
                ]
                for p in canonical_poly
            ]

            block = TextBlock(
                id=f"p{page_num}-temp",
                order=0,
                text=text,
                confidence=confidence,
                page=page_num,
                boundingBox=bbox,
                polygon=clamped_poly,
            )
            blocks.append(block)
            if len(blocks) > MAX_BLOCKS_LIMIT:
                raise OutputLimitExceededError(
                    f"Extracted blocks count exceeds limit of {MAX_BLOCKS_LIMIT}"
                )

        return blocks, warnings

    def _sort_reading_order(self, blocks: list[TextBlock]) -> list[TextBlock]:
        """Sort text blocks in top-to-bottom, left-to-right reading order.

        Groups blocks sharing similar vertical lines before sorting horizontally.
        """
        if not blocks:
            return []

        # Average block height used as line tolerance threshold
        avg_h = sum(b.boundingBox.height for b in blocks) / len(blocks)
        line_tolerance = max(8.0, avg_h * 0.5)

        # Sort blocks by approximate vertical band, then left-to-right
        def sort_key(b: TextBlock) -> tuple[int, float]:
            line_idx = int(b.boundingBox.y / line_tolerance)
            return (line_idx, b.boundingBox.x)

        return sorted(blocks, key=sort_key)

    def _run_engine_inference(self, ocr_engine: Any, image: Any) -> Any:
        """Call OCR engine method defensively with a Paddle-compatible image shape."""
        # OpenCV preprocessing intentionally works in grayscale, but PaddleOCR 3.x
        # expects HxWxC input even when all channels contain the same luminance data.
        # Expand only at the SDK boundary so the internal preprocessing contract and
        # geometry remain single-channel and deterministic.
        if isinstance(image, np.ndarray) and image.ndim == 2:
            image = np.repeat(image[:, :, None], 3, axis=2)

        if hasattr(ocr_engine, "predict"):
            try:
                result = ocr_engine.predict(image, return_word_box=False)
            except TypeError:
                result = ocr_engine.predict(image)
            return _materialize_inference_result(result)
        elif hasattr(ocr_engine, "ocr"):
            try:
                result = ocr_engine.ocr(image)
            except TypeError:
                # PaddleOCR 2.x compatibility for injected legacy engines.
                result = ocr_engine.ocr(image, cls=True)
            return _materialize_inference_result(result)
        elif callable(ocr_engine):
            return _materialize_inference_result(ocr_engine(image))
        raise InternalError(f"Configured OCR engine '{type(ocr_engine).__name__}' does not expose ocr() or predict()")

    def _get_or_create_engine(self, paddle_lang: str) -> Any:
        """Get pre-warmed OCR instance or instantiate via factory/manifest."""
        if paddle_lang in self._ocr_instances:
            return self._ocr_instances[paddle_lang]

        if self._ocr_factory is not None:
            instance = self._ocr_factory(paddle_lang)
            self._ocr_instances[paddle_lang] = instance
            return instance

        manifest_target = configured_manifest_path(self._manifest_path)
        if manifest_target is not None:
            config = load_model_profile(manifest_target, paddle_lang, self._model_root)

            try:
                from paddleocr import PaddleOCR
            except ImportError as exc:
                raise ModelNotReadyError(
                    f"PaddleOCR runtime is not installed or available: {exc}"
                ) from exc

            try:
                instance = PaddleOCR(
                    text_detection_model_name=config["text_detection_model_name"],
                    text_detection_model_dir=config["text_detection_model_dir"],
                    text_recognition_model_name=config["text_recognition_model_name"],
                    text_recognition_model_dir=config["text_recognition_model_dir"],
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    enable_mkldnn=False,
                )
                self._ocr_instances[paddle_lang] = instance
                return instance
            except Exception as exc:
                raise ModelNotReadyError(
                    f"Failed to initialize PaddleOCR engine for language '{paddle_lang}': {exc}"
                ) from exc

        # Default lazy initialization of PaddleOCR 3.x when manifest is absent
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise ModelNotReadyError(
                f"PaddleOCR runtime is not installed or available: {exc}"
            ) from exc

        try:
            # PaddlePaddle 3.3 CPU + the current PP-OCRv5 inference artifacts
            # can fail in the oneDNN PIR bridge. Keep the safe CPU path explicit
            # until a measured compatible oneDNN/model combination is adopted.
            instance = PaddleOCR(lang=paddle_lang, enable_mkldnn=False)
            self._ocr_instances[paddle_lang] = instance
            return instance
        except Exception as exc:
            raise ModelNotReadyError(
                f"Failed to initialize PaddleOCR engine for language '{paddle_lang}': {exc}"
            ) from exc
