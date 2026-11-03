#!/usr/bin/env bash
# Fetch the OCR models from Hugging Face and convert them to ONNX for the demo host (run from the repo root).
# Usage: scripts/setup-ocr-models.sh <models-root>   (compose.prod.yml mounts it as WEAV_OCR_MODELS_DIR)
# Result: <root>/paddlex-cache/official_models/<folder> (Paddle files) and <root>/onnx/<folder> (ONNX, used at runtime).
# Safe to re-run: existing files are skipped and already converted models are not converted again.
set -euo pipefail
cd "$(dirname "$0")/.."

root="${1:?usage: $0 <models-root>}"
mkdir -p "$root"
root="$(cd "$root" && pwd)"
src="$root/paddlex-cache/official_models"

# "<hugging face repo> <local folder>"
models=(
  "PaddlePaddle/PP-OCRv5_mobile_det PP-OCRv5_mobile_det"
  "tieubaoca/pp-ocrv6-medium-rec-vietnamese pp-ocrv6-medium-rec-vietnamese"
  "PaddlePaddle/en_PP-OCRv5_mobile_rec en_PP-OCRv5_mobile_rec"
  "PaddlePaddle/PP-DocLayout_plus-L PP-DocLayout_plus-L"
  "PaddlePaddle/PP-LCNet_x1_0_table_cls PP-LCNet_x1_0_table_cls"
  "PaddlePaddle/SLANet_plus SLANet_plus"
  "PaddlePaddle/RT-DETR-L_wired_table_cell_det RT-DETR-L_wired_table_cell_det"
  "PaddlePaddle/RT-DETR-L_wireless_table_cell_det RT-DETR-L_wireless_table_cell_det"
)

for entry in "${models[@]}"; do
  read -r repo folder <<<"$entry"
  files=(inference.json inference.pdiparams inference.yml)
  [ "$folder" = pp-ocrv6-medium-rec-vietnamese ] && files+=(ppocr_keys.txt)
  mkdir -p "$src/$folder"
  for f in "${files[@]}"; do
    [ -f "$src/$folder/$f" ] && continue
    echo "download $repo/$f"
    # temp file + mv: an interrupted download is never mistaken for a finished one
    curl -fL --retry 3 -o "$src/$folder/$f.part" "https://huggingface.co/$repo/resolve/main/$f"
    mv "$src/$folder/$f.part" "$src/$folder/$f"
  done
done

trap 'docker image rm weav-ocr-convert >/dev/null 2>&1 || true' EXIT
docker build --build-arg OCR_RUNTIME=paddle -t weav-ocr-convert -f services/ocr-service/Dockerfile.dev services/ocr-service
docker run --rm -e UV_NO_SYNC=0 -v "$root:/models-rw" -v "$PWD/services/ocr-service/scripts:/app/scripts:ro" weav-ocr-convert \
  uv run --extra paddle --with paddle2onnx==2.1.0 python scripts/convert_models_to_onnx.py --src-root /models-rw --dst-root /models-rw/onnx

for entry in "${models[@]}"; do
  folder="${entry#* }"
  for f in inference.onnx inference.yml; do
    [ -f "$root/onnx/$folder/$f" ] || { echo "missing $root/onnx/$folder/$f" >&2; exit 1; }
  done
done
echo "OCR models ready in $root/onnx"
