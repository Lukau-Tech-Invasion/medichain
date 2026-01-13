# MediChain Setup & Running Guide

> **Platform:** Linux / WSL (Windows Subsystem for Linux)  
> **Last Updated:** January 6, 2026  
> © 2025 Trustware. All rights reserved.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Setup](#2-initial-setup)
3. [Building the Project](#3-building-the-project)
4. [Running the API Server](#4-running-the-api-server)
5. [Setting Up IPFS](#5-setting-up-ipfs)
6. [Running the Frontend Apps](#6-running-the-frontend-apps)
7. [Running Tests](#7-running-tests)
8. [Development Workflow](#8-development-workflow)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### System Requirements

- **OS:** Ubuntu 20.04+ / Debian 11+ / WSL2
- **RAM:** 8GB minimum (16GB recommended)
- **Disk:** 10GB free space
- **Network:** Internet connection for dependencies

### Required Software

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential build tools
sudo apt install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    curl \
    git \
    cmake \
    clang \
    llvm
```

### Install Rust

```bash
# Install Rust via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Follow prompts, then reload shell
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version

# Add WebAssembly target (for Substrate)
rustup target add wasm32-unknown-unknown

# Install nightly toolchain (required for some Substrate components)
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
```

### Install Node.js (for Frontend)

```bash
# Install Node.js via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.bashrc

# Install Node.js LTS
nvm install --lts
nvm use --lts

# Verify
node --version
npm --version

# Install pnpm (faster package manager)
npm install -g pnpm
```

---

## 2. Initial Setup

### Clone the Repository

```bash
# Clone MediChain
git clone https://github.com/mrlucas679/medichain.git
cd medichain
```

### Run Setup Script

```bash
# Make setup script executable
chmod +x scripts/setup.sh

# Run setup (installs Rust tools, checks dependencies)
./scripts/setup.sh
```

### Manual Setup (if script fails)

```bash
# Install cargo tools for development
cargo install cargo-audit    # Security vulnerability scanner
cargo install cargo-deny     # License and dependency checker
cargo install cargo-tarpaulin # Code coverage

# Verify Rust toolchain
rustup show
```

---

## 3. Building the Project

### Build All Components

```bash
# From the medichain root directory
cd /path/to/medichain

# Build everything in release mode
cargo build --release --workspace

# Or build specific components:
cargo build --release -p medichain-api      # API server only
cargo build --release -p medichain-node     # Blockchain node only
cargo build --release -p medichain-crypto   # Crypto library only
```

### Build Output Locations

After building, binaries are located at:

```
medichain/
└── target/
    └── release/
        ├── medichain-api      # REST API server executable
        ├── medichain-node     # Blockchain node executable
        └── lib*.so            # Shared libraries
```

### Quick Build Check

```bash
# Check code compiles without full build (faster)
cargo check --workspace
```

---

## 4. Running the API Server

### Start the API Server

```bash
# Navigate to medichain directory
cd /path/to/medichain

# Run in development mode (with logging)
RUST_LOG=info cargo run --release -p medichain-api

# Or run the compiled binary directly
./target/release/medichain-api
```

### API Server Output

When started successfully, you'll see:

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   ███╗   ███╗███████╗██████╗ ██╗ ██████╗██╗  ██╗ █████╗ ██╗███╗  ║
║   ████╗ ████║██╔════╝██╔══██╗██║██╔════╝██║  ██║██╔══██╗██║████╗ ║
║   ...                                                            ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

  📡 API Server starting on http://127.0.0.1:8080
  📋 Demo endpoint: http://127.0.0.1:8080/api/demo
  ❤️  Health check: http://127.0.0.1:8080/health
```

### Environment Variables

```bash
# Optional configuration
export HOST=0.0.0.0          # Listen on all interfaces (default: 127.0.0.1)
export PORT=8080             # Port number (default: 8080)
export RUST_LOG=debug        # Log level: error, warn, info, debug, trace
```

### Test the API

```bash
# Health check
curl http://localhost:8080/health

# Get demo info
curl http://localhost:8080/api/demo

# List patients (requires wallet address auth header)
# Use your registered wallet address in SS58 format
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" http://localhost:8080/api/patients

# Register a patient (as a registered healthcare provider)
curl -X POST http://localhost:8080/api/register \
  -H "Content-Type: application/json" \
  -H "X-User-Id: YOUR_WALLET_SS58_ADDRESS" \
  -d '{
    "full_name": "Test Patient",
    "date_of_birth": "1990-01-01",
    "national_id": "1234567890",
    "blood_type": "A+",
    "allergies": ["Penicillin"],
    "current_medications": [],
    "chronic_conditions": [],
    "emergency_contact_name": "Emergency Contact",
    "emergency_contact_phone": "+1234567890",
    "emergency_contact_relationship": "Spouse",
    "organ_donor": true,
    "dnr_status": false,
    "languages": ["en"]
  }'
```

### Authentication

MediChain uses **wallet-based blockchain authentication**. Users authenticate via their blockchain wallet (Polkadot.js, Subwallet, etc.) and the system uses their SS58 address for identification.

**Roles:**
- **Admin** - Full system access
- **Doctor** - Can register patients, edit medical records
- **Nurse** - Can register patients, edit medical records
- **LabTechnician** - Can submit lab results
- **Pharmacist** - Can view prescriptions
- **Patient** - Read-only access to own records

> **Note:** Legacy demo user IDs (e.g., `DOC-001`, `ADMIN-001`) are deprecated. Register users via the blockchain with their wallet addresses.

---

## 5. Setting Up IPFS

IPFS is used for storing encrypted medical documents off-chain.

### Install IPFS

```bash
# Download IPFS
wget https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz

# Extract
tar -xvzf kubo_v0.24.0_linux-amd64.tar.gz

# Install
cd kubo
sudo bash install.sh

# Verify
ipfs --version
```

### Initialize IPFS

```bash
# Initialize IPFS repository (first time only)
ipfs init

# Configure for local development
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8081
```

### Start IPFS Daemon

```bash
# Start IPFS in background
ipfs daemon &

# Or in a separate terminal
ipfs daemon
```

### Verify IPFS is Running

```bash
# Check IPFS status
ipfs id

# Test via API
curl http://localhost:8080/api/ipfs/health
```

### IPFS Ports

| Port | Purpose |
|------|---------|
| 5001 | IPFS API |
| 8081 | IPFS Gateway |
| 4001 | IPFS Swarm (P2P) |

---

## 6. Running the Frontend Apps

### Install Frontend Dependencies

```bash
# Navigate to client directory
cd medichain/client

# Install all dependencies
pnpm install

# Or using npm
npm install
```

### Run Doctor Portal

```bash
# From medichain/client directory
cd doctor-portal

# Start development server
pnpm dev

# Or
npm run dev
```

The Doctor Portal will be available at: `http://localhost:5173`

### Run Patient App

```bash
# In a new terminal, from medichain/client directory
cd patient-app

# Start development server
pnpm dev

# Or
npm run dev
```

The Patient App will be available at: `http://localhost:5174`

### Build for Production

```bash
# Build Doctor Portal
cd client/doctor-portal
pnpm build

# Build Patient App
cd client/patient-app
pnpm build
```

Production builds are output to `dist/` directories.

---

## 7. Running Tests

### Run All Tests

```bash
# From medichain root directory
./scripts/test-all.sh

# Or run manually:
cargo fmt --all -- --check           # Format check
cargo clippy --all-targets -- -D warnings  # Linting
cargo test --all-features            # Unit tests
cargo audit                          # Security scan
```

### Run Specific Test Suites

```bash
# Pallet tests (blockchain logic)
cargo test -p pallet-access-control
cargo test -p pallet-patient-identity
cargo test -p pallet-medical-records

# Crypto library tests
cargo test -p medichain-crypto

# API tests
cargo test -p medichain-api

# Integration tests
cargo test --test integration_tests

# E2E tests
cargo test --test e2e_tests
```

### Run Tests with Output

```bash
# Show test output
cargo test -- --nocapture

# Run specific test
cargo test test_name -- --nocapture
```

### Code Coverage

```bash
# Generate coverage report
cargo tarpaulin --workspace --ignore-tests

# Generate HTML report
cargo tarpaulin --workspace --ignore-tests --out Html
```

---

## 8. Development Workflow

### Recommended Terminal Setup

Open 4 terminals for development:

| Terminal | Purpose | Command |
|----------|---------|---------|
| 1 | API Server | `RUST_LOG=info cargo run -p medichain-api` |
| 2 | IPFS Daemon | `ipfs daemon` |
| 3 | Doctor Portal | `cd client/doctor-portal && pnpm dev` |
| 4 | Patient App | `cd client/patient-app && pnpm dev` |

### Quick Start Script

Create a convenience script:

```bash
#!/bin/bash
# save as: start-dev.sh

# Start IPFS in background
ipfs daemon &
IPFS_PID=$!

# Wait for IPFS
sleep 3

# Start API server
cd /path/to/medichain
RUST_LOG=info cargo run --release -p medichain-api &
API_PID=$!

# Wait for API
sleep 5

echo "MediChain Development Environment Started"
echo "API: http://localhost:8080"
echo "IPFS: http://localhost:5001"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap "kill $IPFS_PID $API_PID 2>/dev/null" EXIT
wait
```

### File Watching (Auto-rebuild)

```bash
# Install cargo-watch
cargo install cargo-watch

# Auto-rebuild on changes
cargo watch -x "run -p medichain-api"
```

---

## 9. Troubleshooting

### Common Issues

#### 1. Rust Build Errors

```bash
# Update Rust toolchain
rustup update

# Clean build cache
cargo clean

# Rebuild
cargo build --release
```

#### 2. IPFS Connection Failed

```bash
# Check if IPFS is running
ps aux | grep ipfs

# Restart IPFS
pkill ipfs
ipfs daemon &
```

#### 3. Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3000 cargo run -p medichain-api
```

#### 4. WSL2 Network Issues

```bash
# Get WSL IP address
hostname -I

# Access from Windows using WSL IP
# Example: http://172.x.x.x:8080
```

#### 5. Permission Denied

```bash
# Fix script permissions
chmod +x scripts/*.sh

# Fix cargo permissions
sudo chown -R $USER:$USER ~/.cargo
```

#### 6. Out of Memory

```bash
# Increase WSL memory limit
# Edit ~/.wslconfig on Windows:
[wsl2]
memory=8GB
swap=4GB
```

### Logs and Debugging

```bash
# Enable debug logging
RUST_LOG=debug cargo run -p medichain-api

# Enable trace logging (very verbose)
RUST_LOG=trace cargo run -p medichain-api

# Log to file
RUST_LOG=info cargo run -p medichain-api 2>&1 | tee medichain.log
```

### Getting Help

- Check existing issues: https://github.com/mrlucas679/medichain/issues
- Documentation: `docs/` directory
- API Reference: `docs/api.md`
- Architecture: `docs/architecture.md`
- Security: `docs/security.md`

---

## Quick Reference

### Essential Commands

```bash
# Build
cargo build --release -p medichain-api

# Run API
RUST_LOG=info cargo run --release -p medichain-api

# Run Tests
cargo test --all-features

# Start IPFS
ipfs daemon

# Start Frontend
cd client/doctor-portal && pnpm dev
```

### API Endpoints Quick Test

```bash
# Health
curl localhost:8080/health

# Demo info
curl localhost:8080/api/demo

# List patients (as doctor with wallet address)
curl -H "X-User-Id: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" localhost:8080/api/patients

# IPFS health
curl localhost:8080/api/ipfs/health
```

---

**Happy Coding! 🏥⛓️**
