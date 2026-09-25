//! Property-based tests (Phase 12.2) using `proptest`.
//!
//! These assert *invariants* over randomized inputs rather than fixed examples:
//! NFC hashing is deterministic and collision-resistant to separator ambiguity,
//! and the MAP the vitals endpoint returns is bounded.
//!
//! Lives inside the binary crate (not `tests/`) because it exercises crate-
//! internal functions; run with `cargo test --bin medichain-api property`.
//!
//! The blood-type compatibility properties were removed on 2026-09-24 with the
//! function they tested: nothing in the product ever called it, and a
//! compatibility check with no donor unit to check against is not a control.

use crate::clinical::VitalSignsReading;
use crate::nfc_simulator::card_hash;
use proptest::prelude::*;

/// A reading carrying only a blood pressure: what `calculate_map` reads.
fn pressure(systolic: u16, diastolic: u16) -> VitalSignsReading {
    VitalSignsReading {
        reading_id: String::new(),
        timestamp: 0,
        heart_rate: None,
        systolic_bp: Some(systolic),
        diastolic_bp: Some(diastolic),
        respiratory_rate: None,
        oxygen_saturation: None,
        temperature_celsius: None,
        pain_scale: None,
        recorded_by: String::new(),
        notes: None,
    }
}

proptest! {
    // ---- NFC card hash generation ------------------------------------------

    #[test]
    fn card_hash_is_deterministic(card in ".{0,32}", patient in ".{0,32}") {
        prop_assert_eq!(card_hash(&card, &patient), card_hash(&card, &patient));
    }

    #[test]
    fn card_hash_is_64_hex_chars(card in ".{0,32}", patient in ".{0,32}") {
        let h = card_hash(&card, &patient);
        prop_assert_eq!(h.len(), 64);
        prop_assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn card_hash_resists_separator_ambiguity(a in "[^:]{1,16}", b in "[^:]{1,16}") {
        // (a, b) and (a + b, "") must not collide because of the ':' separator.
        let combined = format!("{a}{b}");
        prop_assert_ne!(card_hash(&a, &b), card_hash(&combined, ""));
    }

    // ---- MAP arithmetic (bounded, overflow-free) ---------------------------

    #[test]
    fn map_is_computed_for_every_u16_pair(sbp in any::<u16>(), dbp in any::<u16>()) {
        // Must not panic, and always produces a value when both are present.
        prop_assert!(pressure(sbp, dbp).calculate_map().is_some());
    }

    #[test]
    fn map_is_between_diastolic_and_systolic(dbp in 0u16..300, delta in 0u16..300) {
        let sbp = dbp + delta; // ensure sbp >= dbp
        let map = pressure(sbp, dbp).calculate_map().unwrap();
        prop_assert!(map >= dbp && map <= sbp);
    }
}
