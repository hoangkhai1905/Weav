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
    load_table_profile,
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


def _set_engine(manifest_file: Path, engine: str) -> None:
    data = json.loads(manifest_file.read_text(encoding="utf-8"))
    data["models"]["vi"]["engine"] = engine
    manifest_file.write_text(json.dumps(data), encoding="utf-8")


def test_engine_defaults_to_paddle(tmp_path: Path) -> None:
    profile = load_model_profile(create_manifest(tmp_path), "vi")
    assert profile["engine"] == "paddle"


def test_onnxruntime_engine_requires_converted_model_files(tmp_path: Path) -> None:
    manifest_file = create_manifest(tmp_path)
    _set_engine(manifest_file, "onnxruntime")

    with pytest.raises(ModelNotReadyError, match="inference.onnx"):
        load_model_profile(manifest_file, "vi")

    for folder in ("detection", "recognition"):
        for name in ("inference.onnx", "inference.yml"):
            (tmp_path / folder / name).write_bytes(b"x")
    assert load_model_profile(manifest_file, "vi")["engine"] == "onnxruntime"


def test_unknown_engine_raises_model_not_ready_error(tmp_path: Path) -> None:
    manifest_file = create_manifest(tmp_path)
    _set_engine(manifest_file, "tensorrt")
    with pytest.raises(ModelNotReadyError, match="unsupported engine"):
        load_model_profile(manifest_file, "vi")


@pytest.mark.parametrize(
    ("engine", "expected"),
    [("paddle", {"enable_mkldnn": False}), ("onnxruntime", {"engine": "onnxruntime"})],
)
def test_manifest_engine_selects_paddleocr_backend(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, engine: str, expected: dict
) -> None:
    import sys
    import types

    from src.infrastructure.engines.paddle_ocr_engine_adapter import (
        PaddleOcrEngineAdapter,
    )

    manifest_file = create_manifest(tmp_path)
    _set_engine(manifest_file, engine)
    for folder in ("detection", "recognition"):
        for name in ("inference.onnx", "inference.yml"):
            (tmp_path / folder / name).write_bytes(b"x")
    calls: list[dict] = []
    fake = types.ModuleType("paddleocr")
    fake.PaddleOCR = lambda **kwargs: calls.append(kwargs) or object()
    monkeypatch.setitem(sys.modules, "paddleocr", fake)
    monkeypatch.delenv("OCR_MODEL_ROOT", raising=False)

    PaddleOcrEngineAdapter(manifest_path=manifest_file)._get_or_create_engine("vi")

    (kwargs,) = calls
    assert {k: kwargs[k] for k in expected} == expected
    assert ("engine" in kwargs) == (engine == "onnxruntime")
    assert kwargs["text_recognition_model_dir"] == str((tmp_path / "recognition").resolve())


def _add_table(manifest_file: Path, rec_dir: str) -> None:
    data = json.loads(manifest_file.read_text(encoding="utf-8"))
    data["table"] = {
        "text_recognition_model_name": "PP-OCRv6_medium_rec",
        "text_recognition_model_dir": rec_dir,
        "use_table_recognition": True,
    }
    manifest_file.write_text(json.dumps(data), encoding="utf-8")


def test_table_profile_absent_or_missing_dir_returns_none(tmp_path: Path) -> None:
    manifest_file = create_manifest(tmp_path)
    assert load_table_profile(manifest_file) is None
    _add_table(manifest_file, "missing-folder")
    assert load_table_profile(manifest_file) is None


def test_table_profile_resolves_dirs_and_keeps_other_keys(tmp_path: Path) -> None:
    manifest_file = create_manifest(tmp_path)
    _add_table(manifest_file, "recognition")
    assert load_table_profile(manifest_file) == {
        "text_recognition_model_name": "PP-OCRv6_medium_rec",
        "text_recognition_model_dir": str((tmp_path / "recognition").resolve()),
        "use_table_recognition": True,
    }


@pytest.mark.parametrize("with_table", [True, False])
def test_table_engine_uses_manifest_models_or_language_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, with_table: bool
) -> None:
    import sys
    import types

    from src.infrastructure.engines.paddle_table_engine_adapter import (
        PaddleTableEngineAdapter,
    )

    manifest_file = create_manifest(tmp_path)
    if with_table:
        _add_table(manifest_file, "recognition")
    monkeypatch.setenv("WEAV_OCR_MODEL_MANIFEST", str(manifest_file))
    monkeypatch.delenv("OCR_MODEL_ROOT", raising=False)
    calls: list[dict] = []
    fake = types.ModuleType("paddleocr")
    fake.PPStructureV3 = lambda **kwargs: calls.append(kwargs) or object()
    monkeypatch.setitem(sys.modules, "paddleocr", fake)

    PaddleTableEngineAdapter()._get_or_create_engine()

    (kwargs,) = calls
    if with_table:
        assert "lang" not in kwargs
        assert kwargs["text_recognition_model_dir"] == str((tmp_path / "recognition").resolve())
    else:
        assert kwargs["lang"] == "vi"
        assert "text_recognition_model_dir" not in kwargs
