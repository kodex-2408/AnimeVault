@echo off
rem Builds dist\manga-translator-<version>.zip to share with others.
rem It contains only the extension, the README and the changelog. Your Gemini key
rem is never included: it lives in your browser, not in these files.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$v = (Get-Content extension\manifest.json -Raw | ConvertFrom-Json).version;" ^
  "New-Item -ItemType Directory dist -Force | Out-Null;" ^
  "$zip = \"dist\manga-translator-$v.zip\";" ^
  "if (Test-Path $zip) { Remove-Item $zip };" ^
  "Compress-Archive -Path extension, README.md, CHANGELOG.md -DestinationPath $zip;" ^
  "Write-Host \"Created $zip\""
if errorlevel 1 (
  echo Packaging failed.
  exit /b 1
)
