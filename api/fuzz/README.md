# Fuzz targets (Phase 12.2)

Coverage-guided fuzzing for the same pure input-validation functions covered
by `api/src/property_tests.rs`: `checked_consent_expiry`, `blood_type_compatible`,
`card_hash`, `mean_arterial_pressure`.

## Why these bodies are copied, not imported

`medichain-api` is a `[[bin]]`-only crate (no `[lib]` target — see `api/Cargo.toml`),
so a separate fuzz crate can't depend on it as a library. Each `fuzz_targets/*.rs`
file has a verbatim copy of the real function it targets, with a header comment
pointing at the source of truth. Keep them in sync if those functions change.

## Running

Requires the standard `cargo-fuzz` toolchain (nightly Rust + a libFuzzer-compatible
C++ toolchain):

```bash
cargo install cargo-fuzz
cargo +nightly fuzz run consent_expiry
cargo +nightly fuzz run blood_type_compatible
cargo +nightly fuzz run card_hash
cargo +nightly fuzz run mean_arterial_pressure
```

**Verified in this environment (2026-07-21):** the pure Rust logic in each target
was sanity-checked standalone (compiles, passes representative assertions) but
`cargo build`/`cargo check` on this crate could not be verified end-to-end here —
`libfuzzer-sys`'s bundled libFuzzer C++ shim (`FuzzerExtFunctionsWindows.cpp`)
fails to compile under mingw-w64 g++ (confirmed directly; libFuzzer's Windows
support targets MSVC/clang-cl, not mingw). Run on Linux/WSL/macOS, or on Windows
with a full MSVC + clang-cl setup, for this to build.
