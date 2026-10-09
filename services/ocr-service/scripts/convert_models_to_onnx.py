#!/usr/bin/env python3
"""Convert the text and table models in a Paddle model manifest to ONNX for config/model-manifest.onnx.json.

Run once inside the OCR image with the model root mounted writable, e.g.:
    uv run --with paddle2onnx==2.1.0 python scripts/convert_models_to_onnx.py \
        --manifest config/model-manifest.json --src-root /models --dst-root /models/onnx

Each <src>/.../<model> folder (inference.json + inference.pdiparams) becomes <dst-root>/<model>/inference.onnx
plus copies of its other files (inference.yml, dictionaries), which PaddleX's onnxruntime engine needs.
Models with Loop subgraphs (SLANet/SLANeXt) get their mis-declared subgraph shapes cleared so ONNX Runtime loads them.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

WEIGHT_FILES = {"inference.json", "inference.pdiparams", "inference.onnx"}


def model_dirs(manifest: Path, src_root: Path) -> list[Path]:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    dirs = {p[k] for p in data["models"].values() for k in ("text_detection_model_dir", "text_recognition_model_dir")}
    dirs |= {v for k, v in data.get("table", {}).items() if k.endswith("_dir")}
    # Manifest paths are container paths under /models; re-root them on --src-root.
    return sorted(src_root / Path(d).relative_to("/models") for d in dirs)


def fix_loop_shapes(model_path: Path) -> None:
    """paddle2onnx declares the Loop condition as a scalar while it is [1]; ORT then refuses the model.

    Clearing the subgraph input/output shapes and value_info lets ORT re-infer them (outputs were
    verified identical to Paddle on our table samples).
    """
    import onnx

    model = onnx.load(str(model_path))
    bodies = [a.g for n in model.graph.node for a in n.attribute if a.type == onnx.AttributeProto.GRAPH]
    if not bodies:
        return
    for body in bodies:
        for io in list(body.input)[1:] + list(body.output):
            io.type.tensor_type.ClearField("shape")
        del body.value_info[:]
    del model.graph.value_info[:]
    onnx.save(model, str(model_path))


def convert(src: Path, dst: Path, opset: int, force: bool) -> None:
    target = dst / "inference.onnx"
    if target.is_file() and not force:
        print(f"skip (exists): {target}")
        return
    dst.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "paddle2onnx",
            "--model_dir", str(src),
            "--model_filename", "inference.json",
            "--params_filename", "inference.pdiparams",
            "--save_file", str(target),
            "--opset_version", str(opset),
        ],
        check=True,
    )
    fix_loop_shapes(target)
    for extra in src.iterdir():
        if extra.is_file() and extra.name not in WEIGHT_FILES:
            shutil.copy2(extra, dst / extra.name)
    print(f"converted: {src} -> {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--manifest", type=Path, default=Path("config/model-manifest.json"))
    parser.add_argument("--src-root", type=Path, default=Path("/models"))
    parser.add_argument("--dst-root", type=Path, default=Path("/models/onnx"))
    parser.add_argument("--opset", type=int, default=14)
    parser.add_argument("--force", action="store_true", help="re-convert models that already have inference.onnx")
    args = parser.parse_args()
    for src in model_dirs(args.manifest, args.src_root):
        if not (src / "inference.json").is_file():
            raise SystemExit(f"missing Paddle model: {src / 'inference.json'}")
        convert(src, args.dst_root / src.name, args.opset, args.force)


if __name__ == "__main__":
    main()
