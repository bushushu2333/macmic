const path = require('path');
const os = require('os');

function runtimeConfig(platform = process.platform, home = os.homedir(), appData = process.env.APPDATA) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const root = windows ? paths.join(appData || paths.join(home, 'AppData', 'Roaming'), 'macmic')
    : paths.join(home, 'Library', 'Application Support', 'macmic');
  const model = windows ? 'Qwen3-ASR-1.7B-hf' : 'Qwen3-ASR-1.7B-8bit';
  return { root, model, backend: windows ? 'torch' : 'mlx',
    python: paths.join(root, 'asr-runtime', windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python'),
    modelPath: paths.join(root, 'models', model),
    label: windows ? 'PyTorch · CPU / NVIDIA GPU' : 'MLX · Apple GPU',
    setup: windows ? '请按 Windows 安装说明运行 Setup-Model.ps1，然后重启模型' : '请运行 pnpm setup:model，然后重启模型' };
}
module.exports = { runtimeConfig };
