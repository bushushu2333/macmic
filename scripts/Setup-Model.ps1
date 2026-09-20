# macmic: run once on Windows x64. Installs only into the current user's data folder.
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Windows x64 is required.' }
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first: winget install --id astral-sh.uv -e ; then open a NEW PowerShell window.' }
$MacmicRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'macmic'
$Runtime = Join-Path $MacmicRoot 'asr-runtime'
$Python = Join-Path $Runtime 'Scripts\python.exe'
New-Item -ItemType Directory -Force -Path $MacmicRoot | Out-Null
if (-not (Test-Path $Python)) {
    & uv venv --python 3.11 $Runtime
    if ($LASTEXITCODE -ne 0) { throw 'Python environment installation failed.' }
}
& uv pip sync --python $Python (Join-Path $PSScriptRoot 'requirements-windows.txt')
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed. Run this script again to retry.' }
$env:HF_HUB_DISABLE_XET = '1'
$env:PYTHONIOENCODING = 'utf-8'
& $Python (Join-Path $PSScriptRoot 'download-windows-model.py')
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Run this script again to resume.' }
Write-Host 'macmic model ready. Open the app or click Restart model in Preferences.' -ForegroundColor Green
