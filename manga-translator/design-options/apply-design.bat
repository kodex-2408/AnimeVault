@echo off
rem Makes one of the popup designs the extension's popup.
rem Usage: apply-design.bat 2-fuki   (or 0-original, 1-polished, 3-panel)
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: apply-design.bat ^<design^>
  for /d %%d in (*) do echo   %%d
  exit /b 1
)
if not exist "%~1\popup.html" (
  echo No design named "%~1".
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$enc = New-Object Text.UTF8Encoding $false; $dst = (Resolve-Path '..\extension').Path;" ^
  "$html = Get-Content -Raw -Encoding UTF8 '%~1\popup.html';" ^
  "$html = $html -replace '\s*<script src=\"\.\./mock-chrome\.js\"></script>', '' -replace '\.\./\.\./extension/', '';" ^
  "[IO.File]::WriteAllText(\"$dst\popup.html\", $html, $enc);" ^
  "$css = (Get-Content -Raw -Encoding UTF8 '%~1\popup.css') -replace '\.\./\.\./extension/', '';" ^
  "[IO.File]::WriteAllText(\"$dst\popup.css\", $css, $enc)"
if errorlevel 1 exit /b 1
echo Applied "%~1". Reload the extension in chrome://extensions to see it.
