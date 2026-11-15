//! De-identification for the research / secondary-use export (WP7.4).
//!
//! Pure functions, so every rule is unit-tested without a database:
//!
//! - **Keyed pseudonyms.** A patient id becomes HMAC-SHA256(key, id), cut to
//!   16 hex characters. The key comes from `MEDICHAIN_RESEARCH_PSEUDONYM_KEY`
//!   and never leaves the server, so a pseudonym cannot be reversed or
//!   recomputed by a recipient, but the same patient gets the same pseudonym
//!   in every export (longitudinal studies work).
//! - **Generalised dates.** Date of birth becomes a ten-year age band; no day,
//!   month or exact year is exported.
//! - **No direct identifiers.** Names, national ids, contact details,
//!   addresses and free text are never read into the output shape at all.
//! - **Small-cell suppression.** Any record whose (age band, sex) group holds
//!   fewer than [`SMALL_CELL_THRESHOLD`] people is withheld, and the count of
//!   withheld records is reported.
//!
//! HMAC is implemented here from `sha2` (RFC 2104) rather than adding a crate;
//! it is checked against the RFC 4231 test vectors below.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};

/// The consent type a patient signs to join research exports.
pub const RESEARCH_CONSENT_TYPE: &str = "CONSENT-RESEARCH";
/// The version of the research consent wording currently shown to patients.
/// A consent records the version it was given under.
pub const RESEARCH_CONSENT_VERSION: &str = "research-consent-v1";
/// Groups smaller than this are withheld from an export.
pub const SMALL_CELL_THRESHOLD: usize = 5;
/// Distinct administrators who must approve an export before it can run.
pub const REQUIRED_EXPORT_APPROVALS: usize = 2;
/// Shortest pseudonymisation key accepted, in bytes.
pub const MIN_PSEUDONYM_KEY_BYTES: usize = 32;
/// Width of an age band, in years.
const AGE_BAND_YEARS: i32 = 10;
/// Ages at or above this share one open-ended band.
const TOP_AGE_BAND_START: i32 = 80;
/// Hex characters kept from the HMAC for a pseudonym (64 bits).
const PSEUDONYM_HEX_CHARS: usize = 16;
/// Most conditions exported per record.
const MAX_CONDITIONS_PER_RECORD: usize = 20;
/// SHA-256's block size, which HMAC pads its key to.
const SHA256_BLOCK_BYTES: usize = 64;

/// HMAC-SHA256 (RFC 2104). Returns the 32-byte tag.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; SHA256_BLOCK_BYTES];
    if key.len() > SHA256_BLOCK_BYTES {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let (mut inner, mut outer) = (Sha256::new(), Sha256::new());
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(message);
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// The keyed pseudonym for a patient id, e.g. `R-3fa91c0d2b7e4a18`.
pub fn pseudonym(key: &[u8], patient_id: &str) -> String {
    let tag = hex::encode(hmac_sha256(key, patient_id.as_bytes()));
    format!("R-{}", &tag[..PSEUDONYM_HEX_CHARS])
}

/// The ten-year band a date of birth falls in on `today`, e.g. `40-49`, or
/// `80+`. `None` for an unparseable or future date.
pub fn age_band(date_of_birth: &str, today: NaiveDate) -> Option<String> {
    let born = NaiveDate::parse_from_str(date_of_birth.get(..10)?, "%Y-%m-%d").ok()?;
    let mut age = today.year() - born.year();
    if (today.month(), today.day()) < (born.month(), born.day()) {
        age -= 1;
    }
    if age < 0 {
        return None;
    }
    if age >= TOP_AGE_BAND_START {
        return Some(format!("{TOP_AGE_BAND_START}+"));
    }
    let start = (age / AGE_BAND_YEARS) * AGE_BAND_YEARS;
    Some(format!("{start}-{}", start + AGE_BAND_YEARS - 1))
}

/// Sex as a closed category; anything else is `unknown` rather than free text.
pub fn sex_category(gender: Option<&str>) -> &'static str {
    match gender.map(|g| g.trim().to_ascii_lowercase()).as_deref() {
        Some("female" | "f") => "female",
        Some("male" | "m") => "male",
        _ => "unknown",
    }
}

/// Conditions as a sorted, de-duplicated, lower-case list, capped in length.
pub fn normalize_conditions(conditions: &[String]) -> Vec<String> {
    conditions
        .iter()
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(MAX_CONDITIONS_PER_RECORD)
        .collect()
}

/// One exported record. The shape itself is the guarantee: it has no field a
/// direct identifier could go in.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResearchRecord {
    pub pseudonym: String,
    pub age_band: String,
    pub sex: &'static str,
    pub conditions: Vec<String>,
}

/// Withhold every record in an (age band, sex) group smaller than
/// `threshold`. Returns the kept records and how many were withheld.
pub fn suppress_small_cells(
    records: Vec<ResearchRecord>,
    threshold: usize,
) -> (Vec<ResearchRecord>, usize) {
    let mut sizes: HashMap<(String, &'static str), usize> = HashMap::new();
    for record in &records {
        *sizes
            .entry((record.age_band.clone(), record.sex))
            .or_default() += 1;
    }
    let total = records.len();
    let kept: Vec<ResearchRecord> = records
        .into_iter()
        .filter(|r| sizes[&(r.age_band.clone(), r.sex)] >= threshold)
        .collect();
    let withheld = total - kept.len();
    (kept, withheld)
}

/// The pseudonymisation key from the environment, if one of adequate length
/// is configured. Without it an export cannot run, and says so.
pub fn configured_pseudonym_key() -> Option<Vec<u8>> {
    std::env::var("MEDICHAIN_RESEARCH_PSEUDONYM_KEY")
        .ok()
        .map(String::into_bytes)
        .filter(|key| key.len() >= MIN_PSEUDONYM_KEY_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_rfc_4231() {
        // Test case 1: key = 0x0b * 20, data = "Hi There".
        assert_eq!(
            hex::encode(hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        // Test case 2: key = "Jefe", data = "what do ya want for nothing?".
        assert_eq!(
            hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Test case 6: a key longer than the block size is hashed first.
        assert_eq!(
            hex::encode(hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn pseudonyms_are_stable_per_key_and_differ_across_keys() {
        let (a, b) = ([7u8; 32], [8u8; 32]);
        assert_eq!(pseudonym(&a, "PAT-1"), pseudonym(&a, "PAT-1"));
        assert_ne!(pseudonym(&a, "PAT-1"), pseudonym(&a, "PAT-2"));
        assert_ne!(pseudonym(&a, "PAT-1"), pseudonym(&b, "PAT-1"));
        assert!(!pseudonym(&a, "PAT-1").contains("PAT"));
    }

    #[test]
    fn birth_dates_become_ten_year_bands() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 26).unwrap();
        assert_eq!(age_band("1986-09-26", today).as_deref(), Some("40-49"));
        assert_eq!(age_band("1986-09-27", today).as_deref(), Some("30-39"));
        assert_eq!(age_band("2026-01-01", today).as_deref(), Some("0-9"));
        assert_eq!(age_band("1930-05-01", today).as_deref(), Some("80+"));
        assert_eq!(age_band("2027-01-01", today), None);
        assert_eq!(age_band("not a date", today), None);
    }

    #[test]
    fn small_groups_are_withheld_and_counted() {
        let record = |band: &str, sex| ResearchRecord {
            pseudonym: format!("R-{band}-{sex}"),
            age_band: band.into(),
            sex,
            conditions: vec![],
        };
        let mut records: Vec<_> = (0..5).map(|_| record("40-49", "female")).collect();
        records.push(record("80+", "male"));
        let (kept, withheld) = suppress_small_cells(records, SMALL_CELL_THRESHOLD);
        assert_eq!(kept.len(), 5);
        assert_eq!(withheld, 1);
        assert!(kept.iter().all(|r| r.age_band == "40-49"));
    }

    #[test]
    fn free_text_is_never_carried_through() {
        assert_eq!(sex_category(Some("Female")), "female");
        assert_eq!(sex_category(Some("prefers not to say")), "unknown");
        assert_eq!(
            normalize_conditions(&[" Hypertension ".into(), "hypertension".into(), "".into()]),
            vec!["hypertension".to_string()]
        );
    }
}
