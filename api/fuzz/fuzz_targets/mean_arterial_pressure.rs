//! Fuzz target mirroring `mean_arterial_pressure` in `api/src/clinical.rs`.
//!
//! `medichain-api` is a `[[bin]]`-only crate (no `[lib]` target), so this
//! fuzz crate can't depend on it directly — the function body below is a
//! verbatim copy of the real one. Keep it in sync if that function changes.
//! Covered by property tests too (`api/src/property_tests.rs`, overflow-free
//! for all `u16`); this target adds coverage-guided exploration as a second
//! independent check.
//!
//! The property being checked: `(systolic + 2*diastolic) / 3` must never
//! overflow/panic for any `u16` inputs — the widened `u32` arithmetic is what
//! guarantees this (Phase 12.2).

#![no_main]

use libfuzzer_sys::fuzz_target;

fn mean_arterial_pressure(systolic: u16, diastolic: u16) -> u16 {
    ((systolic as u32 + 2 * diastolic as u32) / 3) as u16
}

#[derive(Debug, arbitrary::Arbitrary)]
struct Input {
    systolic: u16,
    diastolic: u16,
}

fuzz_target!(|input: Input| {
    let _ = mean_arterial_pressure(input.systolic, input.diastolic);
});
