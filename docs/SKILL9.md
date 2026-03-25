---
name: project-bootstrap
description: >
  Sets up the MediChain repo structure on day one — Cargo workspace, Anchor program
  scaffolding, frontend Vite+React+TS, monorepo layout, .gitignore, CLAUDE.md, README,
  pre-commit hooks, CI skeleton. Activate when the user says "start fresh", "set up the
  repo", "scaffold", "I'm starting MediChain over", or when a directory is empty/near-empty
  and clearly at the beginning. Also activate to reorganise an existing repo to match this
  structure. Bootstrap once, well, and benefit forever.
---

# Project Bootstrap for MediChain

The structure you set up on day one shapes every PR for the next year. Spend the
afternoon getting it right.

---

## Target Structure

```
medichain/
├── .github/
│   └── workflows/
│       ├── rust.yml              # cargo fmt + clippy + test
│       ├── anchor.yml            # anchor test
│       └── frontend.yml          # typecheck + test + build
├── .vscode/
│   └── settings.json             # rust-analyzer + format on save
├── crates/
│   ├── shared/                   # types shared across all crates
│   ├── program/                  # Solana on-chain program
│   ├── backend/                  # Rust HTTP API (axum)
│   └── nfc/                      # NFC reader/writer CLI
├── frontend/                     # TypeScript + React (Vite)
│   ├── src/
│   ├── public/
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── package.json
├── docs/
│   ├── adr/                      # architecture decision records
│   ├── threat-model.md
│   └── architecture.md
├── scripts/
│   ├── dev.sh                    # spin up local dev cluster + backend + frontend
│   ├── deploy-devnet.sh
│   └── migrate-data.sh
├── tests/
│   └── e2e/                      # cross-stack end-to-end tests
├── Anchor.toml
├── Cargo.toml                    # workspace root
├── package.json                  # root for workspace tooling
├── .gitignore
├── .editorconfig
├── .pre-commit-config.yaml
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
├── SECURITY.md
├── PRIVACY.md
├── THREAT-MODEL.md
└── LICENSE
```

---

## Day-One Setup Commands

```bash
# 1. Create the repo
mkdir medichain && cd medichain
git init
git branch -M main

# 2. Cargo workspace
cargo new --lib crates/shared
cargo new --lib crates/program
cargo new --bin crates/backend
cargo new --bin crates/nfc

# 3. Workspace Cargo.toml
cat > Cargo.toml <<'EOF'
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.package]
edition = "2021"
authors = ["Rakau Keorapetswe Lucas Kgoatlha"]
license = "MIT OR Apache-2.0"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
anyhow = "1"
thiserror = "2"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
borsh = "1"
EOF

# 4. Anchor scaffolding (if not done already)
# anchor init --no-git medichain  ← run separately if starting from anchor

# 5. Frontend
mkdir frontend && cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install @solana/web3.js @coral-xyz/anchor \
  @solana/wallet-adapter-react @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-wallets @tanstack/react-query
cd ..

# 6. Pre-commit hooks
cat > .pre-commit-config.yaml <<'EOF'
repos:
  - repo: local
    hooks:
      - id: cargo-fmt
        name: cargo fmt
        entry: cargo fmt --check
        language: system
        pass_filenames: false
      - id: cargo-clippy
        name: cargo clippy
        entry: cargo clippy --all-targets -- -D warnings
        language: system
        pass_filenames: false
      - id: typecheck
        name: typecheck frontend
        entry: bash -c 'cd frontend && npm run typecheck'
        language: system
        pass_filenames: false
EOF
pre-commit install

# 7. Initial docs
touch CLAUDE.md README.md CHANGELOG.md SECURITY.md PRIVACY.md THREAT-MODEL.md LICENSE
mkdir -p docs/adr scripts tests/e2e .vscode
```

---

## .gitignore

```
# Rust
target/
**/*.rs.bk
Cargo.lock          # commit this for binaries — uncomment if program is a lib

# Anchor
.anchor/
test-ledger/
**/target/

# Solana
*.json              # ⚠️ keypair files — be careful, only ignore in /keys/
keys/
.env
.env.local

# Node
node_modules/
dist/
.vite/
*.log

# Editor
.idea/
.vscode/*
!.vscode/settings.json
.DS_Store

# OS
Thumbs.db

# Local dev
.local/
*.sqlite
```

**Critical:** never commit a Solana keypair JSON to git. Keep them in `keys/`
(gitignored) and reference via env vars. Lost keys = lost funds. Committed keys =
drained funds.

---

## .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{rs,toml}]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

---

## .vscode/settings.json (commit this — it's environment for the project)

```json
{
  "rust-analyzer.cargo.features": "all",
  "rust-analyzer.check.command": "clippy",
  "[rust]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "[typescript]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

---

## CLAUDE.md (skeleton — fill in as the project grows)

```markdown
# MediChain — Briefing for AI Assistants

## What this is
A blockchain-verified national health ID system for South Africa. Patients control
their medical record via a Solana program; paramedics get 3-second emergency access
via NFC card.

## Stack
- Rust (backend, on-chain program, NFC tools)
- Solana + Anchor framework
- TypeScript + React (patient app, doctor portal, paramedic PWA)
- PostgreSQL (encrypted PHI storage off-chain)

## Critical rules
1. NO PHI on-chain. Hashes and pointers only.
2. Every on-chain instruction has a Signer for the authority.
3. POPIA compliance is a hard requirement. See PRIVACY.md.
4. 3-second NFC tap-to-display is the product promise.
5. Tests required for every PR.

## Common commands
- `./scripts/dev.sh` — spin up local validator, backend, frontend
- `cargo nextest run` — Rust tests
- `anchor test` — Solana program tests
- `cd frontend && npm test` — frontend tests

## Where to look
- ADRs: `docs/adr/` — read before changing architecture
- Threat model: `THREAT-MODEL.md`
- Privacy stance: `PRIVACY.md`
```

---

## scripts/dev.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

# Spin up everything for local development in one command.
# Requires: solana-test-validator, anchor, cargo, npm

echo "🔧 Starting Solana local validator..."
solana-test-validator --reset --quiet &
VALIDATOR_PID=$!
trap "kill $VALIDATOR_PID 2>/dev/null || true" EXIT

sleep 3
echo "📦 Building & deploying program..."
anchor build
anchor deploy --provider.cluster localnet

echo "🚀 Starting backend..."
cargo run -p medichain-backend &
BACKEND_PID=$!
trap "kill $BACKEND_PID $VALIDATOR_PID 2>/dev/null || true" EXIT

sleep 2
echo "🖥️  Starting frontend..."
(cd frontend && npm run dev)
```

---

## CI Skeleton

```yaml
# .github/workflows/rust.yml
name: rust
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --all-features
```

---

## First-week Checklist

- [ ] Repo initialised, all directories created
- [ ] Cargo workspace builds (`cargo check` succeeds)
- [ ] Anchor program compiles (`anchor build`)
- [ ] Frontend builds (`cd frontend && npm run build`)
- [ ] Pre-commit hooks installed
- [ ] CI green on a no-op commit
- [ ] CLAUDE.md, README.md, SECURITY.md, PRIVACY.md, THREAT-MODEL.md created (even
  if mostly stub content)
- [ ] First ADR written: "ADR-0001: Why Rust + Anchor + React for MediChain"
- [ ] `.env.example` committed (env vars listed but no real values)
- [ ] LICENSE chosen and committed (MIT or Apache 2.0 typical for open source)

---

## "Day Two" Decisions (don't punt these)

These come up immediately and re-doing them later is painful:

1. **Code style:** rustfmt defaults + prettier defaults. Don't bikeshed.
2. **Branching model:** trunk-based (PRs into main, no long-lived branches) for
   solo / small teams. Save GitFlow for >5 devs.
3. **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`) — enables
   automated CHANGELOG generation.
4. **Versioning:** SemVer. Pre-1.0 = expect breaking changes; document them.
5. **Issue templates:** bug report + feature request + ADR proposal.

Do these once on day one. Never think about them again.
