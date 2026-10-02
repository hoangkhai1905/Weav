#!/usr/bin/env python3

"""Contract and consumer schema validation tests for OCR Service.

Freezes and validates the HTTP API contract defined in packages/contracts/http/ocr/openapi.yaml.
Tests assert:
  - Source discrimination (artifact vs url) and rejection of mixed sources
  - Document-level and block-level confidence scores in [0.0, 1.0] or None (nullable)
  - Canonical bounding boxes within page boundaries
  - Table grid boundaries and cell span constraints
  - Presence of requestId UUID in responses and error envelopes
  - Strict absence and rejection of business/invoice fields
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Literal

import pytest
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "ocr"


# ---------------------------------------------------------------------------
# Contract Pydantic Models for Schema & Consumer Validation
# ---------------------------------------------------------------------------

LanguageOption = Literal["vi", "en", "vi+en"]
QualityOption = Literal["OK", "LOW_CONFIDENCE", "EMPTY"]
TableDetectionOption = Literal["not_requested", "completed"]
MimeTypeOption = Literal["image/png", "image/jpeg", "image/webp", "application/pdf"]

FORBIDDEN_BUSINESS_FIELDS = {
    "invoiceNumber",
    "invoice_number",
    "vendorName",
    "vendor_name",
    "taxCode",
    "tax_code",
    "totalAmount",
    "total_amount",
    "subtotalAmount",
    "subtotal_amount",
    "vatAmount",
    "vat_amount",
    "lineItems",
    "line_items",
}


class ArtifactSourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["artifact"]
    artifactId: uuid.UUID


class UrlSourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["url"]
    fileUrl: str

    @field_validator("fileUrl")
    @classmethod
    def validate_https_url(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("fileUrl must use the https:// scheme")
        if len(v) > 4096:
            raise ValueError("fileUrl must not exceed 4096 characters")
        return v


class ExtractionRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: ArtifactSourceModel | UrlSourceModel = Field(..., discriminator="type")
    language: LanguageOption = "vi+en"
    detectTables: bool = True


class PageInfoModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(..., ge=1)
    width: int = Field(..., gt=0, le=10000)
    height: int = Field(..., gt=0, le=10000)
    dpi: int | None = None


class DocumentInfoModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fileName: str = Field(..., max_length=255)
    mimeType: MimeTypeOption
    pages: int = Field(..., ge=1, le=10)
    pageInfo: list[PageInfoModel]

    @model_validator(mode="after")
    def validate_page_count_matches(self) -> DocumentInfoModel:
        if len(self.pageInfo) != self.pages:
            raise ValueError(
                f"pageInfo length ({len(self.pageInfo)}) must equal declared pages ({self.pages})"
            )
        return self


class BoundingBoxModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(..., ge=0.0)
    y: float = Field(..., ge=0.0)
    width: float = Field(..., gt=0.0)
    height: float = Field(..., gt=0.0)


class TextBlockModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    order: int = Field(..., ge=0)
    text: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    page: int = Field(..., ge=1)
    boundingBox: BoundingBoxModel
    polygon: list[list[float]] | None = None


class TableCellModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    row: int = Field(..., ge=0)
    column: int = Field(..., ge=0)
    rowSpan: int = Field(1, ge=1)
    columnSpan: int = Field(1, ge=1)
    text: str
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    boundingBox: BoundingBoxModel | None = None
    sourceBlockIds: list[str] = Field(default_factory=list)


class TableResultModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    page: int = Field(..., ge=1)
    boundingBox: BoundingBoxModel
    rowCount: int = Field(..., ge=1)
    columnCount: int = Field(..., ge=1)
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    cells: list[TableCellModel]

    @model_validator(mode="after")
    def validate_cell_boundaries(self) -> TableResultModel:
        for cell in self.cells:
            if cell.row + cell.rowSpan > self.rowCount:
                raise ValueError(
                    f"Cell at row {cell.row} with rowSpan {cell.rowSpan} exceeds table rowCount {self.rowCount}"
                )
            if cell.column + cell.columnSpan > self.columnCount:
                raise ValueError(
                    f"Cell at col {cell.column} with colSpan {cell.columnSpan} exceeds table columnCount {self.columnCount}"
                )
        return self


class PreprocessingRecordModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(..., ge=1)
    steps: list[str]


class ExtractionWarningModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    page: int | None = None
    blockId: str | None = None


class ExtractionMetadataModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: LanguageOption
    resolvedLanguage: str
    processingTimeMs: int = Field(..., ge=0)
    engine: str
    engineVersion: str
    modelRevision: str
    tableDetection: TableDetectionOption
    quality: QualityOption
    preprocessing: list[PreprocessingRecordModel]
    warnings: list[ExtractionWarningModel]


class TextResultModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rawText: str = Field(..., max_length=1048576)


class OcrExtractionResultModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["1.0"]
    requestId: uuid.UUID
    document: DocumentInfoModel
    text: TextResultModel
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    blocks: list[TextBlockModel] = Field(default_factory=list, max_length=20000)
    tables: list[TableResultModel] = Field(default_factory=list, max_length=100)
    metadata: ExtractionMetadataModel

    @model_validator(mode="after")
    def validate_consumer_geometry_and_rules(self) -> OcrExtractionResultModel:
        # Build page dimension map
        page_dims = {p.page: (p.width, p.height) for p in self.document.pageInfo}

        # Consumer check: block boxes must be within page dimensions (with 1px rounding tolerance)
        for block in self.blocks:
            if block.page not in page_dims:
                raise ValueError(f"Block {block.id} references undeclared page {block.page}")
            pw, ph = page_dims[block.page]
            bx = block.boundingBox.x
            by = block.boundingBox.y
            bw = block.boundingBox.width
            bh = block.boundingBox.height
            if (bx + bw) > (pw + 1.0) or (by + bh) > (ph + 1.0):
                raise ValueError(
                    f"Block {block.id} box ({bx}+{bw}, {by}+{bh}) exceeds page {block.page} dimensions ({pw}, {ph})"
                )

        # Consumer check: table boxes must be within page dimensions
        for table in self.tables:
            if table.page not in page_dims:
                raise ValueError(f"Table {table.id} references undeclared page {table.page}")
            pw, ph = page_dims[table.page]
            if (table.boundingBox.x + table.boundingBox.width) > (pw + 1.0) or (
                table.boundingBox.y + table.boundingBox.height
            ) > (ph + 1.0):
                raise ValueError(
                    f"Table {table.id} box exceeds page {table.page} dimensions ({pw}, {ph})"
                )

        # Ensure empty documents have null confidence and EMPTY quality
        if not self.text.rawText.strip() and len(self.blocks) == 0:
            if self.confidence is not None:
                raise ValueError("Empty document must have confidence=null")
            if self.metadata.quality != "EMPTY":
                raise ValueError("Empty document must have metadata.quality='EMPTY'")

        return self


class ApiErrorDetailModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)


class ApiErrorEnvelopeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: ApiErrorDetailModel
    requestId: uuid.UUID


# ---------------------------------------------------------------------------
# Unit Test Suite
# ---------------------------------------------------------------------------


def _load_fixture(name: str) -> dict[str, Any]:
    file_path = FIXTURES_DIR / name
    assert file_path.exists(), f"Missing fixture file: {file_path}"
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


class TestOcrContractRequests:
    """Validates request contracts, source discrimination, and boundary checks."""

    def test_valid_artifact_request_conforms(self):
        payload = _load_fixture("valid_artifact_request.json")
        model = ExtractionRequestModel.model_validate(payload)
        assert model.source.type == "artifact"
        assert str(model.source.artifactId) == "8eae413e-b229-490f-927a-3e2ee793d029"
        assert model.language == "vi+en"
        assert model.detectTables is True

    def test_valid_url_request_conforms(self):
        payload = _load_fixture("valid_url_request.json")
        model = ExtractionRequestModel.model_validate(payload)
        assert model.source.type == "url"
        assert model.source.fileUrl.startswith("https://")
        assert model.language == "en"
        assert model.detectTables is False

    def test_reject_mixed_source_request(self):
        payload = _load_fixture("invalid_mixed_source_request.json")
        with pytest.raises(ValidationError) as exc_info:
            ExtractionRequestModel.model_validate(payload)
        # Rejection because discriminator object contains extra fields or does not match
        errors = str(exc_info.value)
        assert "extra_forbidden" in errors or "source" in errors

    def test_reject_http_non_secure_url(self):
        payload = {
            "source": {
                "type": "url",
                "fileUrl": "http://insecure-storage.example.com/test.png",
            }
        }
        with pytest.raises(ValidationError) as exc_info:
            ExtractionRequestModel.model_validate(payload)
        assert "https://" in str(exc_info.value)

    def test_reject_unsupported_language_enum(self):
        payload = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            },
            "language": "fr",
        }
        with pytest.raises(ValidationError):
            ExtractionRequestModel.model_validate(payload)


class TestOcrContractResponses:
    """Validates successful response payloads, coordinates, and table structures."""

    def test_valid_single_page_response_conforms(self):
        payload = _load_fixture("valid_single_page_response.json")
        model = OcrExtractionResultModel.model_validate(payload)
        assert model.schemaVersion == "1.0"
        assert model.confidence == 0.984
        assert len(model.blocks) == 2
        assert model.tables == []
        assert model.metadata.quality == "OK"

    def test_valid_table_response_conforms(self):
        payload = _load_fixture("valid_table_response.json")
        model = OcrExtractionResultModel.model_validate(payload)
        assert len(model.tables) == 1
        table = model.tables[0]
        assert table.rowCount == 2
        assert table.columnCount == 2
        assert len(table.cells) == 4
        # Verify sourceBlockIds linkage
        assert "p1-b2" in table.cells[0].sourceBlockIds

    def test_valid_empty_document_conforms(self):
        payload = _load_fixture("valid_empty_response.json")
        model = OcrExtractionResultModel.model_validate(payload)
        assert model.confidence is None
        assert model.text.rawText == ""
        assert model.blocks == []
        assert model.tables == []
        assert model.metadata.quality == "EMPTY"
        assert any(w.code == "BLANK_PAGE" for w in model.metadata.warnings)


class TestOcrConsumerRejections:
    """Validates consumer rejection rules for invalid or corrupt response structures."""

    def test_reject_confidence_greater_than_one(self):
        payload = _load_fixture("invalid_confidence_response.json")
        with pytest.raises(ValidationError) as exc_info:
            OcrExtractionResultModel.model_validate(payload)
        assert "less_than_equal" in str(exc_info.value) or "confidence" in str(exc_info.value)

    def test_reject_bbox_outside_page_dimensions(self):
        payload = _load_fixture("invalid_bbox_out_of_bounds.json")
        with pytest.raises(ValidationError) as exc_info:
            OcrExtractionResultModel.model_validate(payload)
        assert "exceeds page" in str(exc_info.value)

    def test_reject_cell_span_exceeding_table_dimensions(self):
        payload = _load_fixture("invalid_cell_spans.json")
        with pytest.raises(ValidationError) as exc_info:
            OcrExtractionResultModel.model_validate(payload)
        assert "exceeds table columnCount" in str(exc_info.value)

    def test_reject_missing_request_id(self):
        payload = _load_fixture("invalid_missing_request_id.json")
        with pytest.raises(ValidationError) as exc_info:
            OcrExtractionResultModel.model_validate(payload)
        assert "requestId" in str(exc_info.value)

    def test_reject_business_and_invoice_fields(self):
        payload = _load_fixture("valid_single_page_response.json")
        for forbidden in FORBIDDEN_BUSINESS_FIELDS:
            corrupted = json.loads(json.dumps(payload))
            corrupted[forbidden] = "INV-2026-001"
            with pytest.raises(ValidationError) as exc_info:
                OcrExtractionResultModel.model_validate(corrupted)
            assert "extra_forbidden" in str(exc_info.value)


class TestOcrErrorEnvelope:
    """Validates typed error envelopes, standard error codes, and retryable flag."""

    def test_valid_error_timeout_envelope_conforms(self):
        payload = _load_fixture("error_timeout_envelope.json")
        model = ApiErrorEnvelopeModel.model_validate(payload)
        assert model.error.code == "OCR_TIMEOUT"
        assert model.error.retryable is False
        assert model.error.details.get("limitSeconds") == 60
        assert str(model.requestId) == "eeb24fb2-df80-4dcb-b22d-3a4884799c73"

    @pytest.mark.parametrize(
        "code,retryable",
        [
            ("INVALID_REQUEST", False),
            ("UNAUTHENTICATED", False),
            ("FORBIDDEN", False),
            ("ARTIFACT_NOT_FOUND", False),
            ("FILE_TOO_LARGE", False),
            ("DOCUMENT_LIMIT_EXCEEDED", False),
            ("UNSUPPORTED_MEDIA_TYPE", False),
            ("INVALID_OPTIONS", False),
            ("CORRUPT_FILE", False),
            ("ENCRYPTED_PDF", False),
            ("ANIMATED_IMAGE_UNSUPPORTED", False),
            ("SOURCE_URL_NOT_ALLOWED", False),
            ("SOURCE_UNAVAILABLE", False),
            ("OUTPUT_LIMIT_EXCEEDED", False),
            ("RATE_LIMITED", True),
            ("INTERNAL_ERROR", False),
            ("SOURCE_FETCH_FAILED", True),
            ("TABLE_EXTRACTION_FAILED", False),
            ("OCR_BUSY", True),
            ("MODEL_NOT_READY", True),
            ("SOURCE_TIMEOUT", False),
            ("OCR_TIMEOUT", False),
            ("REQUEST_TIMEOUT", False),
            ("UPLOAD_TIMEOUT", False),
        ],
    )
    def test_error_envelope_accepts_all_spec_codes(self, code: str, retryable: bool):
        payload = {
            "error": {
                "code": code,
                "message": f"Test message for {code}",
                "retryable": retryable,
                "details": {"test": True},
            },
            "requestId": str(uuid.uuid4()),
        }
        model = ApiErrorEnvelopeModel.model_validate(payload)
        assert model.error.code == code
        assert model.error.retryable is retryable
