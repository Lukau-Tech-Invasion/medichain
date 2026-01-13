#!/bin/bash
# ============================================================
# MediChain Development Startup Script
# Run this in WSL/Linux to start all services
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}"
echo "  ███╗   ███╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗   ██╗"
echo "  ████╗ ████║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗  ██║"
echo "  ██╔████╔██║█████╗  ██║  ██║██║██║     ███████║███████║██║██╔██╗ ██║"
echo "  ██║╚██╔╝██║██╔══╝  ██║  ██║██║██║     ██╔══██║██╔══██║██║██║╚██╗██║"
echo "  ██║ ╚═╝ ██║███████╗██████╔╝██║╚██████╗██║  ██║██║  ██║██║██║ ╚████║"
echo "  ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝"
echo -e "${NC}"
echo -e "${GREEN}  Healthcare Blockchain Platform${NC}"
echo "  ========================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${BLUE}[INFO]${NC} Project directory: $PROJECT_DIR"
echo ""

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}[INFO]${NC} Shutting down services..."
    
    # Kill background processes
    if [ ! -z "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
    fi
    if [ ! -z "$IPFS_PID" ]; then
        kill $IPFS_PID 2>/dev/null || true
    fi
    
    echo -e "${GREEN}[INFO]${NC} All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================================
# Step 1: Check Rust Installation
# ============================================================
echo -e "${BLUE}[1/5]${NC} Checking Rust installation..."

if ! command_exists rustc; then
    echo -e "${YELLOW}[WARN]${NC} Rust not found. Installing..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Ensure cargo env is loaded
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

RUST_VERSION=$(rustc --version 2>/dev/null || echo "not installed")
echo -e "${GREEN}[OK]${NC} Rust: $RUST_VERSION"

# ============================================================
# Step 2: Check Node.js Installation
# ============================================================
echo -e "${BLUE}[2/5]${NC} Checking Node.js installation..."

if ! command_exists node; then
    echo -e "${YELLOW}[WARN]${NC} Node.js not found."
    echo "  Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
else
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}[OK]${NC} Node.js: $NODE_VERSION"
fi

# ============================================================
# Step 3: Build API Server
# ============================================================
echo -e "${BLUE}[3/5]${NC} Building API server..."

if [ ! -f "target/release/medichain-api" ]; then
    echo "  First build - this may take a few minutes..."
    cargo build --release -p medichain-api
else
    # Check if source files are newer than binary
    if find api/src -name "*.rs" -newer target/release/medichain-api 2>/dev/null | grep -q .; then
        echo "  Source changed - rebuilding..."
        cargo build --release -p medichain-api
    else
        echo -e "${GREEN}[OK]${NC} API binary is up to date"
    fi
fi

# ============================================================
# Step 4: Start IPFS (Optional)
# ============================================================
echo -e "${BLUE}[4/5]${NC} Checking IPFS..."

if command_exists ipfs; then
    if ! pgrep -x "ipfs" > /dev/null; then
        echo "  Starting IPFS daemon..."
        ipfs daemon &
        IPFS_PID=$!
        sleep 3
        echo -e "${GREEN}[OK]${NC} IPFS started (PID: $IPFS_PID)"
    else
        echo -e "${GREEN}[OK]${NC} IPFS already running"
    fi
else
    echo -e "${YELLOW}[SKIP]${NC} IPFS not installed (optional)"
fi

# ============================================================
# Step 5: Start API Server
# ============================================================
echo -e "${BLUE}[5/5]${NC} Starting API server..."
echo ""

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                    MediChain Services                            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  📡 API Server:    http://localhost:8080                         ║"
echo "║  📋 Demo Info:     http://localhost:8080/api/demo                ║"
echo "║  ❤️  Health Check:  http://localhost:8080/health                  ║"
echo "║  📖 Swagger/Docs:  http://localhost:8080/swagger-ui              ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  🏥 Doctor Portal: cd client/doctor-portal && npm run dev        ║"
echo "║  👤 Patient App:   cd client/patient-app && npm run dev          ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Press Ctrl+C to stop all services                               ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Run API server in foreground
RUST_LOG=info ./target/release/medichain-api
