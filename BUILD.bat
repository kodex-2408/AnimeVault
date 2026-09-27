@echo off
setlocal enabledelayedexpansion
title AnimeVault Builder

cls
echo.
echo  +--------------------------------------------------+
echo  ^|    AnimeVault  ^|  Portable Builder               ^|
echo  +--------------------------------------------------+
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR]  Node.js not found.
    echo           Install from: https://nodejs.org/
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%V in ('node -v 2^>nul') do set NODE_VER=%%V
echo  [ OK ]   Node.js %NODE_VER% detected
echo.

:: Architecture
echo  [ ? ]    Select target architecture:
echo.
echo           1   x64     Intel / AMD  (most common)
echo           2   ARM64   Snapdragon / ARM laptops
echo           3   Both    x64 + ARM64
echo.
set /p arch="          Your choice (1/2/3): "
echo.

if not "%arch%"=="1" if not "%arch%"=="2" if not "%arch%"=="3" (
    echo  [WARN]   Invalid choice. Defaulting to x64.
    set arch=1
)
if "%arch%"=="1" (set ARCH_LABEL=x64)
if "%arch%"=="2" (set ARCH_LABEL=arm64)
if "%arch%"=="3" (set ARCH_LABEL=x64 + arm64)
if not defined ARCH_LABEL set ARCH_LABEL=x64

echo  [ >> ]   Building for: %ARCH_LABEL%
echo.

:: Install - always sync dependencies. An updated app folder keeps its old
:: node_modules otherwise, and would build the new code on an old Electron.
echo  [ 1/2 ]  Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo  [ERROR]  npm install failed.
    echo           Review the npm error above, then re-run this script.
    echo.
    pause & exit /b 1
)
echo  [ OK ]   Dependencies ready
echo.

:: Build
echo  [ 2/2 ]  Compiling portable .exe...
if "%arch%"=="1" (call npm run build-x64) else if "%arch%"=="2" (call npm run build-arm64) else (call npm run build)

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR]  Build failed.
    echo           Fixes:
    echo             - Review the build error above
    echo             - Confirm bin\mpv.exe and required DLLs are present
    echo.
    pause & exit /b 1
)

:: Done
echo.
echo  +--------------------------------------------------+
echo  ^|  DONE!   Output is in the  dist\  folder         ^|
echo  +--------------------------------------------------+
echo.
if "%arch%"=="3" (
    echo  Files:   dist\AnimeVault-x64.exe
    echo           dist\AnimeVault-arm64.exe
) else (
    echo  File:    dist\AnimeVault-%ARCH_LABEL%.exe
)
echo  Usage:   No install required. Share or run directly.
echo.
pause
