// electron-builder 24 cannot execute pnpm.cjs directly on Windows.
// Resolve the native dependency's installer through pnpm's actual package directory.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRequire } = require('node:module');
if (process.platform !== 'win32') {
  const cli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [cli, 'install-app-deps'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const sqlitePackage = require.resolve('better-sqlite3/package.json');
const nativeRequire = createRequire(sqlitePackage);
const cwd = path.dirname(sqlitePackage);
const target = require('../package.json').devDependencies.electron;
const installer = nativeRequire.resolve('prebuild-install/bin.js');
const prebuilt = spawnSync(process.execPath, [installer, '--runtime=electron', `--target=${target}`, '--arch=x64', '--platform=win32'], { cwd, stdio: 'inherit' });
if (prebuilt.status === 0) process.exit(0);
const gyp = require.resolve('node-gyp/bin/node-gyp.js');
const build = spawnSync(process.execPath, [gyp, 'rebuild', '--release', `--target=${target}`, '--arch=x64', '--dist-url=https://electronjs.org/headers'], { cwd, stdio: 'inherit' });
process.exit(build.status ?? 1);
