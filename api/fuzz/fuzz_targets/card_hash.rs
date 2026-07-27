//! Fuzz target mirroring `card_hash` in `api/src/nfc_simulator.rs`.
//!
//! `medichain-api` is a `[[bin]]`-only crate (no `[lib]` target), so this
//! fuzz crate can't depend on it directly — the function body below is a
//! verbatim copy of the real one. Keep it in sync if that function changes.
//! Covered by property tests too (`api/src/property_tests.rs`, determinism +
//! separator-collision resistance); this target adds coverage-guided
//! exploration over arbitrary byte content (including non-UTF8-adjacent
//! strings, embedded `:` separators, empty strings).
//!
//! The property being checked: the function never panics for any two input
//! strings, and always returns a 64-character hex string (SHA3-256 output).

#![no_main]

use libfuzzer_sys::fuzz_target;
use sha3::{Digest, Sha3_256};

fn card_hash(card_id: &str, patient_id: &str) -> String {
    let mut hasher = Sha3_256::new();
    hasher.update(card_id.as_bytes());
    hasher.update(b":");
    hasher.update(patient_id.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, arbitrary::Arbitrary)]
struct Input {
    card_id: String,
    patient_id: String,
}

fuzz_target!(|input: Input| {
    let hash = card_hash(&input.card_id, &input.patient_id);
    assert_eq!(hash.len(), 64, "SHA3-256 hex output must always be 64 chars");
});
