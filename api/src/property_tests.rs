//! Property-based tests (Phase 12.2) using `proptest`.
//!
//! These assert *invariants* over randomized inputs rather than fixed examples:
//! consent-duration arithmetic never overflows, the blood-type compatibility
//! matrix obeys transfusion rules, NFC hashing is deterministic and collision-
//! resistant to separator ambiguity, and MAP arithmetic is bounded.
//!
//! Lives inside the binary crate (not `tests/`) because it exercises crate-
//! internal functions; run with `cargo test --bin medichain-api property`.

use crate::clinical::{blood_type_compatible, mean_arterial_pressure};
use crate::nfc_simulator::card_hash;
use crate::support::checked_consent_expiry;
use proptest::prelude::*;

/// Strategy producing a valid ABO/Rh blood-type string.
fn blood_type_strategy() -> impl Strategy<Value = String> {
    let abo = prop_oneof![Just("O"), Just("A"), Just("B"), Just("AB")];
    let rh = prop_oneof![Just("+"), Just("-")];
    (abo, rh).prop_map(|(a, r)| format!("{a}{r}"))
}

proptest! {
    // ---- Consent duration arithmetic (overflow prevention) -----------------

    #[test]
    fn consent_expiry_never_panics(granted in any::<i64>(), dur in any::<u64>()) {
        // The only contract is: it must not panic for any input.
        let _ = checked_consent_expiry(granted, dur);
    }

    #[test]
    fn consent_expiry_is_monotonic(granted in 0i64..4_000_000_000, dur in 0u64..4_000_000_000) {
        // For non-negative, representable inputs the expiry is at or after grant.
        if let Some(exp) = checked_consent_expiry(granted, dur) {
            prop_assert!(exp >= granted);
        }
    }

    #[test]
    fn consent_expiry_saturates_instead_of_wrapping(dur in (i64::MAX as u64 + 1)..=u64::MAX) {
        // Durations that cannot fit in i64 yield None, never a wrapped value.
        prop_assert_eq!(checked_consent_expiry(0, dur), None);
    }

    // ---- Blood type compatibility matrix -----------------------------------

    #[test]
    fn o_negative_is_universal_donor(recipient in blood_type_strategy()) {
        prop_assert!(blood_type_compatible("O-", &recipient));
    }

    #[test]
    fn ab_positive_is_universal_recipient(donor in blood_type_strategy()) {
        prop_assert!(blood_type_compatible(&donor, "AB+"));
    }

    #[test]
    fn same_type_is_self_compatible(bt in blood_type_strategy()) {
        prop_assert!(blood_type_compatible(&bt, &bt));
    }

    #[test]
    fn rh_positive_donor_incompatible_with_rh_negative_recipient(
        abo_d in prop_oneof![Just("O"), Just("A"), Just("B"), Just("AB")],
        abo_r in prop_oneof![Just("O"), Just("A"), Just("B"), Just("AB")],
    ) {
        let donor = format!("{abo_d}+");
        let recipient = format!("{abo_r}-");
        prop_assert!(!blood_type_compatible(&donor, &recipient));
    }

    #[test]
    fn unparseable_blood_types_are_incompatible(s in "[^OAB+-]{1,5}") {
        prop_assert!(!blood_type_compatible(&s, "AB+"));
        prop_assert!(!blood_type_compatible("O-", &s));
    }

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
    fn map_is_overflow_free_for_all_u16(sbp in any::<u16>(), dbp in any::<u16>()) {
        // Must not panic; widened arithmetic guarantees this for all u16.
        let _ = mean_arterial_pressure(sbp, dbp);
    }

    #[test]
    fn map_is_between_diastolic_and_systolic(dbp in 0u16..300, delta in 0u16..300) {
        let sbp = dbp + delta; // ensure sbp >= dbp
        let map = mean_arterial_pressure(sbp, dbp);
        prop_assert!(map >= dbp && map <= sbp);
    }
}
