@echo off
REM ═══════════════════════════════════════════════════════════════════════════════
REM TSG Suite – broadcast tools for alignment, metering, and signal verification
REM Maintained by David Thåst  ·  https://github.com/FiLORUX
REM
REM Built with the assumption that behaviour should be predictable,
REM output should be verifiable, and silence should mean silence
REM
REM david@thast.se  ·  +46 700 30 30 60
REM ═══════════════════════════════════════════════════════════════════════════════

REM ═══════════════════════════════════════════════════════════════════════════════
REM CHROME LAUNCHER (Windows)
REM ═══════════════════════════════════════════════════════════════════════════════
REM Opens Chrome with --allow-file-access-from-files flag for ES module support
REM on file:// protocol.
REM
REM Security note: This flag allows ALL local files to access other local files.
REM Only use in trusted environments. Close Chrome when finished.
REM ═══════════════════════════════════════════════════════════════════════════════

setlocal

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "INDEX_FILE=%PROJECT_DIR%\index.html"

echo Launching Chrome with file:// access enabled...
echo Opening: %INDEX_FILE%
echo.
echo WARNING: Security note - Close this Chrome window when finished.
echo.

REM Try common Chrome installation paths
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files "file:///%INDEX_FILE:\=/%"
    goto :end
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files "file:///%INDEX_FILE:\=/%"
    goto :end
)

if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files "file:///%INDEX_FILE:\=/%"
    goto :end
)

REM Fallback: try to launch via start command
start chrome --allow-file-access-from-files "file:///%INDEX_FILE:\=/%"

:end
endlocal
