@echo off
rem Opens the design preview. It needs a local web server: the popup script is a
rem JavaScript module, which browsers won't load from a page opened as a file.
rem Close this window to stop the server.
cd /d "%~dp0.."
start "" "http://127.0.0.1:8793/design-options/preview.html"
python -m http.server 8793 --bind 127.0.0.1
