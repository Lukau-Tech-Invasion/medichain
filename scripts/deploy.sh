#!/bin/bash
# Deployment script for MediChain
set -e

# Example: Build and deploy node
cd node
cargo build --release
# Add deployment steps here

echo "Deployment complete."
