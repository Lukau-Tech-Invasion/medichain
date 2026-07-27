//! Fuzz target mirroring `blood_type_compatible` (and its `parse_blood_type`
//! helper) in `api/src/clinical.rs`.
//!
//! `medichain-api` is a `[[bin]]`-only crate (no `[lib]` target), so this
//! fuzz crate can't depend on it directly — the function bodies below are a
//! verbatim copy of the real ones. Keep them in sync if those functions change.
//! Covered by property tests too (`api/src/property_tests.rs`); this target
//! adds coverage-guided exploration over arbitrary (including malformed)
//! blood-type strings, not just the handful of valid ones a strategy would
//! generate.
//!
//! The property being checked: for any two input strings, the function never
//! panics — malformed/unparseable inputs must resolve to `false`, never a
//! crash.

#![no_main]

use libfuzzer_sys::fuzz_target;

fn parse_blood_type(s: &str) -> Option<(&'static str, bool)> {
    let s = s.trim().to_uppercase();
    let (abo, rh_positive) = if let Some(stripped) = s.strip_suffix('+') {
        (stripped.to_string(), true)
    } else {
        let stripped = s.strip_suffix('-')?;
        (stripped.to_string(), false)
    };
    let abo_static = match abo.as_str() {
        "O" => "O",
        "A" => "A",
        "B" => "B",
        "AB" => "AB",
        _ => return None,
    };
    Some((abo_static, rh_positive))
}

fn blood_type_compatible(donor: &str, recipient: &str) -> bool {
    let (Some((d_abo, d_rh)), Some((r_abo, r_rh))) =
        (parse_blood_type(donor), parse_blood_type(recipient))
    else {
        return false;
    };
    if d_rh && !r_rh {
        return false;
    }
    match d_abo {
        "O" => true,
        "A" => r_abo == "A" || r_abo == "AB",
        "B" => r_abo == "B" || r_abo == "AB",
        "AB" => r_abo == "AB",
        _ => false,
    }
}

#[derive(Debug, arbitrary::Arbitrary)]
struct Input {
    donor: String,
    recipient: String,
}

fuzz_target!(|input: Input| {
    let _ = blood_type_compatible(&input.donor, &input.recipient);
});
