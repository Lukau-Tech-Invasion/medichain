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

# Demo experience: password-less local run. The API is SECURE BY DEFAULT
# (signature verification ON), so explicitly opt into demo mode here. Never set
# IS_DEMO=true in production.
export IS_DEMO=true

# Run the server
./target/release/medichain-api
