#!/usr/bin/env python3
"""Document loader inspecting magic bytes, decoders, and canonical media types."""

from __future__ import annotations

import re
import struct
from pathlib import Path

from src.domain.errors import (
    AnimatedImageUnsupportedError,
    CorruptFileError,
    DocumentLimitExceededError,
    EncryptedPdfError,
    UnsupportedMediaTypeError,
)
from src.domain.models.ocr_result import PageInfo
from src.domain.ports.document_loader_port import DocumentLoaderPort, LoadedDocument
from src.infrastructure.files.bounded_spool import sanitize_basename

# Limits from Spec Section 4
MAX_PAGES = 10
MAX_DIMENSION_PX = 10000
MAX_MEGAPIXELS_PER_PAGE = 20.0  # 20 million pixels
DEFAULT_PDF_DPI = 200

# Magic signatures
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC_PREFIX = b"\xff\xd8\xff"
WEBP_RIFF = b"RIFF"
WEBP_WEBP = b"WEBP"
PDF_MAGIC_PREFIX = b"%PDF-"

KNOWN_UNSUPPORTED_SIGNATURES: list[tuple[bytes, str]] = [
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"II*\x00", "image/tiff"),
    (b"MM\x00*", "image/tiff"),
    (b"BM", "image/bmp"),
    (b"<?xml", "image/svg+xml"),
    (b"<svg", "image/svg+xml"),
    (b"PK\x03\x04", "application/zip"),
    (b"%!PS", "application/postscript"),
]


class DocumentLoader(DocumentLoaderPort):
    """Inspects file bytes, validates format decoders, and enforces geometry/page limits.

    Never relies on client filename extension or client Content-Type alone.
    Does NOT perform PDF rasterization or OCR inference.
    """

    def validate_and_load(
        self,
        file_path: Path,
        client_filename: str | None = None,
    ) -> LoadedDocument:
        """Inspect magic bytes, verify decoder validity and canonical MIME type, enforce limits."""
        if not file_path.exists() or not file_path.is_file():
            raise CorruptFileError("Document file does not exist or is not a regular file")

        size_bytes = file_path.stat().st_size
        if size_bytes == 0:
            raise CorruptFileError("Document file is empty (0 bytes)")

        safe_name = sanitize_basename(client_filename or file_path.name)
        lower_ext = safe_name.lower().rsplit(".", 1)[-1] if "." in safe_name else ""

        # Read header slice
        with open(file_path, "rb") as f:
            header = f.read(4096)

        # 1. Check for known unsupported media formats
        for sig, mime in KNOWN_UNSUPPORTED_SIGNATURES:
            if header.startswith(sig):
                raise UnsupportedMediaTypeError(
                    f"Unsupported media type '{mime}'. Supported types: image/png, image/jpeg, image/webp, application/pdf"
                )

        # 2. Check PNG
        if header.startswith(PNG_MAGIC):
            return self._load_png(file_path, safe_name, size_bytes)

        # 3. Check JPEG
        if header.startswith(JPEG_MAGIC_PREFIX):
            return self._load_jpeg(file_path, safe_name, size_bytes)

        # 4. Check WEBP
        if len(header) >= 12 and header[:4] == WEBP_RIFF and header[8:12] == WEBP_WEBP:
            return self._load_webp(file_path, safe_name, size_bytes, header)

        # 5. Check PDF (starts with %PDF- within the first 1024 bytes)
        pdf_offset = header.find(PDF_MAGIC_PREFIX)
        if pdf_offset != -1 and pdf_offset < 1024:
            return self._load_pdf(file_path, safe_name, size_bytes)

        # Content failed all supported magic signatures.
        # If client filename claimed a supported extension, treat as corrupt/fake file.
        if lower_ext in ("png", "jpg", "jpeg", "webp", "pdf"):
            raise CorruptFileError(
                f"File '{safe_name}' claims to be a supported {lower_ext.upper()} document, "
                "but file content failed decoder signature validation"
            )

        raise UnsupportedMediaTypeError(
            "Unsupported or unrecognized media type. Supported types: image/png, image/jpeg, image/webp, application/pdf"
        )

    def _load_png(self, file_path: Path, safe_name: str, size_bytes: int) -> LoadedDocument:
        with open(file_path, "rb") as f:
            header = f.read(32)

        if len(header) < 24 or header[12:16] != b"IHDR":
            raise CorruptFileError("PNG file is missing or contains invalid IHDR header")

        width, height = struct.unpack(">II", header[16:24])
        if width == 0 or height == 0:
            raise CorruptFileError("PNG image has invalid 0 dimensions")

        self._check_image_limits(width, height)

        page_info = [PageInfo(page=1, width=width, height=height, dpi=None)]
        return LoadedDocument(
            file_path=file_path,
            file_name=safe_name,
            mime_type="image/png",
            size_bytes=size_bytes,
            pages=1,
            page_info=page_info,
        )

    def _load_jpeg(self, file_path: Path, safe_name: str, size_bytes: int) -> LoadedDocument:
        with open(file_path, "rb") as f:
            data = f.read()

        # Parse JPEG markers for SOF0/SOF1/SOF2 (Start of Frame)
        idx = 2
        width, height = 0, 0
        while idx < len(data) - 8:
            if data[idx] != 0xFF:
                idx += 1
                continue
            marker = data[idx + 1]
            # SOF markers: 0xC0 (baseline), 0xC1 (extended), 0xC2 (progressive)
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[idx + 5 : idx + 9])
                height, width = h, w
                break
            # Skip marker segment length
            if marker not in (0xD8, 0xD9, 0x00):
                if idx + 3 >= len(data):
                    break
                seg_len = struct.unpack(">H", data[idx + 2 : idx + 4])[0]
                idx += 2 + seg_len
            else:
                idx += 2

        if width == 0 or height == 0:
            raise CorruptFileError("JPEG file is corrupt or SOF dimensions could not be read")

        self._check_image_limits(width, height)

        page_info = [PageInfo(page=1, width=width, height=height, dpi=None)]
        return LoadedDocument(
            file_path=file_path,
            file_name=safe_name,
            mime_type="image/jpeg",
            size_bytes=size_bytes,
            pages=1,
            page_info=page_info,
        )

    def _load_webp(self, file_path: Path, safe_name: str, size_bytes: int, header: bytes) -> LoadedDocument:
        with open(file_path, "rb") as f:
            data = f.read()

        if len(data) < 30:
            raise CorruptFileError("WEBP file is truncated or corrupted")

        # Search for ANIM chunk
        if b"ANIM" in data[:1024]:
            raise AnimatedImageUnsupportedError("Animated WEBP documents are not supported")

        chunk_fourcc = data[12:16]
        width, height = 0, 0

        if chunk_fourcc == b"VP8X":
            # VP8X extended header: check animation flag (bit 1 of byte 20)
            flags = data[20]
            if flags & 0x02 != 0:
                raise AnimatedImageUnsupportedError("Animated WEBP documents are not supported")

            # Canvas width and height are 24-bit ints at bytes 24-27 and 27-30 (1-based)
            w_bytes = data[24:27] + b"\x00"
            h_bytes = data[27:30] + b"\x00"
            width = struct.unpack("<I", w_bytes)[0] + 1
            height = struct.unpack("<I", h_bytes)[0] + 1

        elif chunk_fourcc == b"VP8 ":
            # Simple lossy format
            if len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
                w, h = struct.unpack("<HH", data[26:30])
                width = w & 0x3FFF
                height = h & 0x3FFF
            else:
                width, height = 800, 600

        elif chunk_fourcc == b"VP8L":
            # Simple lossless format
            if len(data) >= 25 and data[20] == 0x2F:
                b1, b2, b3, b4 = data[21:25]
                width = 1 + (((b2 & 0x3F) << 8) | b1)
                height = 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6))
            else:
                width, height = 800, 600
        else:
            raise CorruptFileError(f"Unrecognized WEBP format chunk: {chunk_fourcc!r}")

        if width == 0 or height == 0:
            raise CorruptFileError("WEBP image has invalid 0 dimensions")

        self._check_image_limits(width, height)

        page_info = [PageInfo(page=1, width=width, height=height, dpi=None)]
        return LoadedDocument(
            file_path=file_path,
            file_name=safe_name,
            mime_type="image/webp",
            size_bytes=size_bytes,
            pages=1,
            page_info=page_info,
        )

    def _load_pdf(self, file_path: Path, safe_name: str, size_bytes: int) -> LoadedDocument:
        with open(file_path, "rb") as f:
            content = f.read()

        # Reject malformed/empty PDF
        if len(content) < 32:
            raise CorruptFileError("PDF file is truncated or corrupted")

        # Reject encrypted PDF
        if b"/Encrypt" in content:
            raise EncryptedPdfError("Encrypted or password-protected PDF is not supported")

        # Check for malformed PDF structure (must contain %%EOF or valid object stream)
        if b"%%EOF" not in content and b"/Root" not in content and b"/Pages" not in content:
            raise CorruptFileError("PDF structure is malformed or corrupt")

        # Count pages using structural markers
        # Try /Type /Pages /Count N
        page_counts = re.findall(rb"/Type\s*/Pages\b.*?/Count\s+(\d+)", content, re.DOTALL)
        total_pages = 0
        if page_counts:
            # The root Pages node holds the total page count
            total_pages = max(int(c) for c in page_counts)
        else:
            # Fallback: count /Type /Page (singular) definitions
            pages_found = re.findall(rb"/Type\s*/Page\b", content)
            total_pages = len(pages_found)

        if total_pages == 0:
            raise CorruptFileError("PDF contains 0 valid pages or has corrupt page tree")

        if total_pages > MAX_PAGES:
            raise DocumentLimitExceededError(
                f"PDF page count ({total_pages}) exceeds maximum allowed limit of {MAX_PAGES} pages"
            )

        # Extract MediaBox dimensions if present (default to standard 200 DPI dimensions ~ 1654x2339)
        mediabox = re.search(rb"/MediaBox\s*\[\s*([\d\.\s\-]+)\]", content)
        width_px = 1654
        height_px = 2339
        if mediabox:
            parts = mediabox.group(1).split()
            if len(parts) >= 4:
                try:
                    llx, lly, urx, ury = [float(p) for p in parts[:4]]
                    pt_w = abs(urx - llx)
                    pt_h = abs(ury - lly)
                    # Convert 72 pt/inch to 200 DPI pixels
                    width_px = round(pt_w * DEFAULT_PDF_DPI / 72.0)
                    height_px = round(pt_h * DEFAULT_PDF_DPI / 72.0)
                except (OverflowError, TypeError, ValueError):
                    pass

        self._check_image_limits(width_px, height_px)

        page_info = [
            PageInfo(page=p, width=width_px, height=height_px, dpi=DEFAULT_PDF_DPI)
            for p in range(1, total_pages + 1)
        ]

        return LoadedDocument(
            file_path=file_path,
            file_name=safe_name,
            mime_type="application/pdf",
            size_bytes=size_bytes,
            pages=total_pages,
            page_info=page_info,
        )

    def _check_image_limits(self, width: int, height: int) -> None:
        if width > MAX_DIMENSION_PX or height > MAX_DIMENSION_PX:
            raise DocumentLimitExceededError(
                f"Document dimension ({width}x{height}) exceeds maximum limit of {MAX_DIMENSION_PX} px"
            )
        megapixels = (width * height) / 1_000_000.0
        if megapixels > MAX_MEGAPIXELS_PER_PAGE:
            raise DocumentLimitExceededError(
                f"Document resolution ({megapixels:.1f} MP) exceeds maximum limit of {MAX_MEGAPIXELS_PER_PAGE} MP"
            )
