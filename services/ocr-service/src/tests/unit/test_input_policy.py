#!/usr/bin/env python3
"""Unit tests for file ingestion policy, bounded spooling, and document loader format inspection."""

from __future__ import annotations

import asyncio
import struct
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from src.domain.errors import (
    AnimatedImageUnsupportedError,
    CorruptFileError,
    DocumentLimitExceededError,
    EncryptedPdfError,
    FileTooLargeError,
    UnsupportedMediaTypeError,
)
from src.infrastructure.files.bounded_spool import (
    MAX_FILE_BYTES,
    BoundedSpooler,
    sanitize_basename,
)
from src.infrastructure.files.document_loader import DocumentLoader

# ---------------------------------------------------------------------------
# Synthetic Document Byte Helpers
# ---------------------------------------------------------------------------


def make_minimal_png(width: int = 100, height: int = 100) -> bytes:
    """Construct minimal valid PNG bytes with IHDR and IEND chunks."""
    header = b"\x89PNG\r\n\x1a\n"
    # IHDR chunk: 13 bytes data (width, height, 8 bit, RGB, etc.)
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"
    iend = b"\x00\x00\x00\x00IEND\xaeB`\x82"
    return header + ihdr + iend


def make_minimal_jpeg(width: int = 100, height: int = 100) -> bytes:
    """Construct minimal valid JPEG byte stream with SOF0 marker."""
    soi = b"\xff\xd8"
    # SOF0 segment: length 17 (0x0011), precision 8, height, width, 3 components
    sof0 = b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", height, width) + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    eoi = b"\xff\xd9"
    return soi + sof0 + eoi


def make_minimal_webp(width: int = 100, height: int = 100, animated: bool = False) -> bytes:
    """Construct minimal valid WEBP byte stream."""
    chunk_fourcc = b"VP8X"
    flags = 0x02 if animated else 0x00
    # Canvas width and height are 24-bit 0-based
    w_bytes = struct.pack("<I", width - 1)[:3]
    h_bytes = struct.pack("<I", height - 1)[:3]
    payload = struct.pack("<B", flags) + b"\x00\x00\x00" + w_bytes + h_bytes
    chunk = chunk_fourcc + struct.pack("<I", len(payload)) + payload

    total_len = 4 + len(chunk)
    riff_header = b"RIFF" + struct.pack("<I", total_len) + b"WEBP"
    return riff_header + chunk


def make_minimal_pdf(pages: int = 1, encrypted: bool = False) -> bytes:
    """Construct minimal valid PDF structure with declared page count."""
    encrypt_entry = b"/Encrypt 4 0 R" if encrypted else b""
    encrypt_obj = b"4 0 obj\n<< /Filter /Standard /V 2 >>\nendobj\n" if encrypted else b""

    content = f"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count {pages} >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
{encrypt_obj.decode('ascii')}
xref
0 4
trailer
<< /Root 1 0 R {encrypt_entry.decode('ascii')} >>
startxref
120
%%EOF
""".encode("ascii")
    return content


# ---------------------------------------------------------------------------
# Unit Tests: Bounded Spooling and Filename Sanitization
# ---------------------------------------------------------------------------


class TestBoundedSpooling:
    """Tests bounded stream spooling, 10 MiB limit, sanitization, and cleanup."""

    def test_sanitize_basename_eliminates_path_traversal(self):
        assert sanitize_basename("../../etc/passwd") == "passwd"
        assert sanitize_basename("..\\..\\secret.pdf") == "secret.pdf"
        assert sanitize_basename("C:\\Windows\\System32\\cmd.exe") == "cmd.exe"
        assert sanitize_basename("/var/log/app.log") == "app.log"
        assert sanitize_basename("...hidden.png") == "hidden.png"
        assert sanitize_basename("") == "document.bin"
        assert sanitize_basename("   ") == "document.bin"
        assert sanitize_basename(None) == "document.bin"

    def test_sanitize_basename_removes_dangerous_characters(self):
        # Replaces null bytes, control chars, quotes, colons, wildcards
        cleaned = sanitize_basename("invoice\x00test:2026*?.pdf")
        assert "\x00" not in cleaned
        assert ":" not in cleaned
        assert "*" not in cleaned
        assert "?" not in cleaned
        assert cleaned.endswith(".pdf")

    @pytest.mark.asyncio
    async def test_spool_exactly_10_mib_succeeds(self, tmp_path: Path):
        spooler = BoundedSpooler(max_bytes=MAX_FILE_BYTES, temp_root=tmp_path)
        # 10 MiB = 10,485,760 bytes
        chunk_size = 1024 * 1024
        chunks = [b"A" * chunk_size for _ in range(10)]

        async def chunk_stream() -> AsyncIterator[bytes]:
            for c in chunks:
                yield c

        spooled = await spooler.spool(chunk_stream(), client_filename="large.dat")
        try:
            assert spooled.size_bytes == 10_485_760
            assert spooled.file_path.exists()
            assert spooled.file_name == "large.dat"
        finally:
            spooled.cleanup()

        assert not spooled.file_path.exists()

    @pytest.mark.asyncio
    async def test_spool_10_mib_plus_one_byte_raises_file_too_large(self, tmp_path: Path):
        """10,485,761-byte chunked stream must raise typed 413 FILE_TOO_LARGE."""
        spooler = BoundedSpooler(max_bytes=MAX_FILE_BYTES, temp_root=tmp_path)

        # 10 MiB + 1 byte = 10,485,761 bytes
        chunk = b"X" * (MAX_FILE_BYTES + 1)

        async def chunk_stream() -> AsyncIterator[bytes]:
            yield chunk

        with pytest.raises(FileTooLargeError) as exc_info:
            await spooler.spool(chunk_stream(), client_filename="overflow.png")

        err = exc_info.value
        assert err.code == "FILE_TOO_LARGE"
        assert err.status_code == 413

    @pytest.mark.asyncio
    async def test_spool_context_guarantees_cleanup_on_cancellation(self, tmp_path: Path):
        spooler = BoundedSpooler(temp_root=tmp_path)
        temp_dir = spooler.create_per_request_dir()

        async def hanging_stream() -> AsyncIterator[bytes]:
            yield b"initial-chunk"
            await asyncio.sleep(10.0)
            yield b"second-chunk"

        task = asyncio.create_task(
            spooler.spool(hanging_stream(), client_filename="test.png", target_dir=temp_dir)
        )
        await asyncio.sleep(0.05)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        # Check partial spool file is removed
        spool_files = list(temp_dir.glob("*.dat"))
        assert len(spool_files) == 0


# ---------------------------------------------------------------------------
# Unit Tests: Document Loader Magic Bytes and Media Types
# ---------------------------------------------------------------------------


class TestDocumentLoader:
    """Tests magic byte inspection, canonical MIME identification, and decoder limits."""

    @pytest.fixture
    def loader(self) -> DocumentLoader:
        return DocumentLoader()

    def test_load_valid_png(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "valid.png"
        file_path.write_bytes(make_minimal_png(width=800, height=600))

        doc = loader.validate_and_load(file_path, client_filename="upload.png")
        assert doc.mime_type == "image/png"
        assert doc.pages == 1
        assert len(doc.page_info) == 1
        assert doc.page_info[0].width == 800
        assert doc.page_info[0].height == 600
        assert doc.page_info[0].dpi is None

    def test_load_valid_jpeg(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "valid.jpg"
        file_path.write_bytes(make_minimal_jpeg(width=1024, height=768))

        doc = loader.validate_and_load(file_path, client_filename="photo.jpg")
        assert doc.mime_type == "image/jpeg"
        assert doc.pages == 1
        assert doc.page_info[0].width == 1024
        assert doc.page_info[0].height == 768

    def test_load_valid_webp(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "valid.webp"
        file_path.write_bytes(make_minimal_webp(width=640, height=480, animated=False))

        doc = loader.validate_and_load(file_path, client_filename="image.webp")
        assert doc.mime_type == "image/webp"
        assert doc.pages == 1
        assert doc.page_info[0].width == 640
        assert doc.page_info[0].height == 480

    def test_load_valid_pdf(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "report.pdf"
        file_path.write_bytes(make_minimal_pdf(pages=3))

        doc = loader.validate_and_load(file_path, client_filename="report.pdf")
        assert doc.mime_type == "application/pdf"
        assert doc.pages == 3
        assert len(doc.page_info) == 3
        assert doc.page_info[0].page == 1
        assert doc.page_info[2].page == 3
        assert doc.page_info[0].dpi == 200

    def test_reject_fake_png_extension_with_corrupt_file(self, loader: DocumentLoader, tmp_path: Path):
        # Extension is .png, but content is arbitrary ASCII text
        file_path = tmp_path / "fake.png"
        file_path.write_bytes(b"This is not a real PNG image, just plain text!")

        with pytest.raises(CorruptFileError) as exc_info:
            loader.validate_and_load(file_path, client_filename="fake.png")

        assert exc_info.value.code == "CORRUPT_FILE"
        assert exc_info.value.status_code == 422

    def test_reject_unsupported_gif_media_type(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "sample.gif"
        file_path.write_bytes(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04")

        with pytest.raises(UnsupportedMediaTypeError) as exc_info:
            loader.validate_and_load(file_path, client_filename="sample.gif")

        assert exc_info.value.code == "UNSUPPORTED_MEDIA_TYPE"
        assert exc_info.value.status_code == 415

    def test_reject_fake_extension_with_unsupported_gif_content(
        self, loader: DocumentLoader, tmp_path: Path
    ):
        # Claims to be .png, but magic bytes are GIF
        file_path = tmp_path / "disguised.png"
        file_path.write_bytes(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04")

        with pytest.raises(UnsupportedMediaTypeError) as exc_info:
            loader.validate_and_load(file_path, client_filename="disguised.png")

        assert exc_info.value.code == "UNSUPPORTED_MEDIA_TYPE"
        assert exc_info.value.status_code == 415

    def test_reject_animated_webp(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "animated.webp"
        file_path.write_bytes(make_minimal_webp(width=200, height=200, animated=True))

        with pytest.raises(AnimatedImageUnsupportedError) as exc_info:
            loader.validate_and_load(file_path, client_filename="animated.webp")

        assert exc_info.value.code == "ANIMATED_IMAGE_UNSUPPORTED"
        assert exc_info.value.status_code == 422

    def test_reject_encrypted_pdf(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "locked.pdf"
        file_path.write_bytes(make_minimal_pdf(pages=1, encrypted=True))

        with pytest.raises(EncryptedPdfError) as exc_info:
            loader.validate_and_load(file_path, client_filename="locked.pdf")

        assert exc_info.value.code == "ENCRYPTED_PDF"
        assert exc_info.value.status_code == 422

    def test_reject_pdf_exceeding_ten_pages(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "huge.pdf"
        # 11 pages exceeds the 10 page limit
        file_path.write_bytes(make_minimal_pdf(pages=11))

        with pytest.raises(DocumentLimitExceededError) as exc_info:
            loader.validate_and_load(file_path, client_filename="huge.pdf")

        assert exc_info.value.code == "DOCUMENT_LIMIT_EXCEEDED"
        assert exc_info.value.status_code == 413
        assert "exceeds maximum allowed limit of 10 pages" in str(exc_info.value)

    def test_reject_image_dimension_exceeding_limit(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "oversized.png"
        # 10001 exceeds MAX_DIMENSION_PX (10000)
        file_path.write_bytes(make_minimal_png(width=10001, height=100))

        with pytest.raises(DocumentLimitExceededError) as exc_info:
            loader.validate_and_load(file_path, client_filename="oversized.png")

        assert exc_info.value.code == "DOCUMENT_LIMIT_EXCEEDED"
        assert exc_info.value.status_code == 413

    def test_reject_empty_file(self, loader: DocumentLoader, tmp_path: Path):
        file_path = tmp_path / "empty.png"
        file_path.write_bytes(b"")

        with pytest.raises(CorruptFileError) as exc_info:
            loader.validate_and_load(file_path, client_filename="empty.png")

        assert exc_info.value.code == "CORRUPT_FILE"
        assert exc_info.value.status_code == 422
