@echo off
setlocal
cd /d "%~dp0"
set "PORT=8065"
if not "%~1"=="" set "PORT=%~1"
where python >nul 2>&1
if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 (
        python -u -m ergo3d serve --port %PORT% --open
        goto finished
    )
)
where py >nul 2>&1
if not errorlevel 1 (
    py -3 -u -m ergo3d serve --port %PORT% --open
    goto finished
)
echo ERROR: Python 3.9 or newer is required.
echo Install Python from https://www.python.org/downloads/ and enable Add Python to PATH.
:finished
echo.
echo Viewer stopped. If the port is in use, run: StartViewer.cmd 8066
pause
