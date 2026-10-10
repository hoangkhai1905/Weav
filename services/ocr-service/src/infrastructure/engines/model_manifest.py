#!/usr/bin/env python3
"""Model manifest configuration and loader helpers for OCR engines."""

from __future__ import annotations

import json
import os
from pathlib import Path

from src.domain.errors import ModelNotReadyError

__all__ = [
    "configured_manifest_path",
    "load_model_profile",
    "load_table_profile",
]

REQUIRED_PROFILE_KEYS = (
    "text_detection_model_name",
    "text_detection_model_dir",
    "text_recognition_model_name",
    "text_recognition_model_dir",
)

# Optional profile key "engine": PaddleOCR inference backend. Absent means Paddle.
SUPPORTED_ENGINES = ("paddle", "onnxruntime")
# PaddleX's onnxruntime engine loads these from each model directory.
ONNX_REQUIRED_FILES = ("inference.onnx", "inference.yml")


def configured_manifest_path(explicit_path: str | None = None) -> Path | None:
    """Resolve model manifest path from an explicit argument or WEAV_OCR_MODEL_MANIFEST."""
    if explicit_path is not None and str(explicit_path).strip():
        return Path(str(explicit_path).strip()).expanduser()

    env_val = os.environ.get("WEAV_OCR_MODEL_MANIFEST")
    if env_val is not None and env_val.strip():
        return Path(env_val.strip()).expanduser()

    return None


def load_model_profile(
    manifest_path: Path,
    profile: str,
    model_root: Path | None = None,
) -> dict[str, str]:
    """Load and validate an offline model profile from a JSON manifest.

    Raises:
        ModelNotReadyError: If the manifest file is missing or invalid, required
            fields are absent, or configured model directories do not exist.
    """
    try:
        manifest_file = Path(manifest_path).expanduser()
        if not manifest_file.is_file():
            raise ModelNotReadyError(
                f"Model manifest file not found or is not a file: '{manifest_file}'"
            )
    except ModelNotReadyError:
        raise
    except (TypeError, ValueError, OSError) as exc:
        raise ModelNotReadyError(
            f"Failed to access model manifest path '{manifest_path}': {exc}"
        ) from exc

    try:
        content = manifest_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ModelNotReadyError(
            f"Failed to read model manifest file '{manifest_file}': {exc}"
        ) from exc

    try:
        manifest_data = json.loads(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ModelNotReadyError(
            f"Invalid JSON in model manifest '{manifest_file}': {exc}"
        ) from exc

    if not isinstance(manifest_data, dict):
        raise ModelNotReadyError(
            f"Model manifest '{manifest_file}' root must be a JSON object"
        )

    models = manifest_data.get("models")
    if not isinstance(models, dict) or not models:
        raise ModelNotReadyError(
            f"Model manifest '{manifest_file}' must contain a non-empty 'models' object"
        )

    if not isinstance(profile, str) or not profile.strip():
        raise ModelNotReadyError("Profile name must be a non-empty string")

    if profile not in models:
        raise ModelNotReadyError(
            f"Model manifest '{manifest_file}' does not configure required profile '{profile}'"
        )

    profile_data = models[profile]
    if not isinstance(profile_data, dict):
        raise ModelNotReadyError(
            f"Model manifest profile '{profile}' in '{manifest_file}' must be a JSON object"
        )

    resolved_profile: dict[str, str] = {
        str(k): str(v) for k, v in profile_data.items() if isinstance(v, str)
    }

    for key in REQUIRED_PROFILE_KEYS:
        val = profile_data.get(key)
        if not isinstance(val, str) or not val.strip():
            raise ModelNotReadyError(
                f"Model profile '{profile}' in manifest '{manifest_file}' is missing "
                f"or has empty required string '{key}'"
            )

        cleaned_val = val.strip()
        if key.endswith("_dir"):
            resolved_dir = _resolve_model_dir(cleaned_val, manifest_file, model_root)

            try:
                if not resolved_dir.is_dir():
                    raise ModelNotReadyError(
                        f"Model directory '{resolved_dir}' for profile '{profile}' ({key}) "
                        f"in manifest '{manifest_file}' does not exist or is not a directory"
                    )
            except ModelNotReadyError:
                raise
            except OSError as exc:
                raise ModelNotReadyError(
                    f"Failed to access model directory '{resolved_dir}' for profile '{profile}' ({key}): {exc}"
                ) from exc

            resolved_profile[key] = str(resolved_dir)
        else:
            resolved_profile[key] = cleaned_val

    engine = str(profile_data.get("engine", "paddle")).strip()
    if engine not in SUPPORTED_ENGINES:
        raise ModelNotReadyError(
            f"Model profile '{profile}' in manifest '{manifest_file}' has unsupported engine "
            f"'{engine}'; expected one of {', '.join(SUPPORTED_ENGINES)}"
        )
    resolved_profile["engine"] = engine
    if engine == "onnxruntime":
        for key in ("text_detection_model_dir", "text_recognition_model_dir"):
            for name in ONNX_REQUIRED_FILES:
                if not (Path(resolved_profile[key]) / name).is_file():
                    raise ModelNotReadyError(
                        f"Model profile '{profile}' uses engine 'onnxruntime' but '{name}' is missing "
                        f"in '{resolved_profile[key]}' ({key}); convert the models to ONNX first"
                    )

    return resolved_profile


def _resolve_model_dir(raw: str, manifest_file: Path, model_root: Path | None) -> Path:
    """Resolve a manifest model directory (container /models paths re-root on model_root)."""
    dir_path = Path(raw).expanduser()
    if dir_path.is_absolute() or raw.startswith(("/", "\\")):
        if dir_path.is_dir() or model_root is None:
            return dir_path
        # Strip container /models prefix if re-rooting against model_root for host/test portability
        clean_rel = raw.lstrip("/\\")
        if clean_rel.startswith(("models/", "models\\")):
            clean_rel = clean_rel[7:].lstrip("/\\")
        return (Path(model_root).expanduser() / clean_rel).resolve()
    if model_root is not None:
        return (Path(model_root).expanduser() / dir_path).resolve()
    return (manifest_file.parent / dir_path).resolve()


def load_table_profile(manifest_path: Path, model_root: Path | None = None) -> dict[str, object] | None:
    """Return PP-StructureV3 kwargs from the manifest's optional "table" object.

    Returns None when the manifest has no table section, a configured model directory is missing,
    or (with "engine": "onnxruntime") a folder lacks its converted model, so callers can fall back
    to PaddleOCR's default (downloaded) table models.
    """
    try:
        manifest_file = Path(manifest_path).expanduser()
        table = json.loads(manifest_file.read_text(encoding="utf-8")).get("table")
    except (OSError, UnicodeDecodeError, ValueError, AttributeError):
        return None
    if not isinstance(table, dict) or not table:
        return None
    resolved: dict[str, object] = {}
    for key, val in table.items():
        if key.endswith("_dir") and isinstance(val, str):
            path = _resolve_model_dir(val.strip(), manifest_file, model_root)
            if not path.is_dir():
                return None
            if table.get("engine") == "onnxruntime" and not all(
                (path / name).is_file() for name in ONNX_REQUIRED_FILES
            ):
                return None
            resolved[key] = str(path)
        else:
            resolved[key] = val
    return resolved
