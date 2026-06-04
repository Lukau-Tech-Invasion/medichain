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
FROM rust:1.83-slim-bookworm AS builder
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Copy the workspace manifests + the members the API actually needs.
# (node/ and runtime/ are excluded from the workspace and not built here.)
COPY Cargo.toml Cargo.lock ./
COPY crypto ./crypto
COPY pallets ./pallets
COPY api ./api

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

ENV API_HOST=0.0.0.0 \
    API_PORT=8080

EXPOSE 8080

# Container-level health check (also lets `depends_on: condition: service_healthy` work).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8080/api/health || exit 1

CMD ["medichain-api"]
