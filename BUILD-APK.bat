@echo off
setlocal
echo ======================================================
echo       AnimeVault Mobile APK Builder
echo ======================================================
echo.

cd /d "%~dp0"
node mobile/scripts/build-apk.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed with error code %errorlevel%
    pause
    exit /b %errorlevel%
)

echo.
echo ======================================================
echo [SUCCESS] APK built successfully!
echo Binary located at: %~dp0AnimeVault-4.11.2.apk
echo ======================================================
echo.
pause
