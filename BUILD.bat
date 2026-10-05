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
echo           2   ARM64   Snapdragon / ARM laptops  (native, no emulation)
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

echo  [ ^>^> ]   Building for: %ARCH_LABEL%
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
if "%arch%"=="2" (echo  [ 2/2 ]  Compiling native ARM64 app...) else (echo  [ 2/2 ]  Compiling portable .exe...)
if "%arch%"=="1" (call npm run build-x64) else if "%arch%"=="2" (call npm run build-arm64) else (call npm run build)

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR]  Build failed.
    echo           Fixes:
    echo             - Review the build error above
    echo             - Close any running AnimeVault, then retry
    echo.
    pause & exit /b 1
)

:: Done
echo.
echo  +--------------------------------------------------+
echo  ^|  DONE!   Output is in the  dist\  folder         ^|
echo  +--------------------------------------------------+
echo.
if "%arch%"=="1" (
    echo  File:    dist\AnimeVault-x64.exe
    echo  Usage:   No install required. Share or run directly.
)
if not "%arch%"=="1" (
    if "%arch%"=="3" echo  x64:     dist\AnimeVault-x64.exe   ^(portable, run directly^)
    echo  ARM64:   dist\win-arm64-unpacked\AnimeVault.exe   ^(run this^)
    echo           dist\AnimeVault-arm64.zip   ^(same app - extract anywhere and run AnimeVault.exe^)
    echo.
    echo  Why no single ARM64 .exe: the one-file portable format starts through an
    echo  x86 launcher that Windows runs emulated. The folder / zip app is native ARM64.
)
echo.
pause
