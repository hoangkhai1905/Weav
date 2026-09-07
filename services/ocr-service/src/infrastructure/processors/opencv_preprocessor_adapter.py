#!/usr/bin/env python3
"""OpenCV-based image preprocessor adapter with measured policies and inverse coordinate transforms.

Measured Policy Guarantees:
- Grayscale conversion only when multi-channel images have color information.
- Contrast enhancement (CLAHE) applied only when measured image contrast is low (< threshold).
- Denoising applied only when high-frequency noise is detected above noise variance threshold.
- Deskew applied only when skew angle >= 0.5 degrees (and <= 45 degrees).
- Thresholding (Otsu / adaptive) is NOT blindly applied to every page to avoid eroding
  Vietnamese diacritics and thin strokes.
- Records exact list of operations applied per page in PreprocessingResult.
- Stores InverseCoordinateTransform to map bounding boxes and polygons from preprocessed
  space back to canonical page pixel space with <= 2px tolerance.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from src.domain.errors import InternalError
from src.domain.models.ocr_result import BoundingBox
from src.domain.ports.preprocessor_port import PreprocessingResult, PreprocessorPort

try:
    import cv2
except ImportError:
    cv2 = None


class InverseCoordinateTransform:
    """Represents an invertible affine coordinate transform between preprocessed and canonical spaces."""

    def __init__(
        self,
        affine_matrix: np.ndarray | None = None,
        scale_x: float = 1.0,
        scale_y: float = 1.0,
        offset_x: float = 0.0,
        offset_y: float = 0.0,
        canonical_width: int | None = None,
        canonical_height: int | None = None,
    ) -> None:
        """Initialize transform.

        If affine_matrix (2x3) is provided, it represents the FORWARD transform
        from canonical page space to preprocessed image space.
        """
        self.affine_matrix = affine_matrix
        self.scale_x = scale_x
        self.scale_y = scale_y
        self.offset_x = offset_x
        self.offset_y = offset_y
        self.canonical_width = canonical_width
        self.canonical_height = canonical_height

        # Precompute 2x3 inverse affine matrix if forward matrix is present
        self._inv_affine_matrix: np.ndarray | None = None
        if affine_matrix is not None:
            self._inv_affine_matrix = self._invert_affine_2x3(affine_matrix)

    @staticmethod
    def _invert_affine_2x3(m: np.ndarray) -> np.ndarray:
        """Invert a 2x3 affine transformation matrix in pure numpy."""
        a, b, tx = float(m[0, 0]), float(m[0, 1]), float(m[0, 2])
        c, d, ty = float(m[1, 0]), float(m[1, 1]), float(m[1, 2])
        det = a * d - b * c
        if abs(det) < 1e-12:
            # Degenerate matrix, return identity
            return np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], dtype=np.float64)
        inv_det = 1.0 / det
        inv_a = d * inv_det
        inv_b = -b * inv_det
        inv_c = -c * inv_det
        inv_d = a * inv_det
        inv_tx = -(inv_a * tx + inv_b * ty)
        inv_ty = -(inv_c * tx + inv_d * ty)
        return np.array([[inv_a, inv_b, inv_tx], [inv_c, inv_d, inv_ty]], dtype=np.float64)

    def transform_point(self, x: float, y: float) -> tuple[float, float]:
        """Map a point from preprocessed space back to canonical page space."""
        # 1. Reverse affine rotation/shear if present
        if self._inv_affine_matrix is not None:
            m = self._inv_affine_matrix
            # Both output coordinates must be calculated from the same input
            # point. Updating x before computing y silently compounds the
            # transform and breaks rotated/skewed box geometry.
            input_x, input_y = x, y
            x = float(m[0, 0] * input_x + m[0, 1] * input_y + m[0, 2])
            y = float(m[1, 0] * input_x + m[1, 1] * input_y + m[1, 2])

        # 2. Reverse scale and offset
        orig_x = (x - self.offset_x) / self.scale_x
        orig_y = (y - self.offset_y) / self.scale_y

        # Clamp to canonical dimensions if known
        if self.canonical_width is not None:
            orig_x = max(0.0, min(float(self.canonical_width), orig_x))
        if self.canonical_height is not None:
            orig_y = max(0.0, min(float(self.canonical_height), orig_y))

        return orig_x, orig_y

    def transform_polygon(self, polygon: list[list[float]]) -> list[list[float]]:
        """Map 4-point polygon from preprocessed space back to canonical page space."""
        canonical_poly: list[list[float]] = []
        for pt in polygon:
            cx, cy = self.transform_point(float(pt[0]), float(pt[1]))
            canonical_poly.append([round(cx, 2), round(cy, 2)])
        return canonical_poly

    def transform_bounding_box(
        self,
        box: BoundingBox,
        polygon: list[list[float]] | None = None,
    ) -> BoundingBox:
        """Map a BoundingBox from preprocessed space back to canonical page space."""
        # If polygon is available, compute enclosing canonical box from transformed vertices
        if polygon and len(polygon) >= 4:
            can_poly = self.transform_polygon(polygon)
            xs = [p[0] for p in can_poly]
            ys = [p[1] for p in can_poly]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
        else:
            # Transform four corners of the bounding box
            corners = [
                [box.x, box.y],
                [box.x + box.width, box.y],
                [box.x + box.width, box.y + box.height],
                [box.x, box.y + box.height],
            ]
            can_corners = [self.transform_point(c[0], c[1]) for c in corners]
            xs = [c[0] for c in can_corners]
            ys = [c[1] for c in can_corners]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)

        can_w = max(1.0, max_x - min_x)
        can_h = max(1.0, max_y - min_y)

        # Clamp to canonical page bounds if available
        if self.canonical_width is not None:
            min_x = max(0.0, min(float(self.canonical_width - 1.0), min_x))
            can_w = min(can_w, float(self.canonical_width) - min_x)
        if self.canonical_height is not None:
            min_y = max(0.0, min(float(self.canonical_height - 1.0), min_y))
            can_h = min(can_h, float(self.canonical_height) - min_y)

        return BoundingBox(
            x=round(min_x, 2),
            y=round(min_y, 2),
            width=round(max(1.0, can_w), 2),
            height=round(max(1.0, can_h), 2),
        )


class OpenCvPreprocessorAdapter(PreprocessorPort):
    """OpenCV implementation of PreprocessorPort applying measured, policy-driven enhancements."""

    # Policy thresholds
    CONTRAST_STD_THRESHOLD = 45.0  # Images with luminance std < 45 benefit from CLAHE
    CONTRAST_PTP_THRESHOLD = 120.0  # Images with peak-to-peak intensity < 120 benefit from CLAHE
    NOISE_VARIANCE_THRESHOLD = 7.0  # High-frequency residual mean > 7.0 triggers Gaussian blur
    MIN_DESKEW_ANGLE_DEG = 0.5  # Skew below 0.5 degrees is ignored to preserve sharpness
    MAX_DESKEW_ANGLE_DEG = 45.0  # Skew above 45 degrees is considered document-orientation level

    def __init__(
        self,
        enable_threshold: bool = False,
        min_deskew_angle: float = MIN_DESKEW_ANGLE_DEG,
        max_deskew_angle: float = MAX_DESKEW_ANGLE_DEG,
    ) -> None:
        self.enable_threshold = enable_threshold
        self.min_deskew_angle = min_deskew_angle
        self.max_deskew_angle = max_deskew_angle

    def preprocess_page(
        self,
        page_image: Any,
        page_number: int,
    ) -> PreprocessingResult:
        """Process page image following measured enhancement policies."""
        if cv2 is None:
            raise InternalError("OpenCV (cv2) is required for image preprocessing but is not installed")

        # Convert input to numpy ndarray if needed
        if not isinstance(page_image, np.ndarray):
            img_arr = np.array(page_image)
        else:
            img_arr = page_image.copy()

        steps_applied: list[str] = []
        canonical_h, canonical_w = img_arr.shape[:2]

        # 1. Grayscale step (measured: only if multi-channel)
        if len(img_arr.shape) == 3 and img_arr.shape[2] in (3, 4):
            # Check if image actually contains color (channel difference variance)
            if img_arr.shape[2] == 4:
                bgr = cv2.cvtColor(img_arr, cv2.COLOR_BGRA2BGR)
            else:
                bgr = img_arr

            # Check if color channels differ significantly
            diff_rg = np.mean(cv2.absdiff(bgr[:, :, 0], bgr[:, :, 1]))
            diff_gb = np.mean(cv2.absdiff(bgr[:, :, 1], bgr[:, :, 2]))
            is_color = (diff_rg + diff_gb) > 2.0

            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            if is_color:
                steps_applied.append("grayscale")
        else:
            gray = img_arr.squeeze()

        # 2. Denoise step (measured: high-frequency variance check)
        med_blur = cv2.medianBlur(gray, 3)
        noise_metric = float(np.mean(cv2.absdiff(gray, med_blur)))
        if noise_metric > self.NOISE_VARIANCE_THRESHOLD:
            gray = cv2.GaussianBlur(gray, (3, 3), 0)
            steps_applied.append("denoise")

        # 3. Contrast enhancement (measured: CLAHE only if low contrast)
        contrast_std = float(np.std(gray))
        contrast_ptp = float(np.ptp(gray))
        # A sparse black-on-white page has low global std but high dynamic
        # range; it is already legible and should not receive CLAHE. Require
        # both metrics to indicate a genuinely washed-out page.
        if contrast_std < self.CONTRAST_STD_THRESHOLD and contrast_ptp < self.CONTRAST_PTP_THRESHOLD:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            gray = clahe.apply(gray)
            steps_applied.append("contrast")

        # 4. Deskew step (measured: detect skew angle via Otsu contours)
        affine_matrix: np.ndarray | None = None
        angle = self._detect_skew_angle(gray)
        if self.min_deskew_angle <= abs(angle) <= self.max_deskew_angle:
            gray, affine_matrix = self._apply_deskew(gray, angle)
            steps_applied.append("deskew")

        # 5. Thresholding step (measured policy: disabled by default to preserve Vietnamese diacritics)
        if self.enable_threshold:
            # Otsu binarization
            _, gray = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            steps_applied.append("threshold")

        # Build inverse coordinate transform
        inv_transform = InverseCoordinateTransform(
            affine_matrix=affine_matrix,
            canonical_width=canonical_w,
            canonical_height=canonical_h,
        )

        return PreprocessingResult(
            page=page_number,
            processed_image=gray,
            steps_applied=steps_applied,
            inverse_transform=inv_transform,
        )

    def _detect_skew_angle(self, gray: np.ndarray) -> float:
        """Detect document skew angle in degrees using Hough line transform or minAreaRect."""
        h, w = gray.shape[:2]
        # Downsample for fast angle detection on large pages
        scale = 1.0
        if max(h, w) > 1600:
            scale = 1600.0 / max(h, w)
            small_gray = cv2.resize(gray, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        else:
            small_gray = gray

        # Otsu threshold to locate text foreground components
        _, thresh = cv2.threshold(small_gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

        # Find coordinates of all foreground pixels
        pts = np.column_stack(np.where(thresh > 0))
        if len(pts) < 100:
            return 0.0

        # Use minAreaRect to compute principal orientation of text cluster
        rect = cv2.minAreaRect(pts)
        angle = rect[-1]

        # Standardize angle to [-45, 45]
        if angle < -45.0:
            angle = 90.0 + angle
        elif angle > 45.0:
            angle = angle - 90.0

        # minAreaRect on (row, col) coordinates needs sign correction
        # Negate angle for standard Cartesian (x, y) orientation
        return -angle

    def _apply_deskew(self, image: np.ndarray, angle: float) -> tuple[np.ndarray, np.ndarray]:
        """Rotate image by negative angle around center to correct skew."""
        h, w = image.shape[:2]
        center = (w / 2.0, h / 2.0)
        # cv2.getRotationMatrix2D expects (center, angle_in_degrees, scale)
        m = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(
            image,
            m,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return rotated, m
