@echo off
REM ============================================================
REM MediChain Quick Start Script
REM Run this from Windows to start the development environment
REM ============================================================

echo.
echo  ███╗   ███╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗   ██╗
echo  ████╗ ████║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗  ██║
echo  ██╔████╔██║█████╗  ██║  ██║██║██║     ███████║███████║██║██╔██╗ ██║
echo  ██║╚██╔╝██║██╔══╝  ██║  ██║██║██║     ██╔══██║██╔══██║██║██║╚██╗██║
echo  ██║ ╚═╝ ██║███████╗██████╔╝██║╚██████╗██║  ██║██║  ██║██║██║ ╚████║
echo  ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
echo.
echo  Health ID and Emergency Records Platform - Quick Start
echo  ============================================
echo.

REM Check if WSL is available
wsl --status >nul 2>&1
if errorlevel 1 (
    echo [ERROR] WSL is not installed or not running.
    echo Please install WSL2 with Ubuntu-22.04
    pause
    exit /b 1
)

echo [1/3] Starting Ubuntu WSL environment...
echo.

REM Get the Windows path and convert to WSL path
set "WIN_PATH=%~dp0"
set "WIN_PATH=%WIN_PATH:~0,-1%"

REM Run the startup script in WSL
wsl -d Ubuntu-22.04 -- bash -c "cd \"$(wslpath '%WIN_PATH%')\" && ./scripts/start-dev.sh"

pause
