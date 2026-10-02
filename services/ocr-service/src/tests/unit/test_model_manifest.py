#!/usr/bin/env python3
"""Unit tests for offline model manifest resolution and profile loading."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.domain.errors import ModelNotReadyError
from src.infrastructure.engines.model_manifest import (
    configured_manifest_path,
    load_model_profile,
)


def create_manifest(tmp_path: Path) -> Path:
    """Create tmp_path/detection and tmp_path/recognition directories and write manifest."""
    (tmp_path / "detection").mkdir(parents=True, exist_ok=True)
    (tmp_path / "recognition").mkdir(parents=True, exist_ok=True)

    manifest_file = tmp_path / "model-manifest.json"
    manifest_data = {
        "version": 1,
        "models": {
            "vi": {
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_detection_model_dir": "detection",
                "text_recognition_model_name": "PP-OCRv6_medium_rec",
                "text_recognition_model_dir": "recognition",
            }
        },
    }
    manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")
    return manifest_file


def test_explicit_configured_manifest_path_wins_over_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Test explicit configured_manifest_path wins over WEAV_OCR_MODEL_MANIFEST."""
    explicit_file = tmp_path / "explicit-manifest.json"
    env_file = tmp_path / "env-manifest.json"
    monkeypatch.setenv("WEAV_OCR_MODEL_MANIFEST", str(env_file))

    resolved = configured_manifest_path(str(explicit_file))
    assert resolved == explicit_file.expanduser()


def test_configured_manifest_path_uses_env_when_explicit_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Test env path is used when explicit path is absent."""
    env_file = tmp_path / "env-manifest.json"
    monkeypatch.setenv("WEAV_OCR_MODEL_MANIFEST", str(env_file))

    resolved = configured_manifest_path()
    assert resolved == env_file.expanduser()


def test_load_model_profile_resolves_relative_dirs_and_keys(tmp_path: Path) -> None:
    """Test load_model_profile resolves both relative directories and returns expected names/keys."""
    manifest_file = create_manifest(tmp_path)

    profile = load_model_profile(manifest_file, "vi")

    assert profile["text_detection_model_name"] == "PP-OCRv5_mobile_det"
    assert profile["text_recognition_model_name"] == "PP-OCRv6_medium_rec"
    assert profile["text_detection_model_dir"] == str(
        (tmp_path / "detection").resolve()
    )
    assert profile["text_recognition_model_dir"] == str(
        (tmp_path / "recognition").resolve()
    )


def test_missing_model_directory_raises_model_not_ready_error(
    tmp_path: Path,
) -> None:
    """Test missing model directory raises ModelNotReadyError."""
    manifest_file = create_manifest(tmp_path)
    (tmp_path / "detection").rmdir()

    with pytest.raises(ModelNotReadyError):
        load_model_profile(manifest_file, "vi")


def test_invalid_json_raises_model_not_ready_error(
    tmp_path: Path,
) -> None:
    """Test invalid JSON in manifest raises ModelNotReadyError."""
    manifest_file = tmp_path / "model-manifest.json"
    manifest_file.write_text("{ invalid json", encoding="utf-8")

    with pytest.raises(ModelNotReadyError):
        load_model_profile(manifest_file, "vi")


def test_load_model_profile_reroutes_container_prefix_when_model_root_provided(
    tmp_path: Path,
) -> None:
    """Test /models container prefix is safely re-rooted when model_root is provided."""
    model_root = tmp_path / "custom_root"
    (model_root / "paddlex-cache" / "official_models" / "det").mkdir(
        parents=True, exist_ok=True
    )
    (model_root / "paddlex-cache" / "official_models" / "rec").mkdir(
        parents=True, exist_ok=True
    )

    manifest_file = tmp_path / "model-manifest.json"
    manifest_data = {
        "version": 1,
        "models": {
            "vi": {
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_detection_model_dir": "/models/paddlex-cache/official_models/det",
                "text_recognition_model_name": "PP-OCRv6_medium_rec",
                "text_recognition_model_dir": "/models/paddlex-cache/official_models/rec",
            }
        },
    }
    manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

    profile = load_model_profile(manifest_file, "vi", model_root=model_root)

    expected_det = str(
        (model_root / "paddlex-cache" / "official_models" / "det").resolve()
    )
    expected_rec = str(
        (model_root / "paddlex-cache" / "official_models" / "rec").resolve()
    )
    assert profile["text_detection_model_dir"] == expected_det
    assert profile["text_recognition_model_dir"] == expected_rec
