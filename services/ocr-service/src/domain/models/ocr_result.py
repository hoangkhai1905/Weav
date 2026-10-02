#!/usr/bin/env python3
"""Domain models for normalized OCR extraction results.

Conforms strictly to the frozen API contract defined in packages/contracts/http/ocr/openapi.yaml.
Strictly forbids invoice, accounting, or business entity fields.
"""

from __future__ import annotations

import unicodedata
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LanguageOption = Literal["vi", "en", "vi+en"]
MimeTypeOption = Literal["image/png", "image/jpeg", "image/webp", "application/pdf"]
QualityOption = Literal["OK", "LOW_CONFIDENCE", "EMPTY"]
TableDetectionOption = Literal["not_requested", "completed"]


class ResultBaseModel(BaseModel):
    """Base model with extra='forbid' to reject any undeclared or business fields."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BoundingBox(ResultBaseModel):
    """Upper-left origin bounding box in canonical page pixel coordinates."""

    x: float = Field(..., ge=0.0, description="X coordinate of upper-left corner")
    y: float = Field(..., ge=0.0, description="Y coordinate of upper-left corner")
    width: float = Field(..., gt=0.0, description="Box width in canonical pixels")
    height: float = Field(..., gt=0.0, description="Box height in canonical pixels")


class PageInfo(ResultBaseModel):
    """Dimensions and rendering metadata per document page."""

    page: int = Field(..., ge=1, description="1-based page index")
    width: int = Field(..., gt=0, le=10000, description="Page width in canonical pixels")
    height: int = Field(..., gt=0, le=10000, description="Page height in canonical pixels")
    dpi: int | None = Field(default=None, description="Rendering DPI for PDF, or null for raster images")


class DocumentInfo(ResultBaseModel):
    """Verified document metadata and page properties."""

    fileName: str = Field(..., max_length=255, description="Sanitized document basename")
    mimeType: MimeTypeOption = Field(..., description="Canonical verified MIME type")
    pages: int = Field(..., ge=1, le=10, description="Total processed page count (1-10)")
    pageInfo: list[PageInfo] = Field(..., min_length=1, max_length=10, description="Per-page geometry")

    @model_validator(mode="after")
    def validate_page_count_matches(self) -> DocumentInfo:
        if len(self.pageInfo) != self.pages:
            raise ValueError(f"pageInfo length ({len(self.pageInfo)}) must equal declared pages ({self.pages})")
        return self


class TextResult(ResultBaseModel):
    """Aggregated document text in Unicode NFC normalization."""

    rawText: str = Field(..., max_length=1048576, description="Full extracted text with newline and page breaks")


class TextBlock(ResultBaseModel):
    """Segment of recognized text with canonical bounding box and confidence score."""

    id: str = Field(..., description="Unique block identifier (e.g. p1-b1)")
    order: int = Field(..., ge=0, description="0-based reading order index")
    text: str = Field(..., description="Block text in Unicode NFC")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Recognition confidence in [0.0, 1.0]")
    page: int = Field(..., ge=1, description="1-based page number")
    boundingBox: BoundingBox
    polygon: list[list[float]] | None = Field(default=None, description="Optional 4-point polygon coordinates")


class TableCell(ResultBaseModel):
    """Individual table grid cell with row/column spans and text content."""

    row: int = Field(..., ge=0, description="0-based row index")
    column: int = Field(..., ge=0, description="0-based column index")
    rowSpan: int = Field(1, ge=1, description="Row span")
    columnSpan: int = Field(1, ge=1, description="Column span")
    text: str = Field(..., description="Extracted cell text in Unicode NFC")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0, description="Text confidence or null")
    boundingBox: BoundingBox | None = Field(default=None, description="Cell bounding box or null")
    sourceBlockIds: list[str] = Field(default_factory=list, description="IDs of TextBlocks merged into cell")


class TableResult(ResultBaseModel):
    """Structured table representation extracted from document page."""

    id: str = Field(..., description="Unique table identifier (e.g. p1-t1)")
    page: int = Field(..., ge=1, description="1-based page number")
    boundingBox: BoundingBox
    rowCount: int = Field(..., ge=1, description="Total row count in grid")
    columnCount: int = Field(..., ge=1, description="Total column count in grid")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0, description="Structure score or null")
    cells: list[TableCell] = Field(..., description="Grid cells comprising the table")

    @model_validator(mode="after")
    def validate_cell_boundaries(self) -> TableResult:
        occupied: set[tuple[int, int]] = set()
        for cell in self.cells:
            if cell.row + cell.rowSpan > self.rowCount:
                raise ValueError(
                    f"Cell at row {cell.row} with rowSpan {cell.rowSpan} exceeds table rowCount {self.rowCount}"
                )
            if cell.column + cell.columnSpan > self.columnCount:
                raise ValueError(
                    f"Cell at col {cell.column} with colSpan {cell.columnSpan} exceeds table columnCount {self.columnCount}"
                )
            for row in range(cell.row, cell.row + cell.rowSpan):
                for column in range(cell.column, cell.column + cell.columnSpan):
                    coordinate = (row, column)
                    if coordinate in occupied:
                        raise ValueError(f"Table cells overlap at row {row}, column {column}")
                    occupied.add(coordinate)
        return self


class PreprocessingRecord(ResultBaseModel):
    """Records preprocessing operations applied to a given page."""

    page: int = Field(..., ge=1)
    steps: list[str] = Field(..., description="List of preprocessing operation names")


class ExtractionWarning(ResultBaseModel):
    """Structured, non-fatal extraction warning."""

    code: str = Field(..., description="Warning code (e.g. LOW_CONFIDENCE, BLANK_PAGE)")
    message: str = Field(..., description="Human-readable warning description")
    page: int | None = Field(default=None, ge=1, description="Associated page number if applicable")
    blockId: str | None = Field(default=None, description="Associated block ID if applicable")


class ExtractionMetadata(ResultBaseModel):
    """Operational and provenance metadata for the extraction execution."""

    language: LanguageOption
    resolvedLanguage: str
    processingTimeMs: int = Field(..., ge=0, description="Total execution wall-clock time in milliseconds")
    engine: str = Field(default="paddleocr")
    engineVersion: str = Field(default="3.7.0")
    modelRevision: str = Field(default="approved-model-manifest-id")
    tableDetection: TableDetectionOption
    quality: QualityOption
    preprocessing: list[PreprocessingRecord] = Field(default_factory=list)
    warnings: list[ExtractionWarning] = Field(default_factory=list)


class OcrExtractionResult(ResultBaseModel):
    """Top-level frozen OCR extraction result document."""

    schemaVersion: Literal["1.0"] = "1.0"
    requestId: uuid.UUID
    document: DocumentInfo
    text: TextResult
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    blocks: list[TextBlock] = Field(default_factory=list, max_length=20000)
    tables: list[TableResult] = Field(default_factory=list, max_length=100)
    metadata: ExtractionMetadata

    @model_validator(mode="after")
    def validate_contract_semantics(self) -> OcrExtractionResult:
        # Build page dimension map
        page_dims = {p.page: (p.width, p.height) for p in self.document.pageInfo}

        # Validate bounding box boundaries for text blocks
        for block in self.blocks:
            if block.page not in page_dims:
                raise ValueError(f"Block {block.id} references undeclared page {block.page}")
            pw, ph = page_dims[block.page]
            if (block.boundingBox.x + block.boundingBox.width) > (pw + 1.0) or (
                block.boundingBox.y + block.boundingBox.height
            ) > (ph + 1.0):
                raise ValueError(
                    f"Block {block.id} box exceeds page {block.page} dimensions ({pw}, {ph})"
                )

        # Validate bounding box boundaries for tables
        for table in self.tables:
            if table.page not in page_dims:
                raise ValueError(f"Table {table.id} references undeclared page {table.page}")
            pw, ph = page_dims[table.page]
            if (table.boundingBox.x + table.boundingBox.width) > (pw + 1.0) or (
                table.boundingBox.y + table.boundingBox.height
            ) > (ph + 1.0):
                raise ValueError(f"Table {table.id} box exceeds page {table.page} dimensions ({pw}, {ph})")

        # Empty document check: confidence must be null and quality must be EMPTY
        if not self.text.rawText.strip() and len(self.blocks) == 0:
            if self.confidence is not None:
                raise ValueError("Empty document must have confidence=null")
            if self.metadata.quality != "EMPTY":
                raise ValueError("Empty document must have metadata.quality='EMPTY'")

        return self


def calculate_weighted_confidence(
    blocks: list[TextBlock],
) -> tuple[float | None, QualityOption]:
    """Calculate document confidence weighted by non-whitespace character count of each block.

    Returns:
        (confidence_score, quality_classification)
        - If no text blocks or text is all whitespace: (None, "EMPTY")
        - If confidence < 0.70: (score, "LOW_CONFIDENCE")
        - Otherwise: (score, "OK")
    """
    total_chars = 0
    weighted_sum = 0.0

    for block in blocks:
        # Count non-whitespace Unicode code points
        non_ws_count = sum(1 for ch in block.text if not ch.isspace())
        if non_ws_count > 0:
            total_chars += non_ws_count
            weighted_sum += block.confidence * non_ws_count

    if total_chars == 0:
        return None, "EMPTY"

    score = round(weighted_sum / total_chars, 4)
    # Ensure score stays clamped in [0.0, 1.0]
    score = max(0.0, min(1.0, score))

    if score < 0.70:
        return score, "LOW_CONFIDENCE"
    return score, "OK"


def normalize_raw_text(blocks: list[TextBlock], total_pages: int) -> str:
    """Normalize extracted text into canonical rawText with line and page breaks in Unicode NFC."""
    if not blocks:
        return ""

    # Group blocks by page, then sort by reading order
    pages: dict[int, list[TextBlock]] = {p: [] for p in range(1, total_pages + 1)}
    for block in blocks:
        if block.page in pages:
            pages[block.page].append(block)

    page_texts: list[str] = []
    for p in range(1, total_pages + 1):
        p_blocks = sorted(pages[p], key=lambda b: b.order)
        p_text = "\n".join(b.text.strip() for b in p_blocks if b.text.strip())
        page_texts.append(p_text)

    # Page separator is '\n\f\n'
    full_text = "\n\f\n".join(page_texts).strip()
    return unicodedata.normalize("NFC", full_text)
