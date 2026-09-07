#!/usr/bin/env python3
"""Unit tests for OpenCV preprocessor adapter, measured policies, and golden geometry transforms."""

from __future__ import annotations

import math

import numpy as np
import pytest

from src.domain.models.ocr_result import BoundingBox
from src.infrastructure.processors.opencv_preprocessor_adapter import (
    InverseCoordinateTransform,
    OpenCvPreprocessorAdapter,
)

try:
    import cv2
except ImportError:
    cv2 = None


# ---------------------------------------------------------------------------
# Synthetic Image Generators for Measured Policy Tests
# ---------------------------------------------------------------------------


def make_clean_high_contrast_canvas(width: int = 800, height: int = 600) -> np.ndarray:
    """Create a high-contrast black-on-white text canvas."""
    img = np.full((height, width), 255, dtype=np.uint8)
    if cv2 is not None:
        cv2.putText(img, "Cong hoa Xa hoi Chu nghia Viet Nam", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2)
        cv2.putText(img, "Doc lap - Tu do - Hanh phuc", (80, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.9, 0, 2)
        cv2.putText(img, "WEAV Document Processing Platform", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 2)
    else:
        img[90:110, 50:450] = 0
        img[150:170, 80:400] = 0
    return img


def make_low_contrast_canvas(width: int = 800, height: int = 600) -> np.ndarray:
    """Create a low-contrast washed-out canvas (std < 45)."""
    # Range compressed into [140, 170]
    img = np.full((height, width), 165, dtype=np.uint8)
    if cv2 is not None:
        cv2.putText(img, "Low Contrast Header Text", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 145, 1)
    else:
        img[95:105, 50:350] = 145
    return img


def make_noisy_canvas(width: int = 800, height: int = 600) -> np.ndarray:
    """Create deterministic full-frame high-frequency noise."""
    rng = np.random.default_rng(12345)
    base = np.full((height, width), 165, dtype=np.int16)
    noise = rng.normal(0.0, 28.0, (height, width)).astype(np.int16)
    return np.clip(base + noise, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Unit Test Suite: Measured Policy
# ---------------------------------------------------------------------------


class TestMeasuredPreprocessingPolicy:
    """Tests OpenCV measured preprocessing policy and selective step recording."""

    @pytest.fixture(autouse=True)
    def check_cv2(self):
        if cv2 is None:
            pytest.skip("cv2 is required for OpenCV preprocessor adapter tests")

    def test_color_image_triggers_grayscale_step(self):
        """BGR color image with distinct channels triggers grayscale conversion."""
        adapter = OpenCvPreprocessorAdapter()
        # Create BGR image with distinct color content
        color_img = np.zeros((400, 600, 3), dtype=np.uint8)
        color_img[:, :, 0] = 200  # Blue
        color_img[:, :, 2] = 50   # Red

        result = adapter.preprocess_page(color_img, page_number=1)

        assert result.page == 1
        assert "grayscale" in result.steps_applied
        assert len(result.processed_image.shape) == 2  # Converted to 2D single channel

    def test_low_contrast_image_triggers_contrast_step(self):
        """Low-contrast washed-out image triggers CLAHE contrast enhancement."""
        adapter = OpenCvPreprocessorAdapter()
        low_contrast_img = make_low_contrast_canvas(600, 400)

        result = adapter.preprocess_page(low_contrast_img, page_number=1)

        assert "contrast" in result.steps_applied

    def test_high_contrast_clean_image_does_not_trigger_contrast(self):
        """High-contrast clean image does not trigger unnecessary contrast step."""
        adapter = OpenCvPreprocessorAdapter()
        clean_img = make_clean_high_contrast_canvas(800, 600)

        result = adapter.preprocess_page(clean_img, page_number=1)

        assert "contrast" not in result.steps_applied

    def test_noisy_image_triggers_denoise_step(self):
        """High-frequency noise above threshold triggers denoise step."""
        adapter = OpenCvPreprocessorAdapter()
        noisy_img = make_noisy_canvas(600, 400)

        result = adapter.preprocess_page(noisy_img, page_number=1)

        assert "denoise" in result.steps_applied

    def test_clean_image_does_not_trigger_denoise_step(self):
        """Clean synthetic canvas does not trigger denoise step."""
        adapter = OpenCvPreprocessorAdapter()
        clean_img = make_clean_high_contrast_canvas(800, 600)

        result = adapter.preprocess_page(clean_img, page_number=1)

        assert "denoise" not in result.steps_applied

    def test_thresholding_not_blindly_applied_by_default(self):
        """Binarization/thresholding is disabled by default to preserve Vietnamese diacritics."""
        adapter = OpenCvPreprocessorAdapter(enable_threshold=False)
        clean_img = make_clean_high_contrast_canvas(800, 600)

        result = adapter.preprocess_page(clean_img, page_number=1)

        assert "threshold" not in result.steps_applied

    def test_thresholding_applied_when_explicitly_enabled(self):
        """Thresholding is recorded when enable_threshold=True."""
        adapter = OpenCvPreprocessorAdapter(enable_threshold=True)
        clean_img = make_clean_high_contrast_canvas(800, 600)

        result = adapter.preprocess_page(clean_img, page_number=1)

        assert "threshold" in result.steps_applied


# ---------------------------------------------------------------------------
# Unit Test Suite: Golden Geometry & Inverse Coordinate Transform
# ---------------------------------------------------------------------------


class TestGoldenGeometryInverseTransform:
    """Golden geometry tests: rotated/resized/skewed boxes return to canonical coords within <= 2px."""

    def test_pure_rotation_golden_geometry_within_two_pixels_tolerance(self):
        """Affine rotation forward + inverse transform returns canonical box with tolerance <= 2px."""
        canonical_w = 1200
        canonical_h = 1600
        center_x = canonical_w / 2.0
        center_y = canonical_h / 2.0

        # Known canonical text bounding box and polygon
        orig_x = 150.0
        orig_y = 320.0
        orig_w = 380.0
        orig_h = 45.0
        orig_box = BoundingBox(x=orig_x, y=orig_y, width=orig_w, height=orig_h)
        orig_poly = [
            [orig_x, orig_y],
            [orig_x + orig_w, orig_y],
            [orig_x + orig_w, orig_y + orig_h],
            [orig_x, orig_y + orig_h],
        ]

        # Apply a known 7.5 degree rotation
        angle_deg = 7.5
        theta = math.radians(angle_deg)
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)

        # Build 2x3 affine matrix around center
        alpha = cos_t
        beta = sin_t
        tx = (1.0 - alpha) * center_x - beta * center_y
        ty = beta * center_x + (1.0 - alpha) * center_y
        m_forward = np.array([[alpha, beta, tx], [-beta, alpha, ty]], dtype=np.float64)

        # Forward transform polygon vertices to simulated preprocessed space
        preprocessed_poly: list[list[float]] = []
        for pt in orig_poly:
            px = float(m_forward[0, 0] * pt[0] + m_forward[0, 1] * pt[1] + m_forward[0, 2])
            py = float(m_forward[1, 0] * pt[0] + m_forward[1, 1] * pt[1] + m_forward[1, 2])
            preprocessed_poly.append([px, py])

        # Preprocessed axis-aligned bounding box enclosing the rotated points
        xs = [p[0] for p in preprocessed_poly]
        ys = [p[1] for p in preprocessed_poly]
        prep_box = BoundingBox(
            x=min(xs),
            y=min(ys),
            width=max(xs) - min(xs),
            height=max(ys) - min(ys),
        )

        # Initialize InverseCoordinateTransform with forward affine matrix
        inv_transform = InverseCoordinateTransform(
            affine_matrix=m_forward,
            canonical_width=canonical_w,
            canonical_height=canonical_h,
        )

        # Invert the preprocessed polygon back to canonical space
        restored_poly = inv_transform.transform_polygon(preprocessed_poly)
        for i in range(4):
            assert abs(restored_poly[i][0] - orig_poly[i][0]) <= 2.0, (
                f"Polygon vertex {i} X ({restored_poly[i][0]}) exceeds 2px tolerance from orig ({orig_poly[i][0]})"
            )
            assert abs(restored_poly[i][1] - orig_poly[i][1]) <= 2.0, (
                f"Polygon vertex {i} Y ({restored_poly[i][1]}) exceeds 2px tolerance from orig ({orig_poly[i][1]})"
            )

        # Invert bounding box using polygon vertices
        restored_box = inv_transform.transform_bounding_box(prep_box, polygon=preprocessed_poly)

        # Assert all bounding box properties return to canonical within <= 2.0 pixels
        diff_x = abs(restored_box.x - orig_box.x)
        diff_y = abs(restored_box.y - orig_box.y)
        diff_w = abs(restored_box.width - orig_box.width)
        diff_h = abs(restored_box.height - orig_box.height)

        assert diff_x <= 2.0, f"Box X difference ({diff_x:.2f}px) exceeds 2px tolerance"
        assert diff_y <= 2.0, f"Box Y difference ({diff_y:.2f}px) exceeds 2px tolerance"
        assert diff_w <= 2.0, f"Box width difference ({diff_w:.2f}px) exceeds 2px tolerance"
        assert diff_h <= 2.0, f"Box height difference ({diff_h:.2f}px) exceeds 2px tolerance"

    def test_scale_and_offset_inverse_transform_within_tolerance(self):
        """Downscaling / offset transform restores canonical coordinates within <= 2px tolerance."""
        canonical_w = 1000
        canonical_h = 1400

        scale_x = 0.75
        scale_y = 0.75
        offset_x = 25.0
        offset_y = 15.0

        inv_transform = InverseCoordinateTransform(
            scale_x=scale_x,
            scale_y=scale_y,
            offset_x=offset_x,
            offset_y=offset_y,
            canonical_width=canonical_w,
            canonical_height=canonical_h,
        )

        orig_x, orig_y, orig_w, orig_h = 200.0, 400.0, 300.0, 50.0
        # Forward simulate
        prep_x = orig_x * scale_x + offset_x
        prep_y = orig_y * scale_y + offset_y
        prep_w = orig_w * scale_x
        prep_h = orig_h * scale_y
        prep_box = BoundingBox(x=prep_x, y=prep_y, width=prep_w, height=prep_h)

        restored_box = inv_transform.transform_bounding_box(prep_box)

        assert abs(restored_box.x - orig_x) <= 2.0
        assert abs(restored_box.y - orig_y) <= 2.0
        assert abs(restored_box.width - orig_w) <= 2.0
        assert abs(restored_box.height - orig_h) <= 2.0

    def test_canonical_boundary_clamping(self):
        """Transformed box coordinates are strictly clamped within canonical dimensions."""
        inv_transform = InverseCoordinateTransform(
            canonical_width=800,
            canonical_height=600,
        )

        # Box that exceeds page dimensions
        out_of_bounds_box = BoundingBox(x=750.0, y=550.0, width=100.0, height=100.0)
        clamped_box = inv_transform.transform_bounding_box(out_of_bounds_box)

        assert clamped_box.x + clamped_box.width <= 800.0
        assert clamped_box.y + clamped_box.height <= 600.0
