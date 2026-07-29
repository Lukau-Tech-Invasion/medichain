# Contributing

MediChain is currently developed by a single maintainer. Issues and discussion are
welcome; please read this before opening a pull request.

## Ground rules

1. **Safety-critical mindset.** This code is intended to run where a wrong answer
   harms a patient. Prefer the boring, verifiable construction.
2. **No personal health information on-chain.** Hashes, commitments, pointers and
   audit entries only. This is not negotiable — see
   [ADR-0004](docs/adr/0004-commitment-not-plaintext-on-chain.md).
3. **Never commit secrets.** Everything comes from the environment.
4. **Synthetic data only** in tests, fixtures and examples.

## Development setup

Requires Rust 1.97+, Node 20+, Docker for the PostgreSQL path.

```bash
git clone https://github.com/Lukau-Tech-Invasion/medichain.git
cd medichain
cargo build -p medichain-api --bin medichain-api
bash scripts/run-synthetic-local.sh     # in-memory, no database needed
```

### Windows note

This project is developed on Windows without an MSVC linker. Use the GNU
toolchain:

```bash
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
export PATH="/c/path/to/mingw64/bin:$PATH"
export CARGO_INCREMENTAL=0    # incremental caches grow multi-GB quickly
```

If a build fails with a **linker error**, check free disk space before suspecting
the code — a full build can exhaust the drive and the resulting error is
misleading.

## Standards

**NASA Power of 10**, adapted:

- No recursion.
- Bounded loops — every iteration has a hard upper bound, and exceeding it is
  reported, not silently ignored.
- Functions ≤ 60 lines.
- Assertions on invariants.
- No dynamic allocation in hot paths after init.

**Zero warnings.** `cargo clippy -- -D warnings` must pass. This is enforced
because it catches real defects: dead-code warnings revealed two features that
were written, tested, and connected to nothing.

**SQL.** `sqlx` with bound parameters only. Zero string concatenation.

**Comments explain _why_.** The code already shows what. A comment that restates
the next line is noise; a comment recording why an obvious-looking alternative was
rejected is worth more than the code around it.

## Testing

```bash
cargo test -p medichain-api --bin medichain-api      # 305 tests
cargo test -p pallet-access-control                  # and siblings
bash scripts/synthetic-e2e-test.sh                   # 40 live-API assertions
```

Note: `cargo test -p medichain-api --lib` **fails** — it is a binary crate. Use
`--bin medichain-api`.

For the PostgreSQL-backed tests:

```bash
docker compose -p medichain_horizon -f docker-compose.yml \
  -f docker-compose.horizon-isolated.yml up -d postgres
DATABASE_URL=postgres://medichain_horizon:horizon-isolated-synthetic-only@127.0.0.1:55432/medichain_horizon \
  cargo test -p medichain-api --bin medichain-api
```

### What a good test looks like here

Name the property, not the mechanics. `revoking_twice_is_refused_and_preserves_the_first_revocation`
tells a reader what breaks if it fails; `test_revoke_2` does not. Where a test
encodes a legal or clinical rule, cite it in a doc comment — the next person needs
to know that changing the assertion changes a compliance posture.

## Pull requests

- One concern per PR.
- Include a test that fails before the change and passes after.
- Update the relevant ADR, or add one, if you change an architectural decision.
- Run `cargo clippy -- -D warnings` and `cargo fmt` first.
- If you touch anything security-relevant, say so explicitly in the description.

## Architectural changes

Add an ADR under [`docs/adr/`](docs/adr/). Record the options you rejected and
why — that is the part which has value later.
