#!/usr/bin/env python3
"""PaddleOCR PP-StructureV3 adapter and safe table-result normalization.

The Paddle table pipeline emits HTML and engine-specific dictionaries.  Those
objects stay inside this adapter: the application contract exposes only typed
rows/cells, canonical boxes, and source block references.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from html.parser import HTMLParser
from math import isfinite
from typing import Any

from pydantic import ValidationError

from src.domain.errors import (
    ModelNotReadyError,
    OcrDomainError,
    OutputLimitExceededError,
    TableExtractionFailedError,
)
from src.domain.models.ocr_result import BoundingBox, TableCell, TableResult, TextBlock
from src.domain.ports.document_loader_port import LoadedDocument
from src.domain.ports.table_engine_port import TableEnginePort
from src.infrastructure.processors.pdf_renderer import PdfRenderer

MAX_TABLES_LIMIT = 100
MAX_CELLS_LIMIT = 10_000


def _value(value: Any, key: str) -> Any:
    """Read a Paddle result regardless of whether it is a dict or result object."""
    try:
        if isinstance(value, Mapping):
            return value.get(key)
        getter = getattr(value, "get", None)
        if callable(getter):
            return getter(key)
        return value[key]
    except (AttributeError, IndexError, KeyError, TypeError):
        return None


def _as_list(value: Any) -> list[Any]:
    """Convert numpy/Paddle containers and lazy iterators to a list."""
    if value is None:
        return []
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        value = tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, (str, bytes, Mapping)):
        return [value]
    try:
        return list(value)
    except TypeError:
        return [value]


def _safe_int(value: Any, default: int = 1) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, parsed)


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(parsed):
        return None
    return max(0.0, min(1.0, round(parsed, 4)))


def _clean_text(value: Any) -> str:
    text = unicodedata.normalize("NFC", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class _ParsedCell:
    row_hint: int
    row_span: int
    column_span: int
    text: str


class _TableHtmlParser(HTMLParser):
    """Extract visible cell text and spans without exposing engine HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.cells: list[_ParsedCell] = []
        self._row_index = -1
        self._next_row_index = 0
        self._active: _ParsedCell | None = None
        self._text_parts: list[str] = []
        self._ignored_depth = 0

    def _flush_active(self) -> None:
        if self._active is not None:
            self._active.text = _clean_text("".join(self._text_parts))
            self.cells.append(self._active)
            self._active = None
            self._text_parts = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._flush_active()
            self._row_index = self._next_row_index
            self._next_row_index += 1
            return
        if tag in {"script", "style"}:
            self._ignored_depth += 1
            return
        if tag not in {"td", "th"}:
            return
        self._flush_active()
        attributes = {name.lower(): value for name, value in attrs}
        self._active = _ParsedCell(
            row_hint=max(0, self._row_index),
            row_span=_safe_int(attributes.get("rowspan")),
            column_span=_safe_int(attributes.get("colspan")),
            text="",
        )
        self._text_parts = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1
            return
        if tag not in {"td", "th"}:
            return
        self._flush_active()

    def handle_data(self, data: str) -> None:
        if self._active is not None and self._ignored_depth == 0:
            self._text_parts.append(data)

    def close(self) -> None:
        super().close()
        self._flush_active()


def _box_coordinates(value: Any) -> tuple[float, float, float, float] | None:
    """Read [x1,y1,x2,y2], four points, or a contract-shaped box."""
    if isinstance(value, Mapping):
        if all(key in value for key in ("x", "y", "width", "height")):
            try:
                x = float(value["x"])
                y = float(value["y"])
                return x, y, x + float(value["width"]), y + float(value["height"])
            except (TypeError, ValueError):
                return None
        for key in ("coordinate", "bbox", "box", "points"):
            candidate = value.get(key)
            if candidate is not None:
                parsed = _box_coordinates(candidate)
                if parsed is not None:
                    return parsed
        return None

    try:
        values = value.tolist() if hasattr(value, "tolist") else value
        if not isinstance(values, (list, tuple)):
            return None
        if len(values) >= 4 and all(isinstance(item, (int, float)) for item in values[:4]):
            return float(values[0]), float(values[1]), float(values[2]), float(values[3])
        points = [point for point in values if isinstance(point, (list, tuple)) and len(point) >= 2]
        if len(points) >= 2:
            xs = [float(point[0]) for point in points]
            ys = [float(point[1]) for point in points]
            return min(xs), min(ys), max(xs), max(ys)
    except (TypeError, ValueError, IndexError):
        return None
    return None


def _canonical_box(value: Any, page_width: int, page_height: int) -> BoundingBox | None:
    coordinates = _box_coordinates(value)
    if coordinates is None:
        return None
    x1, y1, x2, y2 = coordinates
    x1 = max(0.0, min(float(page_width), x1))
    y1 = max(0.0, min(float(page_height), y1))
    x2 = max(0.0, min(float(page_width), x2))
    y2 = max(0.0, min(float(page_height), y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return BoundingBox(x=x1, y=y1, width=x2 - x1, height=y2 - y1)


def _union_box(boxes: list[BoundingBox]) -> BoundingBox | None:
    if not boxes:
        return None
    x1 = min(box.x for box in boxes)
    y1 = min(box.y for box in boxes)
    x2 = max(box.x + box.width for box in boxes)
    y2 = max(box.y + box.height for box in boxes)
    return BoundingBox(x=x1, y=y1, width=x2 - x1, height=y2 - y1)


def _intersects(left: BoundingBox, right: BoundingBox) -> bool:
    return (
        max(left.x, right.x) < min(left.x + left.width, right.x + right.width)
        and max(left.y, right.y) < min(left.y + left.height, right.y + right.height)
    )


def _layout_table_boxes(page_result: Any) -> list[Any]:
    layout = _value(page_result, "layout_det_res")
    return [
        candidate
        for candidate in _as_list(_value(layout, "boxes"))
        if str(_value(candidate, "label") or "").lower() == "table"
    ]


def _place_cells(parsed_cells: list[_ParsedCell]) -> list[tuple[_ParsedCell, int, int]]:
    occupied: set[tuple[int, int]] = set()
    placed: list[tuple[_ParsedCell, int, int]] = []
    max_row = 0
    for cell in parsed_cells:
        row = max(cell.row_hint, max_row)
        column = 0
        while any((row + r, column + c) in occupied for r in range(cell.row_span) for c in range(cell.column_span)):
            column += 1
        for r in range(cell.row_span):
            for c in range(cell.column_span):
                occupied.add((row + r, column + c))
        placed.append((cell, row, column))
        max_row = max(max_row, row)
    return placed


class TableResultNormalizer:
    """Convert PP-StructureV3 page results to the frozen WEAV table schema."""

    def __init__(self, max_tables: int = MAX_TABLES_LIMIT, max_cells: int = MAX_CELLS_LIMIT) -> None:
        self.max_tables = max_tables
        self.max_cells = max_cells

    def normalize_page_result(
        self,
        page_result: Any,
        page: int,
        page_width: int,
        page_height: int,
        blocks: list[TextBlock],
    ) -> list[TableResult]:
        raw_tables = _value(page_result, "table_res_list")
        if raw_tables is None and _value(page_result, "pred_html") is not None:
            raw_tables = [page_result]
        raw_tables = _as_list(raw_tables)
        if len(raw_tables) > self.max_tables:
            raise OutputLimitExceededError(f"Detected table count exceeds limit of {self.max_tables}")

        layout_boxes = _layout_table_boxes(page_result)
        normalized: list[TableResult] = []
        cell_total = 0
        for index, raw_table in enumerate(raw_tables, start=1):
            layout_box = layout_boxes[index - 1] if index <= len(layout_boxes) else None
            table = self._normalize_table(
                raw_table,
                table_id=f"p{page}-t{index}",
                page=page,
                page_width=page_width,
                page_height=page_height,
                blocks=blocks,
                fallback_box=layout_box,
            )
            cell_total += len(table.cells)
            if cell_total > self.max_cells:
                raise OutputLimitExceededError(f"Detected cell count exceeds limit of {self.max_cells}")
            normalized.append(table)
        return normalized

    def _normalize_table(
        self,
        raw_table: Any,
        table_id: str,
        page: int,
        page_width: int,
        page_height: int,
        blocks: list[TextBlock],
        fallback_box: Any,
    ) -> TableResult:
        html = _value(raw_table, "pred_html") or ""
        parser = _TableHtmlParser()
        if html:
            try:
                parser.feed(str(html))
                parser.close()
            except Exception as exc:
                raise TableExtractionFailedError("Table structure HTML could not be parsed") from exc

        if not parser.cells:
            raise TableExtractionFailedError("Table pipeline returned a table without cells")

        placed = _place_cells(parser.cells)
        raw_cell_boxes = _as_list(_value(raw_table, "cell_box_list"))
        ocr_prediction = _value(raw_table, "table_ocr_pred")
        scores = _as_list(_value(ocr_prediction, "rec_scores"))
        cell_boxes: list[BoundingBox | None] = [
            _canonical_box(box, page_width, page_height) for box in raw_cell_boxes
        ]

        cells: list[TableCell] = []
        max_row = 0
        max_column = 0
        for index, (parsed, row, column) in enumerate(placed):
            box = cell_boxes[index] if index < len(cell_boxes) else None
            source_ids = [
                block.id
                for block in sorted(blocks, key=lambda item: item.order)
                if block.page == page and box is not None and _intersects(block.boundingBox, box)
            ]
            confidence = _safe_float(scores[index]) if index < len(scores) else None
            cells.append(
                TableCell(
                    row=row,
                    column=column,
                    rowSpan=parsed.row_span,
                    columnSpan=parsed.column_span,
                    text=parsed.text,
                    confidence=confidence,
                    boundingBox=box,
                    sourceBlockIds=source_ids,
                )
            )
            max_row = max(max_row, row + parsed.row_span)
            max_column = max(max_column, column + parsed.column_span)

        table_box = _canonical_box(
            _value(raw_table, "boundingBox")
            or _value(raw_table, "bbox")
            or _value(raw_table, "table_box")
            or fallback_box,
            page_width,
            page_height,
        )
        if table_box is None:
            table_box = _union_box([cell.boundingBox for cell in cells if cell.boundingBox is not None])
        if table_box is None:
            raise TableExtractionFailedError("Table pipeline returned no usable table bounding box")

        structure_score = _safe_float(
            _value(raw_table, "structure_score") or _value(raw_table, "confidence")
        )
        try:
            return TableResult(
                id=table_id,
                page=page,
                boundingBox=table_box,
                rowCount=max(1, max_row),
                columnCount=max(1, max_column),
                confidence=structure_score,
                cells=cells,
            )
        except ValidationError as exc:
            raise TableExtractionFailedError("Table pipeline returned invalid cell geometry") from exc


class PaddleTableEngineAdapter(TableEnginePort):
    """Execute PP-StructureV3 one canonical page at a time."""

    def __init__(
        self,
        pdf_renderer: PdfRenderer | None = None,
        table_instance: Any | None = None,
        table_factory: Callable[[], Any] | None = None,
        table_kwargs: dict[str, Any] | None = None,
        normalizer: TableResultNormalizer | None = None,
    ) -> None:
        self.pdf_renderer = pdf_renderer or PdfRenderer()
        self._table_instance = table_instance
        self._table_factory = table_factory
        self._table_kwargs = dict(table_kwargs or {})
        self.normalizer = normalizer or TableResultNormalizer()

    async def extract_tables(
        self,
        document: LoadedDocument,
        blocks: list[TextBlock],
    ) -> list[TableResult]:
        engine = self._get_or_create_engine()
        tables: list[TableResult] = []
        cell_total = 0
        try:
            for rendered_page in self.pdf_renderer.render_document(document):
                raw_result = self._run_engine_inference(engine, rendered_page.image)
                page_results = _as_list(raw_result)
                if page_results and _value(page_results[0], "table_res_list") is not None:
                    page_results = page_results[:1]
                for page_result in page_results:
                    page_tables = self.normalizer.normalize_page_result(
                        page_result,
                        page=rendered_page.page_number,
                        page_width=rendered_page.width,
                        page_height=rendered_page.height,
                        blocks=[block for block in blocks if block.page == rendered_page.page_number],
                    )
                    tables.extend(page_tables)
                    cell_total += sum(len(table.cells) for table in page_tables)
                    if len(tables) > MAX_TABLES_LIMIT:
                        raise OutputLimitExceededError(
                            f"Detected table count exceeds limit of {MAX_TABLES_LIMIT}"
                        )
                    if cell_total > MAX_CELLS_LIMIT:
                        raise OutputLimitExceededError(
                            f"Detected cell count exceeds limit of {MAX_CELLS_LIMIT}"
                        )
            return tables
        except OcrDomainError:
            raise
        except Exception as exc:
            raise TableExtractionFailedError("Table extraction pipeline failed") from exc

    def _run_engine_inference(self, engine: Any, image: Any) -> Any:
        predict = getattr(engine, "predict", None)
        if not callable(predict):
            raise TableExtractionFailedError(
                f"Configured table engine '{type(engine).__name__}' does not expose predict()"
            )
        try:
            result = predict(
                image,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                use_seal_recognition=False,
                use_formula_recognition=False,
                use_chart_recognition=False,
                use_region_detection=False,
                use_table_recognition=True,
                use_wired_table_cells_trans_to_html=False,
                use_wireless_table_cells_trans_to_html=False,
                use_table_orientation_classify=False,
                use_ocr_results_with_table_cells=True,
            )
        except TypeError:
            result = predict(image)
        return list(result) if not isinstance(result, (list, tuple, Mapping)) and hasattr(result, "__iter__") else result

    def _get_or_create_engine(self) -> Any:
        if self._table_instance is not None:
            return self._table_instance
        if self._table_factory is not None:
            self._table_instance = self._table_factory()
            return self._table_instance
        try:
            from paddleocr import PPStructureV3
        except ImportError as exc:
            raise ModelNotReadyError(f"PaddleOCR table runtime is not available: {exc}") from exc
        try:
            defaults = {
                # PP-StructureV3 has no native ``latin`` language alias.  The
                # Vietnamese profile uses a Latin recognizer and is the
                # closest built-in profile for WEAV's vi/en table corpus.
                "lang": "vi",
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
                "use_seal_recognition": False,
                "use_formula_recognition": False,
                "use_chart_recognition": False,
                "use_region_detection": False,
                "use_table_recognition": True,
                "enable_mkldnn": False,
            }
            defaults.update(self._table_kwargs)
            self._table_instance = PPStructureV3(**defaults)
        except Exception as exc:
            raise ModelNotReadyError("Failed to initialize PaddleOCR table engine") from exc
        return self._table_instance


__all__ = [
    "MAX_CELLS_LIMIT",
    "MAX_TABLES_LIMIT",
    "PaddleTableEngineAdapter",
    "TableResultNormalizer",
]
