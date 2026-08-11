@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-monday-lead-utilisation.ps1"
set "REPORT_EXIT=%ERRORLEVEL%"
echo.
if not "%REPORT_EXIT%"=="0" echo The weekly report did not complete. Read the message above.
if "%REPORT_EXIT%"=="0" echo The weekly report completed successfully.
pause
exit /b %REPORT_EXIT%
