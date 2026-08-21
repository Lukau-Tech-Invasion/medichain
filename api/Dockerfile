# syntax=docker/dockerfile:1
#
# Multi-stage build for the MediChain API (Rust workspace).
#
# IMPORTANT: the build context MUST be the repository ROOT, because the `api`
# crate depends on the `crypto` and `pallets/*` workspace members. Build with:
#
#   docker build -f api/Dockerfile -t medichain-api .
#
# (docker-compose.yml already sets `context: .` + `dockerfile: api/Dockerfile`.)

# ---- Builder ----------------------------------------------------------------
# The locked `home` and `time` releases require Cargo/Rust 1.88 or newer.
# Keep this explicit so the production image matches CI's stable toolchain.
FROM rust:1.88-slim-bookworm AS builder
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Copy the workspace manifests + the members the API actually needs.
# (node/ and runtime/ are excluded from the workspace and not built here.)
COPY Cargo.toml Cargo.lock ./
COPY crypto ./crypto
COPY api ./api
# NOTE: no `COPY pallets`. The pallets moved to blockchain/pallets and left the
# root workspace entirely; `api` never depended on them (its only path
# dependency is `crypto`). Copying a path that no longer exists fails the build
# outright, and this only surfaced when the image was first rebuilt after the
# move — nothing else references this Dockerfile.

# Build only the API binary (and its path dependencies).
RUN cargo build --release -p medichain-api

# ---- Runtime ----------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libssl3 curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=builder /build/target/release/medichain-api /usr/local/bin/medichain-api
# Migrations are applied by the API at startup; ship them alongside the binary.
COPY api/migrations ./migrations

ENV HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# Container-level health check (also lets `depends_on: condition: service_healthy` work).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["medichain-api"]
