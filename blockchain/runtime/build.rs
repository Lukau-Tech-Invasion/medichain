//! Builds the MediChain runtime to WASM and emits `wasm_binary.rs` into `OUT_DIR`,
//! which `src/lib.rs` pulls in via `include!`.
//!
//! The previous manifest depended on a crate called `include-wasm-binary-bin-gen`,
//! which does not exist on crates.io. Nothing here has ever produced a WASM
//! artifact before; `WASM_BINARY` was an undefined symbol.

#[cfg(all(feature = "std", feature = "metadata-hash"))]
fn main() {
    substrate_wasm_builder::WasmBuilder::init_with_defaults()
        .enable_metadata_hash("MEDI", 12)
        .build();
}

#[cfg(all(feature = "std", not(feature = "metadata-hash")))]
fn main() {
    substrate_wasm_builder::WasmBuilder::build_using_defaults();
}

/// The wasm builder is deactivated when compiling this crate for wasm, to avoid
/// recursing into itself.
#[cfg(not(feature = "std"))]
fn main() {}
