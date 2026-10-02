#!/usr/bin/env python3
"""Application use case for extracting document text, bounding boxes, and optional tables."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from src.domain.errors import (
    ArtifactNotFoundError,
    InternalError,
    InvalidRequestError,
    OcrDomainError,
    OutputLimitExceededError,
    TableExtractionFailedError,
)
from src.domain.models.ocr_request import (
    ArtifactSource,
    OcrRequest,
    UploadSource,
    UrlSource,
)
from src.domain.models.ocr_result import (
    DocumentInfo,
    ExtractionMetadata,
    OcrExtractionResult,
    TableResult,
    TextResult,
    calculate_weighted_confidence,
    normalize_raw_text,
)
from src.domain.ports.artifact_resolver_port import ArtifactResolverPort
from src.domain.ports.document_loader_port import DocumentLoaderPort, LoadedDocument
from src.domain.ports.ocr_engine_port import ExtractionOptions, OcrEnginePort
from src.domain.ports.table_engine_port import TableEnginePort
from src.infrastructure.files.bounded_spool import (
    MAX_FILE_BYTES,
    BoundedSpooler,
)
from src.infrastructure.files.safe_url_fetcher import SafeUrlFetcher


class ExtractTextUseCase:
    """Orchestrates document ingestion, validation, OCR inference, and result normalization.

    Strictly framework-independent (no FastAPI or Paddle dependencies).
    Guarantees:
    - Single source validation before any engine invocation
    - Strict 10 MiB byte cap enforcement across all sources
    - Normalization across upload, artifact, and URL sources
    - Complete cleanup of per-request temporary storage
    """

    def __init__(
        self,
        document_loader: DocumentLoaderPort,
        ocr_engine: OcrEnginePort,
        artifact_resolver: ArtifactResolverPort | None = None,
        url_fetcher: SafeUrlFetcher | None = None,
        table_engine: TableEnginePort | None = None,
        spooler: BoundedSpooler | None = None,
    ) -> None:
        self.document_loader = document_loader
        self.ocr_engine = ocr_engine
        self.artifact_resolver = artifact_resolver
        self.url_fetcher = url_fetcher
        self.table_engine = table_engine
        self.spooler = spooler or BoundedSpooler(max_bytes=MAX_FILE_BYTES)

    async def execute(self, request: OcrRequest) -> OcrExtractionResult:
        """Execute document extraction for the given validated OcrRequest."""
        start_time = time.monotonic()

        # Validate that exactly one source is present
        if request.source is None:
            raise InvalidRequestError("Document source is required")

        # Create an isolated, per-request temporary directory
        temp_dir = self.spooler.create_per_request_dir()

        try:
            spooled_path: Path
            spooled_filename: str

            # 1. Ingest source into bounded per-request spool
            if isinstance(request.source, UploadSource):
                spooled = await self.spooler.spool(
                    stream=request.source.stream,
                    client_filename=request.source.filename,
                    target_dir=temp_dir,
                )
                spooled_path = spooled.file_path
                spooled_filename = spooled.file_name

            elif isinstance(request.source, ArtifactSource):
                if self.artifact_resolver is None:
                    raise InternalError("Artifact resolver is not configured")
                if not request.workspace_id:
                    raise ArtifactNotFoundError("Workspace context is required to resolve artifacts")

                spooled_path, descriptor = await self.artifact_resolver.resolve_and_download(
                    workspace_id=request.workspace_id,
                    artifact_id=request.source.artifact_id,
                    target_dir=temp_dir,
                )
                spooled_filename = descriptor.file_name

            elif isinstance(request.source, UrlSource):
                if self.url_fetcher is None:
                    raise InternalError("URL fetcher is not configured")

                spooled = await self.url_fetcher.fetch(
                    url=request.source.file_url,
                    target_dir=temp_dir,
                )
                spooled_path = spooled.file_path
                spooled_filename = spooled.file_name
            else:
                raise InvalidRequestError(f"Unsupported source type: {type(request.source).__name__}")

            # 2. Document loading & magic byte / decoder validation (BEFORE engine call)
            loaded_doc: LoadedDocument = self.document_loader.validate_and_load(
                file_path=spooled_path,
                client_filename=spooled_filename,
            )

            # 3. Engine OCR extraction
            engine_options = ExtractionOptions(
                language=request.language,
                detect_tables=request.detect_tables,
            )
            engine_result = await self.ocr_engine.extract(loaded_doc, engine_options)

            # 4. Optional table pipeline
            tables: list[TableResult] = []
            table_status = "not_requested"
            if request.detect_tables:
                if self.table_engine is None:
                    raise TableExtractionFailedError(
                        "Table extraction was requested but the table engine is not configured"
                    )
                try:
                    tables = await self.table_engine.extract_tables(loaded_doc, engine_result.blocks)
                except OcrDomainError:
                    raise
                except Exception as exc:
                    raise TableExtractionFailedError("Table extraction pipeline failed") from exc
                cell_count = sum(len(table.cells) for table in tables)
                if len(tables) > 100:
                    raise OutputLimitExceededError("Extracted table count exceeds limit of 100")
                if cell_count > 10_000:
                    raise OutputLimitExceededError("Extracted cell count exceeds limit of 10000")
                table_status = "completed"

            # 5. Output normalization
            raw_text = engine_result.raw_text
            if raw_text is None:
                raw_text = normalize_raw_text(engine_result.blocks, loaded_doc.pages)

            confidence, quality = calculate_weighted_confidence(engine_result.blocks)

            elapsed_ms = max(0, int((time.monotonic() - start_time) * 1000))

            metadata = ExtractionMetadata(
                language=request.language,
                resolvedLanguage=engine_result.resolved_language,
                processingTimeMs=elapsed_ms,
                engine=engine_result.engine_name,
                engineVersion=engine_result.engine_version,
                modelRevision=engine_result.model_revision,
                tableDetection=table_status,  # type: ignore[arg-type]
                quality=quality,
                preprocessing=engine_result.preprocessing,
                warnings=engine_result.warnings,
            )

            document_info = DocumentInfo(
                fileName=loaded_doc.file_name,
                mimeType=loaded_doc.mime_type,
                pages=loaded_doc.pages,
                pageInfo=loaded_doc.page_info,
            )

            return OcrExtractionResult(
                schemaVersion="1.0",
                requestId=request.request_id,
                document=document_info,
                text=TextResult(rawText=raw_text),
                confidence=confidence,
                blocks=engine_result.blocks,
                tables=tables,
                metadata=metadata,
            )

        finally:
            # Explicit cleanup ownership: clean up per-request temp directory safely
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
