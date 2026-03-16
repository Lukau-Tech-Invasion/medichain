@echo off
REM ============================================================================
REM MediChain Quick Start - For Hackathon Judges
REM ============================================================================
REM This script starts the PostgreSQL database and the API server with demo users
REM ============================================================================

echo.
echo ==============================================================================
echo   MEDICHAIN HEALTHCARE API - QUICK START
echo ==============================================================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running!
    echo         Please start Docker Desktop first.
    pause
    exit /b 1
)

echo [1/4] Starting PostgreSQL database...
docker compose up -d postgres
if errorlevel 1 (
    echo [ERROR] Failed to start PostgreSQL container
    pause
    exit /b 1
)

echo [2/4] Waiting for database to be ready...
timeout /t 8 /nobreak >nul

REM Test database connection
docker exec medichain_postgres pg_isready -U medichain >nul 2>&1
if errorlevel 1 (
    echo       Still waiting for database...
    timeout /t 5 /nobreak >nul
)

echo [3/4] Database ready!
echo.
echo [4/4] Starting API server...
echo.
echo ==============================================================================
echo   API will start at: http://localhost:8080
echo   Health check:      http://localhost:8080/health
echo   DB health:         http://localhost:8080/health/db
echo   Demo info:         http://localhost:8080/api/demo/info
echo ==============================================================================
echo.
echo   DEMO ACCOUNTS (use X-User-Id header):
echo   --------------------------------------
echo   Admin:    5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
echo   Doctor:   5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
echo   Nurse:    5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL
echo   Patient:  5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z
echo.
echo   Example: curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" http://localhost:8080/api/users
echo ==============================================================================
echo.

REM Start the API using WSL with pre-compiled binary (faster startup)
wsl -d Ubuntu-22.04 -- bash -c "cd /mnt/c/Users/Admin/OneDrive/Documents/'New folder'/'MEDICHAIN DEVELOPMENT'/medichain && DATABASE_URL='postgresql://medichain:medichain_dev_2024@localhost:5432/medichain' ./target/release/medichain-api"

REM If WSL fails or binary not found, try building
if errorlevel 1 (
    echo.
    echo [INFO] Pre-built binary not found, building...
    wsl -d Ubuntu-22.04 -- bash -c "cd /mnt/c/Users/Admin/OneDrive/Documents/'New folder'/'MEDICHAIN DEVELOPMENT'/medichain && source ~/.cargo/env && DATABASE_URL='postgresql://medichain:medichain_dev_2024@localhost:5432/medichain' cargo run --release -p medichain-api"
)
