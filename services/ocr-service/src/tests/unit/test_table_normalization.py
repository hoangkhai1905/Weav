#!/usr/bin/env python3
"""Unit tests for table orchestration and Paddle table-result normalization."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from src.application.use_cases.extract_text_use_case import ExtractTextUseCase
from src.domain.errors import OutputLimitExceededError, TableExtractionFailedError
from src.domain.models.ocr_request import OcrRequest, UploadSource
from src.domain.models.ocr_result import (
    BoundingBox,
    TableCell,
    TableResult,
    TextBlock,
)
from src.domain.ports.document_loader_port import DocumentLoaderPort, LoadedDocument
from src.domain.ports.ocr_engine_port import (
    EngineOcrResult,
    ExtractionOptions,
    OcrEnginePort,
)
from src.domain.ports.table_engine_port import TableEnginePort
from src.infrastructure.engines.paddle_table_engine_adapter import (
    PaddleTableEngineAdapter,
    TableResultNormalizer,
    _TableHtmlParser,
)
from src.infrastructure.files.bounded_spool import BoundedSpooler
from src.infrastructure.processors.pdf_renderer import RenderedPage


def _blocks() -> list[TextBlock]:
    return [
        TextBlock(
            id="p1-b1",
            order=0,
            text="Họ tên",
            confidence=0.98,
            page=1,
            boundingBox=BoundingBox(x=10, y=10, width=100, height=30),
        ),
        TextBlock(
            id="p1-b2",
            order=1,
            text="Nguyễn Văn A",
            confidence=0.96,
            page=1,
            boundingBox=BoundingBox(x=110, y=10, width=140, height=30),
        ),
        TextBlock(
            id="p1-b3",
            order=2,
            text="Đơn giá",
            confidence=0.94,
            page=1,
            boundingBox=BoundingBox(x=10, y=40, width=100, height=30),
        ),
    ]


def _paddle_page_result(html: str, boxes: list[Any], scores: list[float] | None = None) -> dict[str, Any]:
    return {
        "layout_det_res": {
            "boxes": [{"label": "table", "coordinate": [10, 10, 250, 80], "score": 0.91}]
        },
        "table_res_list": [
            {
                "table_region_id": 1,
                "cell_box_list": boxes,
                "pred_html": html,
                "table_ocr_pred": {
                    "rec_texts": [],
                    "rec_scores": scores or [],
                },
            }
        ],
    }


def test_normalizer_handles_bordered_table_and_maps_source_blocks() -> None:
    normalizer = TableResultNormalizer()
    result = normalizer.normalize_page_result(
        _paddle_page_result(
            "<table><tbody><tr><td>Họ tên</td><td>Nguyễn Văn A</td></tr>"
            "<tr><td>Đơn giá</td><td>120.000</td></tr></tbody></table>",
            [[10, 10, 110, 40], [110, 10, 250, 40], [10, 40, 110, 70], [110, 40, 250, 70]],
            [0.98, 0.96, 0.94, 0.92],
        ),
        page=1,
        page_width=300,
        page_height=100,
        blocks=_blocks(),
    )

    assert len(result) == 1
    table = result[0]
    assert (table.rowCount, table.columnCount) == (2, 2)
    assert [cell.text for cell in table.cells] == ["Họ tên", "Nguyễn Văn A", "Đơn giá", "120.000"]
    assert table.cells[0].sourceBlockIds == ["p1-b1"]
    assert table.cells[1].sourceBlockIds == ["p1-b2"]
    assert table.cells[2].sourceBlockIds == ["p1-b3"]
    assert table.confidence is None
    assert all("<" not in cell.text and ">" not in cell.text for cell in table.cells)


def test_normalizer_reconstructs_merged_cells_and_rotated_box() -> None:
    normalizer = TableResultNormalizer()
    result = normalizer.normalize_page_result(
        _paddle_page_result(
            "<table><tbody><tr><td rowspan='2'>Nhóm</td><td>Đơn giá</td></tr>"
            "<tr><td>120.000</td></tr></tbody></table>",
            [
                [[10, 10], [110, 10], [110, 70], [10, 70]],
                [[110, 10], [250, 12], [250, 40], [110, 40]],
                [[110, 40], [250, 42], [250, 70], [110, 70]],
            ],
        ),
        page=1,
        page_width=300,
        page_height=100,
        blocks=_blocks(),
    )

    table = result[0]
    assert (table.rowCount, table.columnCount) == (2, 2)
    merged = table.cells[0]
    assert (merged.row, merged.column, merged.rowSpan, merged.columnSpan) == (0, 0, 2, 1)
    assert table.cells[1].row == 0 and table.cells[1].column == 1
    assert table.cells[2].row == 1 and table.cells[2].column == 1


def test_normalizer_strips_markup_and_rejects_excessive_table_count() -> None:
    normalizer = TableResultNormalizer()
    raw = _paddle_page_result(
        "<table><tr><td><script>alert(1)</script><b>Hóa đơn</b></td></tr></table>",
        [[10, 10, 250, 70]],
    )
    normalized = normalizer.normalize_page_result(raw, 1, 300, 100, _blocks())
    assert normalized[0].cells[0].text == "Hóa đơn"
    assert "script" not in normalized[0].cells[0].text.lower()

    too_many = {
        "table_res_list": [
            {
                "table_region_id": index,
                "cell_box_list": [[1, 1, 10, 10]],
                "pred_html": "<table><tr><td>x</td></tr></table>",
            }
            for index in range(101)
        ]
    }
    with pytest.raises(OutputLimitExceededError):
        normalizer.normalize_page_result(too_many, 1, 300, 100, [])


def test_normalizer_handles_borderless_table_with_layout_box_and_sparse_cells() -> None:
    normalizer = TableResultNormalizer()
    raw = {
        "layout_det_res": {
            "boxes": [
                {"label": "table", "coordinate": [20, 20, 380, 120], "score": 0.89}
            ]
        },
        "table_res_list": [
            {
                "table_region_id": 1,
                "pred_html": (
                    "<table><tbody>"
                    "<tr><td>Mô tả</td><td>Đơn vị</td><td>Số tiền</td></tr>"
                    "<tr><td>Dịch vụ</td><td>Tháng</td><td>500.000</td></tr>"
                    "</tbody></table>"
                ),
                # Sparse cell boxes: only header cells have bounding boxes
                "cell_box_list": [
                    [20, 20, 140, 60],
                    [140, 20, 260, 60],
                    [260, 20, 380, 60],
                ],
                "table_ocr_pred": {
                    "rec_texts": ["Mô tả", "Đơn vị", "Số tiền"],
                    "rec_scores": [0.95, 0.94, 0.96],
                },
            }
        ],
    }

    results = normalizer.normalize_page_result(
        raw,
        page=1,
        page_width=500,
        page_height=300,
        blocks=[
            TextBlock(
                id="p1-b1",
                order=0,
                text="Mô tả",
                confidence=0.95,
                page=1,
                boundingBox=BoundingBox(x=25, y=25, width=80, height=30),
            )
        ],
    )

    assert len(results) == 1
    table = results[0]
    assert (table.rowCount, table.columnCount) == (2, 3)
    assert len(table.cells) == 6
    assert table.boundingBox.x == 20
    assert table.boundingBox.y == 20
    assert table.boundingBox.width == 360
    assert table.boundingBox.height == 100
    # First cell has canonical bounding box and mapped source block ID
    assert table.cells[0].boundingBox is not None
    assert table.cells[0].sourceBlockIds == ["p1-b1"]
    # Cells without box in sparse cell_box_list have None box and empty sourceBlockIds
    assert table.cells[3].boundingBox is None
    assert table.cells[3].sourceBlockIds == []
    assert table.cells[3].text == "Dịch vụ"
    assert table.cells[5].text == "500.000"


def test_normalizer_reconstructs_multi_row_and_column_spans() -> None:
    normalizer = TableResultNormalizer()
    raw = _paddle_page_result(
        "<table><tbody>"
        "<tr><td rowspan='2' colspan='2'>Tổng hợp</td><td>Cột 3</td></tr>"
        "<tr><td>Cột 3 dòng 2</td></tr>"
        "<tr><td>Dòng 3 ô 1</td><td>Dòng 3 ô 2</td><td>Dòng 3 ô 3</td></tr>"
        "</tbody></table>",
        [
            [[10, 10], [150, 10], [150, 60], [10, 60]],
            [[150, 10], [250, 10], [250, 35], [150, 35]],
            [[150, 35], [250, 35], [250, 60], [150, 60]],
            [[10, 60], [80, 60], [80, 90], [10, 90]],
            [[80, 60], [150, 60], [150, 90], [80, 90]],
            [[150, 60], [250, 60], [250, 90], [150, 90]],
        ],
    )
    result = normalizer.normalize_page_result(
        raw, page=1, page_width=300, page_height=100, blocks=[]
    )
    table = result[0]
    assert (table.rowCount, table.columnCount) == (3, 3)
    merged = table.cells[0]
    assert (merged.row, merged.column, merged.rowSpan, merged.columnSpan) == (0, 0, 2, 2)
    assert (table.cells[1].row, table.cells[1].column) == (0, 2)
    assert (table.cells[2].row, table.cells[2].column) == (1, 2)
    assert (table.cells[3].row, table.cells[3].column) == (2, 0)
    assert (table.cells[4].row, table.cells[4].column) == (2, 1)
    assert (table.cells[5].row, table.cells[5].column) == (2, 2)


def test_table_models_strictly_forbid_business_fields() -> None:
    with pytest.raises(ValidationError):
        TableCell.model_validate(
            {
                "row": 0,
                "column": 0,
                "rowSpan": 1,
                "columnSpan": 1,
                "text": "120.000",
                "total_amount": 120000,
            }
        )

    with pytest.raises(ValidationError):
        TableResult.model_validate(
            {
                "id": "p1-t1",
                "page": 1,
                "boundingBox": {"x": 10, "y": 10, "width": 100, "height": 50},
                "rowCount": 1,
                "columnCount": 1,
                "cells": [
                    {
                        "row": 0,
                        "column": 0,
                        "rowSpan": 1,
                        "columnSpan": 1,
                        "text": "Item",
                    }
                ],
                "invoice_number": "INV-001",
            }
        )


def test_normalizer_rejects_excessive_cell_count() -> None:
    normalizer = TableResultNormalizer(max_cells=50)
    cells_html = "".join(f"<td>c{i}</td>" for i in range(51))
    raw = _paddle_page_result(
        f"<table><tr>{cells_html}</tr></table>",
        [[1, 1, 10, 10] for _ in range(51)],
    )
    with pytest.raises(OutputLimitExceededError) as exc_info:
        normalizer.normalize_page_result(raw, 1, 300, 100, [])
    assert "cell count exceeds limit" in str(exc_info.value).lower()


def test_html_parser_flushes_unclosed_tags_gracefully() -> None:
    parser = _TableHtmlParser()
    parser.feed("<table><tr><td>Ô 1<td>Ô 2<tr><td>Ô 3")
    parser.close()

    assert len(parser.cells) == 3
    assert [c.text for c in parser.cells] == ["Ô 1", "Ô 2", "Ô 3"]
    assert [c.row_hint for c in parser.cells] == [0, 0, 1]


class _FakePageRenderer:
    def render_document(self, document: LoadedDocument) -> list[RenderedPage]:
        return [RenderedPage(page_number=1, image=object(), width=300, height=100, dpi=None)]


class _FakeTablePredictor:
    def __init__(self) -> None:
        self.options: dict[str, Any] = {}

    def predict(self, image: Any, **options: Any) -> list[dict[str, Any]]:
        self.options = options
        return [
            _paddle_page_result(
                "<table><tr><td>Họ tên</td></tr></table>",
                [[10, 10, 250, 70]],
            )
        ]


@pytest.mark.asyncio
async def test_paddle_adapter_runs_one_canonical_page_and_disables_html_outputs() -> None:
    predictor = _FakeTablePredictor()
    document = LoadedDocument(
        file_path=Path("/tmp/fake.png"),
        file_name="fake.png",
        mime_type="image/png",
        size_bytes=1,
        pages=1,
        page_info=[{"page": 1, "width": 300, "height": 100, "dpi": None}],
    )

    tables = await PaddleTableEngineAdapter(
        pdf_renderer=_FakePageRenderer(),  # type: ignore[arg-type]
        table_instance=predictor,
    ).extract_tables(document, _blocks())

    assert len(tables) == 1
    assert tables[0].cells[0].text == "Họ tên"
    assert predictor.options["use_table_recognition"] is True
    assert predictor.options["use_wired_table_cells_trans_to_html"] is False


class _FakeDocumentLoader(DocumentLoaderPort):
    def validate_and_load(self, file_path: Path, client_filename: str | None = None) -> LoadedDocument:
        return LoadedDocument(
            file_path=file_path,
            file_name=client_filename or "sample.png",
            mime_type="image/png",
            size_bytes=file_path.stat().st_size,
            pages=1,
            page_info=[{"page": 1, "width": 300, "height": 100, "dpi": None}],
        )


class _FakeOcrEngine(OcrEnginePort):
    def __init__(
        self,
        blocks: list[TextBlock] | None = None,
        raw_text: str | None = None,
    ) -> None:
        self.blocks = blocks if blocks is not None else []
        self.raw_text = raw_text if (raw_text is not None or blocks is not None) else "Họ tên"

    async def extract(self, document: LoadedDocument, options: ExtractionOptions) -> EngineOcrResult:
        return EngineOcrResult(raw_text=self.raw_text, blocks=self.blocks)


class _FakeTableEngine(TableEnginePort):
    def __init__(self, tables: list[TableResult] | None = None, error: Exception | None = None) -> None:
        self.calls = 0
        self.tables = tables or []
        self.error = error

    async def extract_tables(self, document: LoadedDocument, blocks: list[TextBlock]) -> list[TableResult]:
        self.calls += 1
        if self.error:
            raise self.error
        return self.tables


async def _upload() -> AsyncIterator[bytes]:
    yield b"not-decoded-by-fake-loader"


def _request(detect_tables: bool) -> OcrRequest:
    return OcrRequest(
        requestId=uuid.uuid4(),
        source=UploadSource(stream=_upload(), filename="sample.png"),
        language="vi+en",
        detectTables=detect_tables,
    )


@pytest.mark.asyncio
async def test_detect_tables_false_never_calls_table_engine(tmp_path: Path) -> None:
    table_engine = _FakeTableEngine()
    use_case = ExtractTextUseCase(
        document_loader=_FakeDocumentLoader(),
        ocr_engine=_FakeOcrEngine(),
        table_engine=table_engine,
        spooler=BoundedSpooler(temp_root=tmp_path),
    )

    result = await use_case.execute(_request(False))

    assert result.tables == []
    assert result.metadata.tableDetection == "not_requested"
    assert table_engine.calls == 0


@pytest.mark.asyncio
async def test_detect_tables_true_without_engine_is_explicit_error(tmp_path: Path) -> None:
    use_case = ExtractTextUseCase(
        document_loader=_FakeDocumentLoader(),
        ocr_engine=_FakeOcrEngine(),
        spooler=BoundedSpooler(temp_root=tmp_path),
    )

    with pytest.raises(TableExtractionFailedError) as exc_info:
        await use_case.execute(_request(True))

    assert exc_info.value.code == "TABLE_EXTRACTION_FAILED"
    assert "not configured" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_detect_tables_true_empty_result_is_completed(tmp_path: Path) -> None:
    table_engine = _FakeTableEngine()
    use_case = ExtractTextUseCase(
        document_loader=_FakeDocumentLoader(),
        ocr_engine=_FakeOcrEngine(),
        table_engine=table_engine,
        spooler=BoundedSpooler(temp_root=tmp_path),
    )

    result = await use_case.execute(_request(True))

    assert result.tables == []
    assert result.metadata.tableDetection == "completed"
    assert table_engine.calls == 1


@pytest.mark.asyncio
async def test_table_engine_failure_is_clear_domain_error(tmp_path: Path) -> None:
    table_engine = _FakeTableEngine(error=RuntimeError("paddle failed"))
    use_case = ExtractTextUseCase(
        document_loader=_FakeDocumentLoader(),
        ocr_engine=_FakeOcrEngine(),
        table_engine=table_engine,
        spooler=BoundedSpooler(temp_root=tmp_path),
    )

    with pytest.raises(TableExtractionFailedError) as exc_info:
        await use_case.execute(_request(True))

    assert exc_info.value.code == "TABLE_EXTRACTION_FAILED"
    assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_extract_text_use_case_does_not_duplicate_raw_text_when_tables_present(
    tmp_path: Path,
) -> None:
    table = TableResult(
        id="p1-t1",
        page=1,
        boundingBox=BoundingBox(x=10, y=10, width=200, height=80),
        rowCount=2,
        columnCount=2,
        cells=[
            TableCell(
                row=0,
                column=0,
                rowSpan=1,
                columnSpan=1,
                text="Hàng hóa",
                boundingBox=BoundingBox(x=10, y=10, width=90, height=35),
                sourceBlockIds=["p1-b1"],
            ),
            TableCell(
                row=0,
                column=1,
                rowSpan=1,
                columnSpan=1,
                text="Số tiền",
                boundingBox=BoundingBox(x=100, y=10, width=90, height=35),
                sourceBlockIds=["p1-b2"],
            ),
            TableCell(
                row=1,
                column=0,
                rowSpan=1,
                columnSpan=1,
                text="Bút bi",
                boundingBox=BoundingBox(x=10, y=45, width=90, height=35),
            ),
            TableCell(
                row=1,
                column=1,
                rowSpan=1,
                columnSpan=1,
                text="5.000",
                boundingBox=BoundingBox(x=100, y=45, width=90, height=35),
            ),
        ],
    )
    table_engine = _FakeTableEngine(tables=[table])
    ocr_engine = _FakeOcrEngine(
        blocks=[
            TextBlock(
                id="p1-b1",
                order=0,
                text="Hàng hóa",
                confidence=0.98,
                page=1,
                boundingBox=BoundingBox(x=10, y=10, width=90, height=35),
            ),
            TextBlock(
                id="p1-b2",
                order=1,
                text="Số tiền",
                confidence=0.97,
                page=1,
                boundingBox=BoundingBox(x=100, y=10, width=90, height=35),
            ),
        ],
        raw_text="Hàng hóa\nSố tiền",
    )
    use_case = ExtractTextUseCase(
        document_loader=_FakeDocumentLoader(),
        ocr_engine=ocr_engine,
        table_engine=table_engine,
        spooler=BoundedSpooler(temp_root=tmp_path),
    )

    result = await use_case.execute(_request(True))

    assert result.metadata.tableDetection == "completed"
    assert len(result.tables) == 1
    assert result.tables[0].id == "p1-t1"
    # Raw text must contain only text blocks in reading order without appending table cells again
    assert result.text.rawText == "Hàng hóa\nSố tiền"
    assert "Bút bi" not in result.text.rawText
    assert "5.000" not in result.text.rawText
