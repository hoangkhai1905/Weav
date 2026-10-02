#!/usr/bin/env python3
"""Unit tests for ExtractTextUseCase, source normalization, and boundary enforcement."""

from __future__ import annotations

import ipaddress
import struct
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from src.application.use_cases.extract_text_use_case import ExtractTextUseCase
from src.domain.errors import (
    ArtifactNotFoundError,
    CorruptFileError,
    FileTooLargeError,
    InvalidRequestError,
    UnsupportedMediaTypeError,
)
from src.domain.models.ocr_request import (
    ArtifactSource,
    OcrRequest,
    UploadSource,
    UrlSource,
    validate_single_source,
)
from src.domain.models.ocr_result import (
    BoundingBox,
    TableResult,
    TextBlock,
)
from src.domain.ports.artifact_resolver_port import ArtifactDescriptor
from src.domain.ports.document_loader_port import LoadedDocument
from src.domain.ports.ocr_engine_port import (
    EngineOcrResult,
    ExtractionOptions,
    OcrEnginePort,
)
from src.domain.ports.table_engine_port import TableEnginePort
from src.infrastructure.files.bounded_spool import (
    MAX_FILE_BYTES,
    BoundedSpooler,
    SpooledFile,
)
from src.infrastructure.files.document_loader import DocumentLoader
from src.infrastructure.files.safe_url_fetcher import (
    DnsResolver,
    HttpResponseSeam,
    HttpTransportSeam,
    SafeUrlFetcher,
    UrlAllowlistPolicy,
)
from src.infrastructure.files.workflow_artifact_resolver import (
    DownloaderPort,
    WorkflowArtifactResolver,
    WorkflowDescriptorClientPort,
)


def _make_png(width: int = 100, height: int = 100) -> bytes:
    header = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"
    iend = b"\x00\x00\x00\x00IEND\xaeB`\x82"
    return header + ihdr + iend


class FakeDnsResolver(DnsResolver):
    def __init__(self, ip_map: dict[str, list[str]] | None = None) -> None:
        self.ip_map = ip_map or {}

    def resolve(self, host: str, port: int = 443) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        if host in self.ip_map:
            return [ipaddress.ip_address(ip) for ip in self.ip_map[host]]
        return [ipaddress.ip_address("93.184.216.34")]


class FakeHttpResponse(HttpResponseSeam):
    def __init__(self, status_code: int = 200, headers: dict[str, str] | None = None, body_chunks: list[bytes] | None = None) -> None:
        self._status_code = status_code
        self._headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._chunks = list(body_chunks or [])

    @property
    def status_code(self) -> int:
        return self._status_code

    @property
    def headers(self) -> dict[str, str]:
        return self._headers

    def read_chunk(self, chunk_size: int = 64 * 1024) -> bytes:
        if self._chunks:
            return self._chunks.pop(0)
        return b""

    def close(self) -> None:
        pass


class FakeHttpTransport(HttpTransportSeam):
    def __init__(self, handler=None) -> None:
        self.handler = handler

    def execute_request(self, method, host, pinned_ip, port, path_and_query, headers, connect_timeout, read_timeout) -> HttpResponseSeam:
        if self.handler:
            return self.handler(host, pinned_ip, path_and_query)
        return FakeHttpResponse(status_code=200, body_chunks=[b"%PDF-1.4\n%%EOF\n"])

# ---------------------------------------------------------------------------
# Test Doubles for Engine, Workflow Storage, and URL Fetcher
# ---------------------------------------------------------------------------


class FakeOcrEngine(OcrEnginePort):
    """Test fake for OCR Engine recording calls and returning deterministic text blocks."""

    def __init__(self, blocks: list[TextBlock] | None = None) -> None:
        self.call_count = 0
        self.last_options: ExtractionOptions | None = None
        self.last_document: LoadedDocument | None = None
        self.blocks = blocks if blocks is not None else [
            TextBlock(
                id="p1-b1",
                order=0,
                text="Document Title / Tiêu đề",
                confidence=0.98,
                page=1,
                boundingBox=BoundingBox(x=10.0, y=20.0, width=200.0, height=30.0),
            )
        ]

    async def extract(self, document: LoadedDocument, options: ExtractionOptions) -> EngineOcrResult:
        self.call_count += 1
        self.last_document = document
        self.last_options = options
        return EngineOcrResult(
            blocks=self.blocks,
            resolved_language="vi" if options.language in ("vi", "vi+en") else options.language,
            engine_name="fake-paddleocr",
            engine_version="3.7.0",
            model_revision="test-manifest-v1",
        )


class FakeTableEngine(TableEnginePort):
    """Test fake for Table Engine."""

    def __init__(self, tables: list[TableResult] | None = None) -> None:
        self.call_count = 0
        self.tables = tables or []

    async def extract_tables(self, document: LoadedDocument, blocks: list[TextBlock]) -> list[TableResult]:
        self.call_count += 1
        return self.tables


class FakeDescriptorClient(WorkflowDescriptorClientPort):
    """In-memory descriptor store for workflow artifacts."""

    def __init__(self, descriptors: list[ArtifactDescriptor] | None = None) -> None:
        self.descriptors: dict[tuple[str, str], ArtifactDescriptor] = {}
        for d in descriptors or []:
            self.descriptors[(str(d.workspace_id), str(d.artifact_id))] = d

    async def get_descriptor(
        self,
        workspace_id: uuid.UUID | str,
        artifact_id: uuid.UUID | str,
    ) -> ArtifactDescriptor | None:
        # Check by artifact_id regardless of workspace to enable cross-tenant lookup testing
        for (w_id, a_id), d in self.descriptors.items():
            if a_id == str(artifact_id):
                return d
        return None


class FakeDownloader(DownloaderPort):
    """In-memory downloader test double tracking download invocations."""

    def __init__(self, content_map: dict[str, bytes] | None = None) -> None:
        self.content_map = content_map or {}
        self.call_count = 0
        self.downloaded_urls: list[str] = []

    async def download(
        self,
        download_url: str,
        target_dir: Path,
        filename: str | None = None,
    ) -> SpooledFile:
        self.call_count += 1
        self.downloaded_urls.append(download_url)
        content = self.content_map.get(download_url, _make_png(100, 100))
        target_path = target_dir / (filename or "download.png")
        target_path.write_bytes(content)
        return SpooledFile(
            file_path=target_path,
            file_name=filename or "download.png",
            size_bytes=len(content),
            temp_dir=target_dir,
        )


# ---------------------------------------------------------------------------
# Unit Tests: Concrete Assertions and Core Use Case Behavior
# ---------------------------------------------------------------------------


class TestExtractTextUseCase:
    """Validates use case orchestration, boundary gates, and source normalization."""

    @pytest.fixture
    def document_loader(self) -> DocumentLoader:
        return DocumentLoader()

    @pytest.fixture
    def fake_engine(self) -> FakeOcrEngine:
        return FakeOcrEngine()

    @pytest.mark.asyncio
    async def test_oversized_chunked_stream_raises_413_and_engine_never_called(
        self, document_loader: DocumentLoader, fake_engine: FakeOcrEngine, tmp_path: Path
    ):
        """Concrete assertion: 10,485,761-byte chunked PNG -> 413 FILE_TOO_LARGE; engine.call_count == 0."""
        use_case = ExtractTextUseCase(
            document_loader=document_loader,
            ocr_engine=fake_engine,
            spooler=BoundedSpooler(max_bytes=MAX_FILE_BYTES, temp_root=tmp_path),
        )

        # 10 MiB + 1 byte = 10,485,761 bytes
        oversized_bytes = b"P" * (MAX_FILE_BYTES + 1)

        async def chunk_stream() -> AsyncIterator[bytes]:
            yield oversized_bytes

        request = OcrRequest(
            requestId=uuid.uuid4(),
            source=UploadSource(stream=chunk_stream(), filename="overflow.png"),
            language="vi+en",
            detectTables=True,
        )

        with pytest.raises(FileTooLargeError) as exc_info:
            await use_case.execute(request)

        assert exc_info.value.code == "FILE_TOO_LARGE"
        assert exc_info.value.status_code == 413
        # Engine was NEVER called
        assert fake_engine.call_count == 0

    @pytest.mark.asyncio
    async def test_cross_tenant_artifact_raises_404_and_downloader_never_called(
        self, document_loader: DocumentLoader, fake_engine: FakeOcrEngine, tmp_path: Path
    ):
        """Concrete assertion: workspace A context + workspace B artifact -> 404; downloader.call_count == 0."""
        workspace_a = uuid.uuid4()
        workspace_b = uuid.uuid4()
        artifact_b_id = uuid.uuid4()

        # Artifact B belongs to Workspace B
        descriptor_b = ArtifactDescriptor(
            artifact_id=artifact_b_id,
            workspace_id=workspace_b,
            download_url="https://storage.weav.internal/workspaces/b/files/doc.png",
            file_name="invoice_b.png",
            mime_type="image/png",
            size_bytes=1024,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
            is_deleted=False,
        )

        client = FakeDescriptorClient([descriptor_b])
        downloader = FakeDownloader()
        resolver = WorkflowArtifactResolver(descriptor_client=client, downloader=downloader)

        use_case = ExtractTextUseCase(
            document_loader=document_loader,
            ocr_engine=fake_engine,
            artifact_resolver=resolver,
            spooler=BoundedSpooler(temp_root=tmp_path),
        )

        # Request attempts to access Artifact B using Workspace A's context
        request = OcrRequest(
            requestId=uuid.uuid4(),
            workspaceId=workspace_a,
            source=ArtifactSource(artifactId=artifact_b_id),
            language="vi+en",
            detectTables=True,
        )

        with pytest.raises(ArtifactNotFoundError) as exc_info:
            await use_case.execute(request)

        assert exc_info.value.code == "ARTIFACT_NOT_FOUND"
        assert exc_info.value.status_code == 404
        # Downloader was NEVER invoked for cross-tenant request
        assert downloader.call_count == 0
        # Engine was NEVER invoked
        assert fake_engine.call_count == 0

    def test_mixed_file_and_source_json_raises_invalid_request(self):
        """Concrete assertion: file bytes + source JSON in one request -> 400 INVALID_REQUEST."""
        async def dummy_stream() -> AsyncIterator[bytes]:
            yield b"test-data"

        source_json = {
            "source": {
                "type": "artifact",
                "artifactId": str(uuid.uuid4()),
            }
        }

        with pytest.raises(InvalidRequestError) as exc_info:
            validate_single_source(
                upload_stream=dummy_stream(),
                filename="test.png",
                source_payload=source_json,
            )

        assert exc_info.value.code == "INVALID_REQUEST"
        assert exc_info.value.status_code == 400
        assert "Multiple document sources provided" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_corrupt_file_fails_validation_without_calling_engine(
        self, document_loader: DocumentLoader, fake_engine: FakeOcrEngine, tmp_path: Path
    ):
        use_case = ExtractTextUseCase(
            document_loader=document_loader,
            ocr_engine=fake_engine,
            spooler=BoundedSpooler(temp_root=tmp_path),
        )

        async def corrupt_stream() -> AsyncIterator[bytes]:
            yield b"GARBAGE_NOT_A_PNG_FILE"

        request = OcrRequest(
            requestId=uuid.uuid4(),
            source=UploadSource(stream=corrupt_stream(), filename="corrupt.png"),
            language="vi+en",
            detectTables=True,
        )

        with pytest.raises(CorruptFileError) as exc_info:
            await use_case.execute(request)

        assert exc_info.value.code == "CORRUPT_FILE"
        assert fake_engine.call_count == 0

    @pytest.mark.asyncio
    async def test_unsupported_media_type_fails_without_calling_engine(
        self, document_loader: DocumentLoader, fake_engine: FakeOcrEngine, tmp_path: Path
    ):
        use_case = ExtractTextUseCase(
            document_loader=document_loader,
            ocr_engine=fake_engine,
            spooler=BoundedSpooler(temp_root=tmp_path),
        )

        async def gif_stream() -> AsyncIterator[bytes]:
            yield b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04"

        request = OcrRequest(
            requestId=uuid.uuid4(),
            source=UploadSource(stream=gif_stream(), filename="sample.gif"),
            language="vi+en",
            detectTables=True,
        )

        with pytest.raises(UnsupportedMediaTypeError) as exc_info:
            await use_case.execute(request)

        assert exc_info.value.code == "UNSUPPORTED_MEDIA_TYPE"
        assert fake_engine.call_count == 0

    @pytest.mark.asyncio
    async def test_source_equivalence_upload_artifact_url_produce_identical_normalized_results(
        self, document_loader: DocumentLoader, fake_engine: FakeOcrEngine, tmp_path: Path
    ):
        """Upload, artifact, and URL supplying identical bytes/options yield identical normalized results."""
        common_bytes = _make_png(width=500, height=300)
        workspace_id = uuid.uuid4()
        artifact_id = uuid.uuid4()
        req_id = uuid.uuid4()

        # 1. Setup artifact resolver
        descriptor = ArtifactDescriptor(
            artifact_id=artifact_id,
            workspace_id=workspace_id,
            download_url="https://files.example.com/approved/test.png",
            file_name="document.png",
            mime_type="image/png",
            size_bytes=len(common_bytes),
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            is_deleted=False,
        )
        artifact_client = FakeDescriptorClient([descriptor])
        downloader = FakeDownloader({"https://files.example.com/approved/test.png": common_bytes})
        artifact_resolver = WorkflowArtifactResolver(descriptor_client=artifact_client, downloader=downloader)

        # 2. Setup URL fetcher
        dns = FakeDnsResolver({"files.example.com": ["93.184.216.34"]})

        def response_handler(host: str, ip: str, path: str) -> FakeHttpResponse:
            return FakeHttpResponse(status_code=200, body_chunks=[common_bytes])

        transport = FakeHttpTransport(handler=response_handler)
        policy = UrlAllowlistPolicy(allowed_domains={"files.example.com"})
        url_fetcher = SafeUrlFetcher(policy=policy, dns_resolver=dns, transport=transport)

        use_case = ExtractTextUseCase(
            document_loader=document_loader,
            ocr_engine=fake_engine,
            artifact_resolver=artifact_resolver,
            url_fetcher=url_fetcher,
            spooler=BoundedSpooler(temp_root=tmp_path),
        )

        # Run 1: Upload source
        async def upload_stream() -> AsyncIterator[bytes]:
            yield common_bytes

        req_upload = OcrRequest(
            requestId=req_id,
            source=UploadSource(stream=upload_stream(), filename="document.png"),
            language="vi+en",
            detectTables=False,
        )
        res_upload = await use_case.execute(req_upload)

        # Run 2: Artifact source
        req_artifact = OcrRequest(
            requestId=req_id,
            workspaceId=workspace_id,
            source=ArtifactSource(artifactId=artifact_id),
            language="vi+en",
            detectTables=False,
        )
        res_artifact = await use_case.execute(req_artifact)

        # Run 3: URL source
        req_url = OcrRequest(
            requestId=req_id,
            source=UrlSource(fileUrl="https://files.example.com/approved/test.png"),
            language="vi+en",
            detectTables=False,
        )
        res_url = await use_case.execute(req_url)

        # Verify equivalence across all three source types
        assert res_upload.schemaVersion == res_artifact.schemaVersion == res_url.schemaVersion == "1.0"
        assert res_upload.text.rawText == res_artifact.text.rawText == res_url.text.rawText
        assert res_upload.confidence == res_artifact.confidence == res_url.confidence
        assert res_upload.document.mimeType == res_artifact.document.mimeType == res_url.document.mimeType == "image/png"
        assert res_upload.document.pages == res_artifact.document.pages == res_url.document.pages == 1
        assert res_upload.document.pageInfo[0].width == res_artifact.document.pageInfo[0].width == res_url.document.pageInfo[0].width == 500
        assert res_upload.document.pageInfo[0].height == res_artifact.document.pageInfo[0].height == res_url.document.pageInfo[0].height == 300
        assert len(res_upload.blocks) == len(res_artifact.blocks) == len(res_url.blocks) == 1
        assert res_upload.metadata.quality == res_artifact.metadata.quality == res_url.metadata.quality == "OK"
