@echo off
REM Start MediChain API in a new window that stays open
start "MediChain API" cmd /k wsl -d Ubuntu-22.04 -e bash -lc "cd /mnt/c/Users/Admin/OneDrive/Documents/'New folder'/'MEDICHAIN DEVELOPMENT'/medichain && source ~/.cargo/env && RUST_LOG=info ./target/release/medichain-api"
