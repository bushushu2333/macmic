const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
if (process.platform !== 'win32') process.exit(0);
const root = path.join(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(compiler)) throw new Error('The Windows .NET Framework 4 C# compiler is required to build the Alt shortcut helper.');
mkdirSync(path.join(root, 'native', 'bin'), { recursive: true });
const output = path.join(root, 'native', 'bin', 'macmic-hotkey.exe');
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
  '/reference:System.Windows.Forms.dll', `/out:${output}`,
  path.join(root, 'native', 'windows', 'AltTap.cs')], { stdio: 'inherit', windowsHide: true });
execFileSync(output, ['--self-test'], { stdio: 'inherit', windowsHide: true });
