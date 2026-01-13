@echo off
REM ============================================================
REM MediChain API Server - Quick Run
REM Just runs the API server in WSL (simplest option)
REM ============================================================

echo Starting MediChain API Server...
echo.

wsl -d Ubuntu-22.04 -- bash -c "cd /mnt/c/Users/Admin/OneDrive/Documents/'New folder'/'MEDICHAIN DEVELOPMENT'/medichain && source ~/.cargo/env && RUST_LOG=info cargo run --release -p medichain-api"

pause
