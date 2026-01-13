# MediChain API Server Startup Script
# =====================================
# 
# PREREQUISITES:
# 1. WSL Ubuntu-22.04 must be running
# 2. You may need to login to Ubuntu first and enter your password
#
# HOW TO USE:
# Option 1: Open Ubuntu terminal first, then run the server
# Option 2: Run this script from PowerShell
#
# =====================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "       MediChain API Server Startup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting server via WSL Ubuntu-22.04..." -ForegroundColor Yellow
Write-Host ""
Write-Host "If prompted, enter your Ubuntu password." -ForegroundColor Magenta
Write-Host ""

# Start the server
wsl -d Ubuntu-22.04 -e bash -c "cd '/mnt/c/Users/Admin/OneDrive/Documents/New folder/MEDICHAIN DEVELOPMENT/medichain' && ./target/release/medichain-api"
