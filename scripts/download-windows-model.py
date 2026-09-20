"""Explicit installation only. The inference worker never downloads files."""
import os
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path(os.environ['APPDATA']) / 'macmic'
snapshot_download(
    'Qwen/Qwen3-ASR-1.7B-hf',
    revision='bcd2b5b7f32b480ab5790554cfa8347f246a14f3',
    local_dir=str(root / 'models' / 'Qwen3-ASR-1.7B-hf'),
    allow_patterns=['*.json', '*.safetensors', '*.txt', '*.jinja', '*.model'],
)
print('macmic Windows model ready.')
