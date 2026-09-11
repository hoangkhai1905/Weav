#!/usr/bin/env python3
"""Bounded, page-at-a-time PDF renderer and decompression-bomb-safe image loader.

Enforces:
- Maximum 10 pages per PDF (raises DocumentLimitExceededError, HTTP 413).
- Strict 200 DPI default rendering, capped at 300 DPI (never > 300).
- Dimension and memory bounds before bitmap allocation (max 10,000px, 20 MP per page).
- Rejection of encrypted PDFs (EncryptedPdfError, HTTP 422).
- Rejection of corrupt/malformed PDFs (CorruptFileError, HTTP 422).
- Rejection of animated WEBP / images (AnimatedImageUnsupportedError, HTTP 422).
- Protection against image decompression bombs (DocumentLimitExceededError, HTTP 413).
- Proper EXIF orientation transposition for camera and mobile captures.
- Strict resource cleanup: handles (bitmap, page, document) are guaranteed closed in finally blocks.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from src.domain.errors import (
    AnimatedImageUnsupportedError,
    CorruptFileError,
    DocumentLimitExceededError,
    EncryptedPdfError,
    InternalError,
)
from src.domain.ports.document_loader_port import LoadedDocument

# Limits aligned with Spec Section 4
DEFAULT_PDF_DPI = 200
MAX_PDF_DPI = 300
MIN_PDF_DPI = 72
MAX_PAGES = 10
MAX_DIMENSION_PX = 10000
MAX_MEGAPIXELS_PER_PAGE = 20.0
MAX_PIXELS_PER_PAGE = 20_000_000
MAX_TOTAL_PIXELS = 100_000_000

# Magic signatures
PDF_MAGIC_PREFIX = b"%PDF-"

logger = logging.getLogger(__name__)


class RenderedPage(BaseModel):
    """Canonical rendered page containing geometry and image array."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    page_number: int = Field(..., ge=1, description="1-based page number")
    image: Any = Field(..., description="Canonical page image as BGR numpy ndarray")
    width: int = Field(..., gt=0, le=10000, description="Canonical width in pixels")
    height: int = Field(..., gt=0, le=10000, description="Canonical height in pixels")
    dpi: int | None = Field(default=None, description="Rendered DPI for PDF, or None for raster")


def _get_pdfium():
    """Lazily import pypdfium2."""
    try:
        import pypdfium2 as pdfium

        return pdfium
    except ImportError:
        return None


def _get_pil():
    """Lazily import PIL.Image and PIL.ImageOps."""
    try:
        from PIL import Image, ImageOps

        return Image, ImageOps
    except ImportError:
        return None, None


class PdfRenderer:
    """Renders PDF documents page-by-page and safely loads raster images."""

    def __init__(
        self,
        default_dpi: int = DEFAULT_PDF_DPI,
        max_dpi: int = MAX_PDF_DPI,
        pdf_document_factory: Callable[[Any], Any] | None = None,
    ) -> None:
        self.max_dpi = min(max_dpi, MAX_PDF_DPI)
        self.default_dpi = min(default_dpi, self.max_dpi)
        self._pdf_document_factory = pdf_document_factory

    def render_document(
        self,
        document: LoadedDocument,
        target_dpi: int | None = None,
    ) -> Iterator[RenderedPage]:
        """Stream canonical rendered pages from any validated LoadedDocument."""
        if document.mime_type == "application/pdf":
            yield from self.render_pages(document.file_path, target_dpi=target_dpi or self.default_dpi)
        elif document.mime_type in ("image/png", "image/jpeg", "image/webp"):
            yield self.load_raster_image(document.file_path)
        else:
            raise CorruptFileError(f"Unsupported media type for rendering: {document.mime_type}")

    def render_pages(
        self,
        file_path: Path | str,
        target_dpi: int | None = None,
    ) -> Iterator[RenderedPage]:
        """Stream PDF pages one at a time, strictly freeing resources per page."""
        path = Path(file_path)
        self._preflight_pdf_file(path)

        dpi = min(target_dpi or self.default_dpi, self.max_dpi)

        pdfium = _get_pdfium()
        doc_factory = self._pdf_document_factory or (pdfium.PdfDocument if pdfium is not None else None)

        if doc_factory is None:
            raise InternalError("pypdfium2 is required for PDF rendering but is not installed")

        doc = None
        try:
            try:
                doc = doc_factory(path)
            except Exception as exc:
                exc_str = str(exc).lower()
                if "password" in exc_str or "encrypt" in exc_str:
                    raise EncryptedPdfError("Encrypted or password-protected PDF is not supported") from exc
                raise CorruptFileError(f"Malformed or corrupt PDF document: {exc}") from exc

            # Check encryption attribute if supported by doc object
            if getattr(doc, "is_encrypted", False):
                raise EncryptedPdfError("Encrypted or password-protected PDF is not supported")

            total_pages = len(doc)
            if total_pages == 0:
                raise CorruptFileError("PDF contains 0 valid pages")

            if total_pages > MAX_PAGES:
                raise DocumentLimitExceededError(
                    f"PDF page count ({total_pages}) exceeds maximum allowed limit of {MAX_PAGES} pages"
                )

            total_rendered_pixels = 0
            for page_idx in range(total_pages):
                page_num = page_idx + 1
                page = None
                bitmap = None
                try:
                    try:
                        page = doc.get_page(page_idx)
                    except Exception as exc:
                        raise CorruptFileError(f"Failed to access PDF page {page_num}: {exc}") from exc

                    # Bounds check BEFORE bitmap allocation
                    width_pt, height_pt = page.get_size()
                    if width_pt <= 0 or height_pt <= 0:
                        raise CorruptFileError(f"PDF page {page_num} has invalid 0 or negative dimensions")

                    page_rotation = 0
                    get_rotation = getattr(page, "get_rotation", None)
                    if callable(get_rotation):
                        page_rotation = int(get_rotation())
                    if page_rotation not in (0, 90, 180, 270):
                        raise CorruptFileError(
                            f"PDF page {page_num} has unsupported rotation {page_rotation}"
                        )

                    # PDFium rotates the output bitmap, so bounds must be
                    # checked against the rendered orientation before alloc.
                    render_width_pt, render_height_pt = width_pt, height_pt
                    if page_rotation in (90, 270):
                        render_width_pt, render_height_pt = height_pt, width_pt

                    scale = dpi / 72.0
                    target_w = round(render_width_pt * scale)
                    target_h = round(render_height_pt * scale)

                    # If requested DPI causes page to exceed limits, adjust DPI downward within cap
                    if (
                        target_w > MAX_DIMENSION_PX
                        or target_h > MAX_DIMENSION_PX
                        or (target_w * target_h) > MAX_PIXELS_PER_PAGE
                    ):
                        max_scale_w = MAX_DIMENSION_PX / render_width_pt
                        max_scale_h = MAX_DIMENSION_PX / render_height_pt
                        max_scale_mp = (MAX_PIXELS_PER_PAGE / (render_width_pt * render_height_pt)) ** 0.5
                        allowed_scale = min(scale, max_scale_w, max_scale_h, max_scale_mp)
                        adjusted_dpi = int(allowed_scale * 72.0)

                        if adjusted_dpi < MIN_PDF_DPI:
                            raise DocumentLimitExceededError(
                                f"PDF page {page_num} dimensions ({width_pt:.0f}x{height_pt:.0f} pt) exceed "
                                f"limits ({MAX_DIMENSION_PX}px / {MAX_MEGAPIXELS_PER_PAGE}MP) even at minimum DPI"
                            )
                        scale = allowed_scale
                        effective_dpi = adjusted_dpi
                    else:
                        effective_dpi = dpi

                    planned_pixels = round(width_pt * scale) * round(height_pt * scale)
                    if total_rendered_pixels + planned_pixels > MAX_TOTAL_PIXELS:
                        raise DocumentLimitExceededError(
                            f"PDF document raster area exceeds maximum limit of {MAX_TOTAL_PIXELS} pixels"
                        )

                    # Render bitmap for this page only
                    try:
                        bitmap = page.render(scale=scale, rotation=page_rotation)
                        bgra_arr = bitmap.to_numpy()
                    except Exception as exc:
                        raise CorruptFileError(f"Failed to render bitmap for PDF page {page_num}: {exc}") from exc

                    # Extract BGR ndarray (first 3 channels: B, G, R)
                    bgr_arr = np.ascontiguousarray(bgra_arr[:, :, :3])
                    h, w = bgr_arr.shape[:2]

                    if w > MAX_DIMENSION_PX or h > MAX_DIMENSION_PX or (w * h) > MAX_PIXELS_PER_PAGE:
                        raise DocumentLimitExceededError(
                            f"Rendered PDF page {page_num} ({w}x{h}) exceeds dimension or pixel caps"
                        )
                    if total_rendered_pixels + (w * h) > MAX_TOTAL_PIXELS:
                        raise DocumentLimitExceededError(
                            f"PDF document raster area exceeds maximum limit of {MAX_TOTAL_PIXELS} pixels"
                        )
                    total_rendered_pixels += w * h

                    rendered_page = RenderedPage(
                        page_number=page_num,
                        image=bgr_arr,
                        width=w,
                        height=h,
                        dpi=effective_dpi,
                    )
                finally:
                    # Close page and bitmap immediately
                    if bitmap is not None:
                        try:
                            bitmap.close()
                        except Exception:
                            logger.debug("Failed to close PDF bitmap", exc_info=True)
                    if page is not None:
                        try:
                            page.close()
                        except Exception:
                            logger.debug("Failed to close PDF page", exc_info=True)

                yield rendered_page

        finally:
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    logger.debug("Failed to close PDF document", exc_info=True)

    def load_raster_image(self, file_path: Path | str) -> RenderedPage:
        """Safely load a raster image with decompression-bomb protection and EXIF orientation."""
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            raise CorruptFileError("Document image file does not exist or is not a regular file")

        size_bytes = path.stat().st_size
        if size_bytes == 0:
            raise CorruptFileError("Document image file is empty (0 bytes)")

        # Fast header preflight for animated WEBP
        with open(path, "rb") as f:
            head = f.read(4096)
        if self._has_animation_marker(head):
            raise AnimatedImageUnsupportedError("Animated WEBP documents are not supported")

        Image, ImageOps = _get_pil()
        if Image is None or ImageOps is None:
            raise InternalError("Pillow (PIL) is required for image processing but is not installed")

        # Configure Pillow decompression bomb protection
        old_max_pixels = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS_PER_PAGE

        try:
            try:
                with Image.open(path) as source_img:
                    # Check animation flag on format parsers (e.g. animated WEBP, GIF, APNG)
                    if getattr(source_img, "is_animated", False) and getattr(source_img, "n_frames", 1) > 1:
                        raise AnimatedImageUnsupportedError("Animated images are not supported")

                    w, h = source_img.size
                    if w > MAX_DIMENSION_PX or h > MAX_DIMENSION_PX or (w * h) > MAX_PIXELS_PER_PAGE:
                        raise DocumentLimitExceededError(
                            f"Image dimensions ({w}x{h}) exceed maximum allowed limit of "
                            f"{MAX_DIMENSION_PX}px or {MAX_MEGAPIXELS_PER_PAGE} MP"
                        )

                    # Apply EXIF orientation transposition
                    oriented_img = source_img
                    try:
                        oriented_img = ImageOps.exif_transpose(source_img)
                    except (OSError, TypeError, ValueError) as exc:
                        logger.debug("Unable to apply EXIF orientation", exc_info=exc)

                    try:
                        w, h = oriented_img.size
                        if w > MAX_DIMENSION_PX or h > MAX_DIMENSION_PX or (w * h) > MAX_PIXELS_PER_PAGE:
                            raise DocumentLimitExceededError(
                                f"Image dimensions after EXIF transposition ({w}x{h}) exceed limits"
                            )

                        # Convert to RGB, then to BGR numpy ndarray
                        rgb_img = oriented_img.convert("RGB")
                        try:
                            rgb_arr = np.array(rgb_img)
                            bgr_arr = np.ascontiguousarray(rgb_arr[:, :, ::-1])
                        finally:
                            rgb_img.close()

                        return RenderedPage(
                            page_number=1,
                            image=bgr_arr,
                            width=w,
                            height=h,
                            dpi=None,
                        )
                    finally:
                        if oriented_img is not source_img:
                            oriented_img.close()
            except Image.DecompressionBombError as exc:
                raise DocumentLimitExceededError(
                    f"Decompression bomb detected: image exceeds maximum limit of {MAX_MEGAPIXELS_PER_PAGE} MP"
                ) from exc
            except (OSError, SyntaxError, ValueError) as exc:
                if isinstance(exc, (DocumentLimitExceededError, AnimatedImageUnsupportedError)):
                    raise
                raise CorruptFileError(f"Corrupted or invalid image file: {exc}") from exc
        finally:
            Image.MAX_IMAGE_PIXELS = old_max_pixels

    def _preflight_pdf_file(self, path: Path) -> None:
        """Inspect PDF file existence, byte size, magic header, and encryption markers."""
        if not path.exists() or not path.is_file():
            raise CorruptFileError("Document PDF file does not exist or is not a regular file")

        size = path.stat().st_size
        if size == 0:
            raise CorruptFileError("Document PDF file is empty (0 bytes)")

        if size < 32:
            raise CorruptFileError("PDF file is truncated or corrupted")

        with open(path, "rb") as f:
            header = f.read(4096)

        # Check for %PDF- signature
        pdf_pos = header.find(PDF_MAGIC_PREFIX)
        if pdf_pos == -1 or pdf_pos >= 1024:
            raise CorruptFileError("File does not contain valid PDF magic signature")

        # Fast rejection of encrypted PDFs
        if b"/Encrypt" in header:
            raise EncryptedPdfError("Encrypted or password-protected PDF is not supported")

        # Check trailing bytes for encryption dictionary if document is larger
        if size > 4096:
            with open(path, "rb") as f:
                f.seek(max(0, size - 8192))
                tail = f.read()
            if b"/Encrypt" in tail:
                raise EncryptedPdfError("Encrypted or password-protected PDF is not supported")

    @staticmethod
    def _has_animation_marker(header: bytes) -> bool:
        """Detect WEBP animation before invoking a potentially expensive decoder."""
        if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WEBP":
            return False
        if b"ANIM" in header[:1024]:
            return True

        # VP8X stores the animation flag in the first byte of its payload.
        # The file signature and chunk header must be present before reading it.
        return (
            len(header) >= 21
            and header[:4] == b"RIFF"
            and header[8:12] == b"WEBP"
            and header[12:16] == b"VP8X"
            and bool(header[20] & 0x02)
        )
