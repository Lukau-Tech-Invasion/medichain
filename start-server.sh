#!/bin/bash
# MediChain API Server Startup Script (Linux/WSL)
# ================================================
# 
# Run this script directly inside Ubuntu WSL terminal
#
# Usage: ./start-server.sh
#
# ================================================

echo ""
echo "================================================"
echo "       MediChain API Server Startup"
echo "================================================"
echo ""

# Navigate to the project directory
cd "/mnt/c/Users/Admin/OneDrive/Documents/New folder/MEDICHAIN DEVELOPMENT/medichain"

# Run the server
./target/release/medichain-api
