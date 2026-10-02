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
]

REQUIRED_PROFILE_KEYS = (
    "text_detection_model_name",
    "text_detection_model_dir",
    "text_recognition_model_name",
    "text_recognition_model_dir",
)


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
            dir_path = Path(cleaned_val).expanduser()
            if dir_path.is_absolute() or cleaned_val.startswith(("/", "\\")):
                if dir_path.is_dir():
                    resolved_dir = dir_path
                elif model_root is not None:
                    # Strip container /models prefix if re-rooting against model_root for host/test portability
                    clean_rel = cleaned_val.lstrip("/\\")
                    if clean_rel.startswith(("models/", "models\\")):
                        clean_rel = clean_rel[7:].lstrip("/\\")
                    resolved_dir = (Path(model_root).expanduser() / clean_rel).resolve()
                else:
                    resolved_dir = dir_path
            elif model_root is not None:
                resolved_dir = (Path(model_root).expanduser() / dir_path).resolve()
            else:
                resolved_dir = (manifest_file.parent / dir_path).resolve()

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

    return resolved_profile
