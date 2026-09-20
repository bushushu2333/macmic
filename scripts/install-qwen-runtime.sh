#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'macmic requires an Apple Silicon Mac and a native arm64 terminal.' >&2
  exit 1
fi
command -v uv >/dev/null 2>&1 || { echo 'Install uv first (for example: brew install uv).' >&2; exit 1; }
MACMIC_ROOT="$HOME/Library/Application Support/macmic"
MACMIC_SCRIPTS=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$MACMIC_ROOT"
chmod 700 "$MACMIC_ROOT"
if [ ! -x "$MACMIC_ROOT/asr-runtime/bin/python" ]; then
  uv venv --python 3.11 "$MACMIC_ROOT/asr-runtime"
fi
uv pip sync --python "$MACMIC_ROOT/asr-runtime/bin/python" "$MACMIC_SCRIPTS/qwen-runtime-lock.txt"
HF_HUB_DISABLE_XET=1 "$MACMIC_ROOT/asr-runtime/bin/python" - <<'PY'
from huggingface_hub import snapshot_download
from pathlib import Path
snapshot_download('mlx-community/Qwen3-ASR-1.7B-8bit', revision='a8379a2e2f9e313c9292cdf1af4055ab56d50d55', local_dir=str(Path.home()/'Library/Application Support/macmic/models/Qwen3-ASR-1.7B-8bit'))
print('macmic local model is ready.')
PY
