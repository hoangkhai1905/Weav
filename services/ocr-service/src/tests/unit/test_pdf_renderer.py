#!/usr/bin/env python3
"""Unit tests for bounded PDF rendering, page streaming, decompression-bomb safety, and handle closure."""

from __future__ import annotations

import io
import struct
from pathlib import Path

import numpy as np
import pytest

from src.domain.errors import (
    AnimatedImageUnsupportedError,
    CorruptFileError,
    DocumentLimitExceededError,
    EncryptedPdfError,
)
from src.domain.models.ocr_result import PageInfo
from src.domain.ports.document_loader_port import LoadedDocument
from src.infrastructure.processors.pdf_renderer import (
    DEFAULT_PDF_DPI,
    MAX_MEGAPIXELS_PER_PAGE,
    MAX_PDF_DPI,
    PdfRenderer,
    RenderedPage,
)

# ---------------------------------------------------------------------------
# Synthetic Document Helpers
# ---------------------------------------------------------------------------


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


def make_minimal_webp(width: int = 100, height: int = 100, animated: bool = False) -> bytes:
    """Construct minimal valid WEBP byte stream."""
    chunk_fourcc = b"VP8X"
    flags = 0x02 if animated else 0x00
    w_bytes = struct.pack("<I", width - 1)[:3]
    h_bytes = struct.pack("<I", height - 1)[:3]
    payload = struct.pack("<B", flags) + b"\x00\x00\x00" + w_bytes + h_bytes
    chunk = chunk_fourcc + struct.pack("<I", len(payload)) + payload

    total_len = 4 + len(chunk)
    riff_header = b"RIFF" + struct.pack("<I", total_len) + b"WEBP"
    return riff_header + chunk


def make_minimal_png(width: int = 100, height: int = 100) -> bytes:
    """Construct a decoder-valid PNG fixture."""
    from PIL import Image

    stream = io.BytesIO()
    Image.new("RGB", (width, height), color="white").save(stream, format="PNG")
    return stream.getvalue()


# ---------------------------------------------------------------------------
# Test Doubles for PDFium Streaming & Handle Closure Verification
# ---------------------------------------------------------------------------


class MockBitmap:
    def __init__(self, w: int = 612, h: int = 792) -> None:
        self.closed = False
        self.w = w
        self.h = h

    def to_numpy(self) -> np.ndarray:
        assert not self.closed, "Attempted to access closed bitmap buffer"
        # BGRA array of shape (h, w, 4)
        return np.zeros((self.h, self.w, 4), dtype=np.uint8)

    def close(self) -> None:
        self.closed = True


class MockPdfPage:
    def __init__(
        self,
        page_index: int,
        width_pt: float = 612.0,
        height_pt: float = 792.0,
        rotation: int = 0,
    ) -> None:
        self.page_index = page_index
        self.width_pt = width_pt
        self.height_pt = height_pt
        self.rotation = rotation
        self.closed = False
        self.bitmaps: list[MockBitmap] = []

    def get_rotation(self) -> int:
        return self.rotation

    def get_size(self) -> tuple[float, float]:
        assert not self.closed, "Attempted to access closed PDF page"
        return self.width_pt, self.height_pt

    def render(self, scale: float = 1.0, rotation: int = 0) -> MockBitmap:
        assert not self.closed, "Attempted to render closed PDF page"
        w = round(self.width_pt * scale)
        h = round(self.height_pt * scale)
        if rotation in (90, 270):
            w, h = h, w
        bm = MockBitmap(w=w, h=h)
        self.bitmaps.append(bm)
        return bm

    def close(self) -> None:
        self.closed = True


class MockPdfDocument:
    def __init__(
        self,
        pages_count: int = 2,
        is_encrypted: bool = False,
        page_dims: list[tuple[float, float]] | None = None,
        page_rotations: list[int] | None = None,
    ) -> None:
        self.pages_count = pages_count
        self.is_encrypted = is_encrypted
        self.closed = False
        self.pages: list[MockPdfPage] = []

        for i in range(pages_count):
            w, h = page_dims[i] if page_dims and i < len(page_dims) else (612.0, 792.0)
            rotation = page_rotations[i] if page_rotations and i < len(page_rotations) else 0
            self.pages.append(MockPdfPage(i, width_pt=w, height_pt=h, rotation=rotation))

    def __len__(self) -> int:
        return self.pages_count

    def get_page(self, index: int) -> MockPdfPage:
        assert not self.closed, "Attempted to access closed PDF document"
        return self.pages[index]

    def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# Unit Test Suite: PdfRenderer
# ---------------------------------------------------------------------------


class TestPdfRendererLimitsAndRejections:
    """Tests spec boundaries: 11 pages -> 413, encrypted -> 422, malformed -> 422, animated -> 422."""

    def test_reject_pdf_with_eleven_pages_raises_413(self, tmp_path: Path):
        """PDF with 11 pages must raise DocumentLimitExceededError (status 413)."""
        pdf_path = tmp_path / "eleven_pages.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=11))

        renderer = PdfRenderer(
            pdf_document_factory=lambda p: MockPdfDocument(pages_count=11)
        )

        with pytest.raises(DocumentLimitExceededError) as exc_info:
            list(renderer.render_pages(pdf_path))

        err = exc_info.value
        assert err.code == "DOCUMENT_LIMIT_EXCEEDED"
        assert err.status_code == 413
        assert "exceeds maximum allowed limit of 10 pages" in str(err)

    def test_reject_encrypted_pdf_header_raises_422(self, tmp_path: Path):
        """Encrypted PDF must raise EncryptedPdfError (status 422)."""
        pdf_path = tmp_path / "protected.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=1, encrypted=True))

        renderer = PdfRenderer()

        with pytest.raises(EncryptedPdfError) as exc_info:
            list(renderer.render_pages(pdf_path))

        err = exc_info.value
        assert err.code == "ENCRYPTED_PDF"
        assert err.status_code == 422

    def test_reject_encrypted_pdf_doc_attribute_raises_422(self, tmp_path: Path):
        """PDF where document factory reports is_encrypted must raise EncryptedPdfError."""
        pdf_path = tmp_path / "valid_header_locked.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=1, encrypted=False))

        renderer = PdfRenderer(
            pdf_document_factory=lambda p: MockPdfDocument(pages_count=1, is_encrypted=True)
        )

        with pytest.raises(EncryptedPdfError) as exc_info:
            list(renderer.render_pages(pdf_path))

        assert exc_info.value.code == "ENCRYPTED_PDF"
        assert exc_info.value.status_code == 422

    def test_reject_malformed_pdf_raises_422(self, tmp_path: Path):
        """Corrupted/non-PDF bytes must raise CorruptFileError (status 422)."""
        bad_path = tmp_path / "corrupt.pdf"
        bad_path.write_bytes(b"NOT_A_VALID_PDF_HEADER_JUST_RANDOM_GARBAGE")

        renderer = PdfRenderer()

        with pytest.raises(CorruptFileError) as exc_info:
            list(renderer.render_pages(bad_path))

        err = exc_info.value
        assert err.code == "CORRUPT_FILE"
        assert err.status_code == 422

    def test_reject_zero_byte_pdf_raises_422(self, tmp_path: Path):
        """Empty PDF file must raise CorruptFileError (status 422)."""
        empty_path = tmp_path / "empty.pdf"
        empty_path.write_bytes(b"")

        renderer = PdfRenderer()

        with pytest.raises(CorruptFileError) as exc_info:
            list(renderer.render_pages(empty_path))

        assert exc_info.value.code == "CORRUPT_FILE"
        assert exc_info.value.status_code == 422

    def test_reject_zero_pages_pdf_raises_422(self, tmp_path: Path):
        """PDF declaring 0 pages must raise CorruptFileError."""
        pdf_path = tmp_path / "zero_pages.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=0))

        renderer = PdfRenderer(
            pdf_document_factory=lambda p: MockPdfDocument(pages_count=0)
        )

        with pytest.raises(CorruptFileError) as exc_info:
            list(renderer.render_pages(pdf_path))

        assert exc_info.value.code == "CORRUPT_FILE"
        assert exc_info.value.status_code == 422

    def test_reject_animated_webp_raises_422(self, tmp_path: Path):
        """Animated WEBP must be rejected with AnimatedImageUnsupportedError (422)."""
        webp_path = tmp_path / "animated.webp"
        webp_path.write_bytes(make_minimal_webp(100, 100, animated=True))

        renderer = PdfRenderer()

        with pytest.raises(AnimatedImageUnsupportedError) as exc_info:
            renderer.load_raster_image(webp_path)

        err = exc_info.value
        assert err.code == "ANIMATED_IMAGE_UNSUPPORTED"
        assert err.status_code == 422

    def test_reject_decompression_bomb_image_raises_413(self, tmp_path: Path):
        """Images exceeding 20 MP must raise DocumentLimitExceededError (413)."""
        # Create an oversized image in memory using PIL
        try:
            from PIL import Image
        except ImportError:
            pytest.skip("Pillow not installed in test environment")

        bomb_path = tmp_path / "bomb.png"
        # 5000 x 5000 = 25,000,000 pixels > 20 MP limit
        img = Image.new("RGB", (5000, 5000), color="white")
        img.save(bomb_path, format="PNG")

        renderer = PdfRenderer()

        with pytest.raises(DocumentLimitExceededError) as exc_info:
            renderer.load_raster_image(bomb_path)

        err = exc_info.value
        assert err.code == "DOCUMENT_LIMIT_EXCEEDED"
        assert err.status_code == 413


class TestPdfPageStreamingAndHandles:
    """Tests page streaming, DPI capping, handle closure, and pre-allocation bounds."""

    def test_pdf_page_streaming_and_handle_cleanup(self, tmp_path: Path):
        """Verify pages are streamed one at a time and all handles are closed in finally blocks."""
        pdf_path = tmp_path / "two_page.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=2))

        mock_doc = MockPdfDocument(pages_count=2)
        renderer = PdfRenderer(
            pdf_document_factory=lambda p: mock_doc,
            default_dpi=200,
        )

        rendered_pages: list[RenderedPage] = []
        # Consume generator one by one
        generator = renderer.render_pages(pdf_path)

        # First page
        page1 = next(generator)
        rendered_pages.append(page1)
        assert page1.page_number == 1
        assert page1.dpi == 200
        # Verify page 1 bitmap and page handles are closed immediately after yield
        assert mock_doc.pages[0].closed is True
        assert all(bm.closed for bm in mock_doc.pages[0].bitmaps)
        # Document itself must not be closed yet while generator is active
        assert mock_doc.closed is False

        # Second page
        page2 = next(generator)
        rendered_pages.append(page2)
        assert page2.page_number == 2
        assert mock_doc.pages[1].closed is True
        assert all(bm.closed for bm in mock_doc.pages[1].bitmaps)

        # Generator exhausted
        with pytest.raises(StopIteration):
            next(generator)

        # Entire document handle must be closed now
        assert mock_doc.closed is True
        assert len(rendered_pages) == 2

    def test_generator_cleanup_on_early_break(self, tmp_path: Path):
        """Document handle must close even if caller breaks early out of streaming generator."""
        pdf_path = tmp_path / "multi.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=3))

        mock_doc = MockPdfDocument(pages_count=3)
        renderer = PdfRenderer(pdf_document_factory=lambda p: mock_doc)

        for rendered in renderer.render_pages(pdf_path):
            if rendered.page_number == 1:
                break  # break early

        # Closing generator or garbage collecting it guarantees doc.close() runs
        assert mock_doc.pages[0].closed is True
        assert mock_doc.closed is True

    def test_dpi_capped_never_exceeds_300(self, tmp_path: Path):
        """Requested DPI > 300 must be clamped to MAX_PDF_DPI (300)."""
        pdf_path = tmp_path / "clamped_dpi.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=1))

        mock_doc = MockPdfDocument(pages_count=1)
        renderer = PdfRenderer(
            pdf_document_factory=lambda p: mock_doc,
            max_dpi=600,
        )

        # Request 600 DPI
        pages = list(renderer.render_pages(pdf_path, target_dpi=600))
        assert len(pages) == 1
        assert pages[0].dpi == MAX_PDF_DPI  # Capped at 300

    def test_pre_bitmap_allocation_downscales_oversized_pdf_page(self, tmp_path: Path):
        """Very large page dimensions adjust DPI downward within bounds rather than crashing."""
        pdf_path = tmp_path / "oversized_page.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=1))

        # 3000 x 3000 points at 200 DPI would yield 8333 x 8333 px = 69.4 MP (> 20 MP limit)
        mock_doc = MockPdfDocument(pages_count=1, page_dims=[(3000.0, 3000.0)])
        renderer = PdfRenderer(
            pdf_document_factory=lambda p: mock_doc,
            default_dpi=200,
        )

        pages = list(renderer.render_pages(pdf_path))
        assert len(pages) == 1
        # DPI adjusted down to stay within 20 MP cap
        assert pages[0].dpi is not None
        assert pages[0].dpi < 200
        assert (pages[0].width * pages[0].height) <= (MAX_MEGAPIXELS_PER_PAGE * 1_000_000)

    def test_rejects_pdf_total_raster_area_before_next_bitmap(self, tmp_path: Path):
        """A document whose pages collectively exceed the pixel cap is rejected before allocation."""
        pdf_path = tmp_path / "too_many_pixels.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=10))

        mock_doc = MockPdfDocument(
            pages_count=10,
            page_dims=[(1800.0, 1440.0)] * 10,  # 5,000 x 4,000 = 20 MP/page at 200 DPI
        )
        renderer = PdfRenderer(pdf_document_factory=lambda p: mock_doc)

        with pytest.raises(DocumentLimitExceededError) as exc_info:
            list(renderer.render_pages(pdf_path))

        assert exc_info.value.status_code == 413
        assert "raster area" in str(exc_info.value)

    def test_honors_pdf_page_rotation_before_rendering(self, tmp_path: Path):
        """PDFium page rotation is passed through and reflected in canonical geometry."""
        pdf_path = tmp_path / "rotated.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=1))
        mock_doc = MockPdfDocument(pages_count=1, page_rotations=[90])

        pages = list(PdfRenderer(pdf_document_factory=lambda p: mock_doc).render_pages(pdf_path))

        assert pages[0].width == round(792 * DEFAULT_PDF_DPI / 72)
        assert pages[0].height == round(612 * DEFAULT_PDF_DPI / 72)

    def test_render_document_dispatches_pdf_and_raster(self, tmp_path: Path):
        """render_document correctly streams PDF pages and raster images."""
        renderer = PdfRenderer(
            pdf_document_factory=lambda p: MockPdfDocument(pages_count=2)
        )

        pdf_path = tmp_path / "test.pdf"
        pdf_path.write_bytes(make_minimal_pdf(pages=2))
        pdf_doc = LoadedDocument(
            file_path=pdf_path,
            file_name="test.pdf",
            mime_type="application/pdf",
            size_bytes=len(pdf_path.read_bytes()),
            pages=2,
            page_info=[
                PageInfo(page=1, width=612, height=792, dpi=200),
                PageInfo(page=2, width=612, height=792, dpi=200),
            ],
        )

        streamed = list(renderer.render_document(pdf_doc))
        assert len(streamed) == 2
        assert streamed[0].page_number == 1
        assert streamed[1].page_number == 2


class TestExifAndRasterLoading:
    """Tests EXIF orientation transposition and safe raster image loading."""

    def test_load_valid_png_raster_image(self, tmp_path: Path):
        png_path = tmp_path / "sample.png"
        png_path.write_bytes(make_minimal_png(width=320, height=240))

        renderer = PdfRenderer()
        rendered = renderer.load_raster_image(png_path)

        assert rendered.page_number == 1
        assert rendered.width == 320
        assert rendered.height == 240
        assert rendered.dpi is None
        assert isinstance(rendered.image, np.ndarray)
        assert rendered.image.shape == (240, 320, 3)

    def test_exif_orientation_transposition(self, tmp_path: Path):
        """EXIF orientation tag 6 (rotated 90 CW) must transpose image dimensions."""
        try:
            from PIL import Image
        except ImportError:
            pytest.skip("Pillow not installed in test environment")

        jpg_path = tmp_path / "exif_photo.jpg"
        # 400 wide by 200 high
        img = Image.new("RGB", (400, 200), color="blue")
        # Add EXIF tag 274 (Orientation) = 6 (requires 90 deg rotation)
        exif = img.getexif()
        exif[274] = 6
        img.save(jpg_path, format="JPEG", exif=exif)

        renderer = PdfRenderer()
        rendered = renderer.load_raster_image(jpg_path)

        # After EXIF transposition, width and height swap: 200 wide by 400 high
        assert rendered.width == 200
        assert rendered.height == 400
