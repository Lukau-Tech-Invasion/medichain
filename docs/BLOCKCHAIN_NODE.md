# MediChain Blockchain Node

How to build, run, verify and connect to the MediChain Substrate node.

> **Status.** This document describes a **single-node development chain**. It is
> not a production deployment guide, and the chains described here must never be
> used to hold real patient data. See [Chain types](#chain-types).

---

## Chain types

Three different things get called "the chain". Keep them apart:

| | Development chain | Private test network | Production network |
|---|---|---|---|
| Command | `--dev` | `--chain local` + real keys | own chain spec |
| Authorities | `//Alice` (public seed) | operator-generated | operator-generated, cold-stored |
| Sudo key | `//Alice` (public seed) | operator-generated | governance, not a single key |
| Roles at genesis | Alice=Admin, Bob=Doctor, Charlie=Nurse | deliberate | deliberate, reviewed |
| Data | synthetic only | synthetic only | real PHI commitments |
| Verified here | yes | **no** | **no** |

`--dev` is a development chain. It is **not** production-ready and must not be
described as such. Multi-validator consensus has not been tested.

---

## Layout

The blockchain crates live in their own cargo workspace, separate from the API:

```
blockchain/
  Cargo.toml            # workspace root, pins the whole Polkadot SDK release
  pallets/
    access-control/     # RBAC + emergency access + delegated audit
    medical-records/    # capsule commitments, IPFS pointers, alerts
    patient-identity/   # national-ID hashes, health IDs
  runtime/              # medichain-runtime  (WASM + native)
  node/                 # medichain-node     (the binary)
```

This is a **separate workspace on purpose**. The node needs polkadot-sdk
`stable2606` (frame-support 48); `api/` and `crypto/` are on much older pins.
One workspace would force them to move together and would put a ~20 GB node
build in the same target directory as the API.

Because it is a separate workspace, every cargo command needs the manifest path:

```bash
cargo check   --manifest-path blockchain/Cargo.toml -p medichain-runtime
cargo check   --manifest-path blockchain/Cargo.toml -p medichain-node
cargo test    --manifest-path blockchain/Cargo.toml --workspace
cargo build --release --manifest-path blockchain/Cargo.toml -p medichain-node
```

---

## Getting a node binary

### Option A — download the CI-built binary (recommended)

A release build of the Polkadot SDK graph needs roughly **20 GB of free disk**
and can take over an hour cold. If you do not have that, do not build locally.

Scripted (needs the `gh` CLI, authenticated):

```bash
scripts/blockchain/fetch-ci-node.sh
```

It finds the newest successful node build on your branch, downloads the
artifact, verifies the binary against the SHA-256 recorded in its provenance
file, and runs `--version` to prove it executes.

By hand:

1. GitHub → **Actions** → **Blockchain node release binary**
2. Open the most recent successful run on your branch
3. Download the **`medichain-node-linux-x86_64`** artifact
4. Unzip, then:

```bash
chmod +x medichain-node
./medichain-node --version
```

The artifact ships a `medichain-node.provenance.txt` recording the commit,
rustc version, build time and SHA-256 of the binary.

The artifact is a **Linux x86-64 ELF binary**. On Windows, run it under WSL.

**glibc floor.** The binary is built on Ubuntu 22.04, so it needs glibc 2.35 or
newer. Check yours with `ldd --version`. If it fails to start with

```
/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.xx' not found
```

the builder image drifted upward — the workflow pins `runs-on: ubuntu-22.04`
precisely to stop that, because `ubuntu-latest` now means 24.04 (glibc 2.39) and
produces a binary that will not run on 22.04.

### Option B — build locally

Prerequisites (each fails with an unhelpful error if missing):

| Requirement | Missing-symptom |
|---|---|
| `rust-src` component | `no standard library sources found` |
| `wasm32v1-none` target | `the wasm32... target is not installed` |
| `protoc` | litep2p build script panics: `Could not find protoc` |
| `libclang` | librocksdb-sys build script dies (`STATUS_DLL_NOT_FOUND` on Windows) |

```bash
rustup component add rust-src
rustup target add wasm32v1-none
# Debian/Ubuntu:
sudo apt-get install -y protobuf-compiler libprotobuf-dev clang libclang-dev

scripts/blockchain/build-node.sh            # release
scripts/blockchain/build-node.sh --check    # type-check only, no WASM, fast
```

> **Windows note.** The runtime WASM build has not been made to work on this
> project's Windows host: the available mingw/GNU toolchain is much newer than
> this SDK release, and `rust-lld` fails to resolve `sp_io`'s host-function
> imports. `--check` (which sets `SKIP_WASM_BUILD=1`) works and type-checks
> everything; producing a runnable binary should be done on Linux or in CI.

---

## Running a development chain

### Ephemeral (state discarded on exit)

```bash
./medichain-node --dev
```

or

```bash
scripts/blockchain/run-dev-node.sh
```

### Persistent (state survives restarts)

```bash
./medichain-node --dev --base-path ./data/medichain-chain
```

or

```bash
scripts/blockchain/run-dev-node.sh --persist
```

Without `--base-path`, `--dev` writes to a temporary directory that is removed
on exit — restarting gives you a brand-new genesis. With `--base-path`, the
database persists and the chain resumes from its previous height.

---

## RPC endpoint

| | Value |
|---|---|
| WebSocket + HTTP JSON-RPC | `ws://127.0.0.1:9944` / `http://127.0.0.1:9944` |
| P2P | `30333` |

Since Substrate merged the RPC ports, **9944 serves both** WebSocket and HTTP.
The old split of 9944 (WS) / 9933 (HTTP) no longer applies; anything still
pointing at 9933 is stale.

RPC binds to **localhost only** by default, and the scripts here never pass
`--rpc-external`. Exposing an unauthenticated RPC endpoint on all interfaces is
a deliberate decision that needs a reason and an access-control story.

### Connecting the MediChain API

```bash
SUBSTRATE_WS_URL=ws://127.0.0.1:9944
BLOCKCHAIN_ENABLED=true
SUBSTRATE_ALLOW_DEV_SIGNER=true       # dev only; uses //Alice
# or, preferred even in dev:
SUBSTRATE_SIGNING_KEY=//Alice
```

### subxt version is coupled to the runtime

`api/` talks to the node with `subxt`, and `subxt` must understand the metadata
the runtime emits. This is the one hard coupling across the workspace boundary:

| | |
|---|---|
| Runtime | polkadot-sdk `stable2606` — `TransactionExtension` scheme (`AuthorizeCall`, `WeightReclaim`), extrinsic format v5, metadata v16 |
| Required | `subxt` / `subxt-signer` **0.50.x** |
| Will not work | `subxt` 0.37 — predates all of the above; built for `SignedExtension` / extrinsic v4 |

If you bump the SDK release in `blockchain/Cargo.toml`, re-check `subxt` in the
root `Cargo.toml` at the same time. A mismatch does not fail at compile time —
it fails at runtime, when the API tries to encode a call.

### The signing account needs a role

The signing account **must hold a role on the chain**. `//Alice` is granted
`Role::Admin` in the development genesis specifically so the API's default dev
signer can pass `is_healthcare_provider`. If you point `SUBSTRATE_SIGNING_KEY`
at some other account, that account needs a role too, or every MediChain write
fails with `NotHealthcareProvider`.

---

## Verifying a running node

```bash
scripts/blockchain/qualify-node.sh
```

Checks, each against live node state, exiting non-zero on any failure:

1. node responds; runtime `specName` is `medichain`
2. block height advances over a 20 s window (Aura is authoring)
3. **finalized head** advances (GRANDPA is finalizing — deliberately checked
   separately, since a chain can import blocks forever without finalizing one)
4. RPC surface: `system_*`, `chain_getBlockHash`, `state_getMetadata`
5. `AccessControl`, `PatientIdentity`, `MedicalRecords`, `Aura`, `Grandpa`,
   `Sudo` present in metadata, plus the two calls the API submits
6. `AccessControl::UserRoles` is non-empty (the genesis role bootstrap worked)

Manual spot checks:

```bash
# current head
curl -s -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}' \
  http://127.0.0.1:9944

# finalized head
curl -s -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getFinalizedHead","params":[]}' \
  http://127.0.0.1:9944

# runtime version
curl -s -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"state_getRuntimeVersion","params":[]}' \
  http://127.0.0.1:9944
```

---

## Persistence check

```bash
scripts/blockchain/qualify-persistence.sh
```

It starts a node on its own base path, waits for GRANDPA to finalize something,
stops it with SIGTERM, restarts it on the same path, and checks the two things
that actually distinguish "resumed" from "started over":

* the **genesis hash is unchanged** — a changed one means a new chain was created
* the **finalized height did not go backwards** to zero

Both matter, because blocks get produced either way; a chain that silently
re-genesised looks healthy from the outside. It also fails if nothing was
finalized before the restart, since a surviving height would then prove nothing.
It leaves the chain database in place and exits non-zero on any failure.

By hand:

```bash
# 1. start with a base path and let it produce blocks
./medichain-node --dev --base-path ./data/medichain-chain

# 2. note the height and `chain_getBlockHash [0]`, then Ctrl-C once (graceful)

# 3. restart with the SAME base path
./medichain-node --dev --base-path ./data/medichain-chain
```

---

## Resetting a development chain — DESTRUCTIVE

> **This deletes the chain database.** All blocks and all state under the given
> base path are lost permanently. There is no undo. Only ever do this to a
> development chain. Never run it against anything holding real data, and never
> wire it into a script that runs automatically.

```bash
./medichain-node purge-chain --dev --base-path ./data/medichain-chain
```

It prompts for confirmation. `-y` skips the prompt — do not use `-y` in
automation.

---

## Genesis and development keys

The `--dev` and `local` chain specs use well-known Substrate development
identities whose seeds are public:

| Account | Chain role | Consensus |
|---|---|---|
| `//Alice` | `Role::Admin`, sudo | Aura + GRANDPA authority |
| `//Bob` | `Role::Doctor` | authority on `local` only |
| `//Charlie` | `Role::Nurse` | — |

Genesis content lives in
`blockchain/runtime/src/genesis_config_presets.rs`, not in the node.

**Why roles are seeded at genesis at all:** `pallet-access-control` can only
gain its first `Admin` at genesis. `assign_role` requires an existing Admin and
explicitly refuses to assign `Role::Admin`, so a chain that starts with an empty
role table can never populate one — and every MediChain write gates on
`is_healthcare_provider` / `can_edit_medical_records`. A chain without this
bootstrap produces blocks perfectly and rejects every MediChain transaction.

A production chain spec must replace all of the above with operator-generated
keys and a reviewed initial role set.

---

## CI

| Workflow | Job | What it does |
|---|---|---|
| `ci.yml` | `blockchain` | fmt, clippy `-D warnings`, runtime + node check, full test suite |
| `blockchain-node-release.yml` | `build-node` | release build, smoke test, uploads the binary artifact |

Both pin the Rust toolchain rather than tracking `stable`, because the Polkadot
SDK is sensitive to compiler version and a silent stable bump should not be able
to break the node build without an explicit commit.

The `blockchain` job exists because `ci.yml`'s `rust` job is workspace-scoped
(`cargo test`, `cargo clippy --all-targets`, no `-p` flags) and therefore does
not see `blockchain/` at all. Without a dedicated job, the pallet tests would
simply stop running and nothing would go red.
