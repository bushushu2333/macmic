const { execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
if (process.platform !== 'darwin') process.exit(0);
const root = path.join(__dirname, '..');
mkdirSync(path.join(root, 'native', 'bin'), { recursive: true });
const output = path.join(root, 'native', 'bin', 'macmic-hotkey');
execFileSync('xcrun', ['swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,
  path.join(root, 'native', 'macos', 'RightCommand.swift'), '-o', output], { stdio: 'inherit' });
execFileSync(output, ['--self-test'], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
