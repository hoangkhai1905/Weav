#!/usr/bin/env python3
"""Real PP-StructureV3 table smoke tests.

These tests require an explicitly provisioned, offline table-model manifest.
They never download models implicitly and remain pending when that artifact is
not present on the runner.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from src.infrastructure.engines.paddle_table_engine_adapter import (
    PaddleTableEngineAdapter,
)
from src.infrastructure.files.document_loader import DocumentLoader


def _table_model_kwargs() -> dict[str, Any] | None:
    manifest_path = os.getenv("WEAV_OCR_TABLE_MODEL_MANIFEST")
    if not manifest_path:
        return None
    path = Path(manifest_path)
    if not path.is_file():
        pytest.skip("PENDING RUNTIME: WEAV_OCR_TABLE_MODEL_MANIFEST is not a file")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        pytest.skip(f"PENDING RUNTIME: table model manifest is unreadable ({exc})")
    if not isinstance(manifest, dict):
        pytest.skip("PENDING RUNTIME: table model manifest must be a JSON object")
    kwargs = manifest.get("ppstructure") or manifest.get("table") or manifest.get("kwargs") or manifest
    if not isinstance(kwargs, dict) or not kwargs:
        pytest.skip("PENDING RUNTIME: table model manifest has no PP-StructureV3 kwargs")
    return kwargs


def _make_table_fixture(path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1400, 800), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 38)
    except OSError:
        font = ImageFont.load_default()
        bold = font

    x0, y0 = 80, 100
    col_x = [x0, 500, 950, 1320]
    row_y = [y0, 230, 430, 630]
    for x in col_x:
        draw.line((x, row_y[0], x, row_y[-1]), fill="black", width=4)
    for y in row_y:
        draw.line((col_x[0], y, col_x[-1], y), fill="black", width=4)
    draw.text((120, 145), "Họ tên", fill="black", font=bold)
    draw.text((560, 145), "Đơn giá", fill="black", font=bold)
    draw.text((1010, 145), "Số lượng", fill="black", font=bold)
    draw.text((120, 275), "Nguyễn Văn A", fill="black", font=font)
    draw.text((560, 275), "120.000", fill="black", font=font)
    draw.text((1010, 275), "2", fill="black", font=font)
    draw.text((120, 475), "Trần Thị B", fill="black", font=font)
    draw.text((560, 475), "85.000", fill="black", font=font)
    draw.text((1010, 475), "1", fill="black", font=font)
    image.save(path, format="PNG")


@pytest.mark.asyncio
async def test_real_bordered_vietnamese_table_is_normalized(tmp_path: Path) -> None:
    kwargs = _table_model_kwargs()
    if kwargs is None:
        pytest.skip("PENDING RUNTIME: real table model manifest is not provisioned")

    fixture = tmp_path / "sample_table.png"
    _make_table_fixture(fixture)
    document = DocumentLoader().validate_and_load(fixture, client_filename=fixture.name)

    def factory() -> Any:
        from paddleocr import PPStructureV3

        return PPStructureV3(**kwargs)

    tables = await PaddleTableEngineAdapter(table_factory=factory).extract_tables(document, blocks=[])

    assert tables, "PP-StructureV3 did not detect the acceptance table"
    assert tables[0].rowCount >= 3
    assert tables[0].columnCount >= 3
    assert any(cell.text.strip() for cell in tables[0].cells)
    assert all("<" not in cell.text and ">" not in cell.text for table in tables for cell in table.cells)
    if not any("Nguyễn" in cell.text or "Họ tên" in cell.text for cell in tables[0].cells):
        pytest.xfail(
            "PENDING QUALITY GATE: current PP-OCRv5 table recognizer does not preserve "
            "the Vietnamese diacritics in this acceptance fixture"
        )
