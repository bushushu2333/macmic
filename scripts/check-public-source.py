"""Reject common accidental private artifacts and literal credentials in Git sources."""
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root).decode().split('\0')
patterns = [
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(r'\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}'),
    re.compile(r'\bsk-[A-Za-z0-9_-]{20,}'),
    re.compile(r'/Users/[A-Za-z0-9_.-]+/'),
]
errors = []
for name in dict.fromkeys(paths):
    if not name:
        continue
    p = root / name
    if p.is_symlink():
        errors.append(f'{name}: symlink must not be published')
        continue
    if not p.is_file():
        continue
    if p.suffix.lower() in {'.db', '.sqlite', '.wav', '.aiff', '.mp3', '.m4a', '.webm', '.safetensors', '.pem', '.key'} or p.name == '.env':
        errors.append(f'{name}: private/generated artifact')
    if p.stat().st_size > 10 * 1024 * 1024:
        errors.append(f'{name}: file exceeds source-size limit')
    if p.suffix.lower() in {'.png', '.icns', '.ico'}:
        continue
    text = p.read_text(errors='replace')
    for pattern in patterns:
        if pattern.search(text):
            errors.append(f'{name}: possible private value (content omitted)')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print('PASS: no prohibited artifacts, absolute home paths or common literal credential patterns.')
