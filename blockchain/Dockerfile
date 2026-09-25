# MediChain Substrate node.
#
# `blockchain/` is its OWN cargo workspace, with its own Cargo.lock and its own
# rust-toolchain.toml pinning 1.92.0 plus the wasm targets. The build context is
# therefore this directory, not the repository root -- copying the root in would
# bring the API workspace along and resolve the wrong toolchain file, which is
# the failure `blockchain/rust-toolchain.toml` documents.
#
# Why this exists: docker-compose.prod.yml declares a `substrate-node` service
# with a healthcheck and NO image and NO build, behind a profile whose name says
# the node source is not containerized. So there was nothing to start, and the
# API ran with `SUBSTRATE_WS_URL` unset -- every anchored write a typed error.
#
# BUILD COST. This is a Polkadot SDK node: expect 20-30 GB of intermediate
# artifacts and upwards of an hour on a cold cache. The runtime is compiled to
# WASM by substrate-wasm-builder as part of the build, which is why the wasm
# targets and rust-src are provisioned below rather than assumed.

# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------
FROM docker.io/library/rust:1.92-bookworm AS builder

# protobuf and clang are required by the SDK's dependency graph (libp2p,
# rocksdb). `llvm-dev` and `libclang-dev` are what rocksdb's bindgen needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        protobuf-compiler \
        clang \
        libclang-dev \
        llvm-dev \
        cmake \
        pkg-config \
        libssl-dev \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# The toolchain file first, on its own layer: provisioning 1.92.0 with the wasm
# targets is slow and does not change when source does.
COPY rust-toolchain.toml ./
RUN rustup show && rustup target add wasm32-unknown-unknown wasm32v1-none

COPY Cargo.toml Cargo.lock ./
COPY node ./node
COPY runtime ./runtime
COPY pallets ./pallets

# Symbols stripped and debug info off: this binary is run, not debugged in
# place, and the difference is several gigabytes of artifacts on a host where
# that is the binding constraint.
ENV CARGO_PROFILE_RELEASE_DEBUG=0 \
    CARGO_PROFILE_RELEASE_STRIP=symbols \
    CARGO_INCREMENTAL=0 \
    CARGO_NET_RETRY=5

RUN cargo build --release --locked --bin medichain-node

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM docker.io/library/debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin substrate

COPY --from=builder /build/target/release/medichain-node /usr/local/bin/medichain-node

# The chain database. Named volume in compose: a dev chain that loses its state
# on every restart cannot demonstrate that anything was anchored.
RUN mkdir -p /data && chown substrate:substrate /data
VOLUME ["/data"]

USER substrate
WORKDIR /data

# 9944 serves both WebSocket and HTTP JSON-RPC: Substrate merged the ports, and
# a healthcheck against the old 9933 can never connect on a current node.
EXPOSE 9944 9933 30333

ENTRYPOINT ["/usr/local/bin/medichain-node"]
