//! Blood-bank rules for the unit inventory (WP7.5): ABO/Rh compatibility at
//! reservation, the effective status of an expired unit, and the stock
//! summary with its expiry and low-stock alerts.
//!
//! The thresholds and compatibility tables below are **defaults pending
//! clinical approval** (WP13 moves them to signed-off policy files). They are
//! the standard textbook rules, stated conservatively: when a recipient's
//! group is unknown, only group O Rh-negative red cells may be reserved for
//! them without typing ("type and cross-match before transfusion").

use chrono::NaiveDate;
use serde::Serialize;
use std::collections::BTreeMap;

use crate::repositories::blood_units::BloodUnitEntity;
use crate::types::BloodType;

/// A unit expiring within this many days is flagged. Default, pending
/// clinical approval.
pub const EXPIRY_WARNING_DAYS: i64 = 3;
/// A red-cell group with fewer available units than this is flagged as low.
/// Default, pending clinical approval.
pub const LOW_STOCK_UNITS: usize = 2;

/// The eight red-cell groups the low-stock check watches.
const WATCHED_GROUPS: [(&str, &str); 8] = [
    ("O", "negative"),
    ("O", "positive"),
    ("A", "negative"),
    ("A", "positive"),
    ("B", "negative"),
    ("B", "positive"),
    ("AB", "negative"),
    ("AB", "positive"),
];

/// A recipient's ABO group and Rh, or `None` when unknown.
fn recipient_group(recipient: &BloodType) -> Option<(&'static str, bool)> {
    match recipient {
        BloodType::APositive => Some(("A", true)),
        BloodType::ANegative => Some(("A", false)),
        BloodType::BPositive => Some(("B", true)),
        BloodType::BNegative => Some(("B", false)),
        BloodType::ABPositive => Some(("AB", true)),
        BloodType::ABNegative => Some(("AB", false)),
        BloodType::OPositive => Some(("O", true)),
        BloodType::ONegative => Some(("O", false)),
        BloodType::Unknown => None,
    }
}

/// Whether a donor ABO group's red cells suit a recipient ABO group.
fn red_cells_abo_ok(donor: &str, recipient: &str) -> bool {
    donor == "O" || donor == recipient || recipient == "AB"
}

/// Whether a donor ABO group's plasma suits a recipient ABO group (the
/// reverse of red cells: AB plasma is universal).
fn plasma_abo_ok(donor: &str, recipient: &str) -> bool {
    donor == "AB" || donor == recipient || recipient == "O"
}

/// Whether `unit` may be reserved for a recipient of group `recipient`.
///
/// Red cells and whole blood: ABO compatible, and Rh-positive only for an
/// Rh-positive recipient. Plasma and cryoprecipitate: plasma ABO rule.
/// Platelets: no ABO restriction here (crossmatch decides). Unknown group:
/// red cells only O-negative, plasma only AB.
pub fn compatible(unit: &BloodUnitEntity, recipient: &BloodType) -> bool {
    let donor_rh_positive = unit.rh == "positive";
    match (unit.product_type.as_str(), recipient_group(recipient)) {
        ("PackedRBC" | "WholeBlood", None) => unit.abo == "O" && !donor_rh_positive,
        ("PackedRBC" | "WholeBlood", Some((abo, rh_positive))) => {
            red_cells_abo_ok(&unit.abo, abo) && (rh_positive || !donor_rh_positive)
        }
        ("FFP" | "Cryoprecipitate", None) => unit.abo == "AB",
        ("FFP" | "Cryoprecipitate", Some((abo, _))) => plasma_abo_ok(&unit.abo, abo),
        _ => true,
    }
}

/// The status to show: an unissued unit past its expiry reads `expired`.
pub fn effective_status(unit: &BloodUnitEntity, today: NaiveDate) -> &str {
    let unissued = matches!(unit.status.as_str(), "available" | "reserved");
    if unissued && unit.expires_on < today {
        "expired"
    } else {
        unit.status.as_str()
    }
}

/// Available, in-date units of one product and group.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct StockLine {
    pub product_type: String,
    pub abo: String,
    pub rh: String,
    pub available: usize,
}

/// The stock picture: counts, units near expiry, and red-cell groups below
/// the low-stock threshold.
#[derive(Debug, Serialize)]
pub struct StockSummary {
    pub stock: Vec<StockLine>,
    pub expiring_unit_ids: Vec<String>,
    pub low_stock_groups: Vec<String>,
    pub expiry_warning_days: i64,
    pub low_stock_units: usize,
    /// Always true until WP13 policy files carry a clinical sign-off.
    pub thresholds_are_defaults: bool,
}

/// Summarise `units` as of `today`.
pub fn summarise(units: &[BloodUnitEntity], today: NaiveDate) -> StockSummary {
    let warn_until = today + chrono::Duration::days(EXPIRY_WARNING_DAYS);
    let mut counts: BTreeMap<(String, String, String), usize> = BTreeMap::new();
    let mut expiring = Vec::new();
    for unit in units {
        let status = effective_status(unit, today);
        if matches!(status, "available" | "reserved") && unit.expires_on <= warn_until {
            expiring.push(unit.id.clone());
        }
        if status == "available" {
            *counts
                .entry((unit.product_type.clone(), unit.abo.clone(), unit.rh.clone()))
                .or_default() += 1;
        }
    }
    let low_stock_groups = WATCHED_GROUPS
        .iter()
        .filter(|(abo, rh)| {
            counts
                .get(&("PackedRBC".to_string(), abo.to_string(), rh.to_string()))
                .copied()
                .unwrap_or(0)
                < LOW_STOCK_UNITS
        })
        .map(|(abo, rh)| format!("{abo} {rh}"))
        .collect();
    StockSummary {
        stock: counts
            .into_iter()
            .map(|((product_type, abo, rh), available)| StockLine {
                product_type,
                abo,
                rh,
                available,
            })
            .collect(),
        expiring_unit_ids: expiring,
        low_stock_groups,
        expiry_warning_days: EXPIRY_WARNING_DAYS,
        low_stock_units: LOW_STOCK_UNITS,
        thresholds_are_defaults: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(product: &str, abo: &str, rh: &str, expires: NaiveDate) -> BloodUnitEntity {
        let now = chrono::Utc::now();
        BloodUnitEntity {
            id: format!("{product}-{abo}{rh}-{expires}"),
            unit_number: "ZA0000001".into(),
            product_type: product.into(),
            abo: abo.into(),
            rh: rh.into(),
            collected_on: expires - chrono::Duration::days(30),
            expires_on: expires,
            status: "available".into(),
            location: "Fridge".into(),
            reserved_for_patient_id: None,
            crossmatch_reference: None,
            reserved_at: None,
            issued_to_patient_id: None,
            transfusion_id: None,
            issued_at: None,
            discard_reason: None,
            received_by: "tech".into(),
            created_at: now,
            updated_at: now,
        }
    }

    fn day(offset: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 26).unwrap() + chrono::Duration::days(offset)
    }

    #[test]
    fn red_cells_follow_abo_and_rh() {
        let o_neg = unit("PackedRBC", "O", "negative", day(10));
        let a_pos = unit("PackedRBC", "A", "positive", day(10));
        assert!(compatible(&o_neg, &BloodType::ABPositive));
        assert!(compatible(&o_neg, &BloodType::ANegative));
        assert!(compatible(&a_pos, &BloodType::ABPositive));
        assert!(
            !compatible(&a_pos, &BloodType::ANegative),
            "Rh-positive cells to an Rh-negative recipient"
        );
        assert!(
            !compatible(&a_pos, &BloodType::OPositive),
            "group A cells to a group O recipient"
        );
    }

    #[test]
    fn an_unknown_group_only_gets_universal_products() {
        assert!(compatible(
            &unit("PackedRBC", "O", "negative", day(9)),
            &BloodType::Unknown
        ));
        assert!(!compatible(
            &unit("PackedRBC", "O", "positive", day(9)),
            &BloodType::Unknown
        ));
        assert!(compatible(
            &unit("FFP", "AB", "positive", day(9)),
            &BloodType::Unknown
        ));
        assert!(!compatible(
            &unit("FFP", "O", "positive", day(9)),
            &BloodType::Unknown
        ));
    }

    #[test]
    fn plasma_is_the_reverse_of_red_cells() {
        assert!(compatible(
            &unit("FFP", "AB", "negative", day(9)),
            &BloodType::OPositive
        ));
        assert!(!compatible(
            &unit("FFP", "O", "negative", day(9)),
            &BloodType::ABPositive
        ));
    }

    #[test]
    fn the_summary_flags_expiry_low_stock_and_hides_expired_units() {
        let today = day(0);
        let units = vec![
            unit("PackedRBC", "O", "negative", day(1)), // expiring soon
            unit("PackedRBC", "O", "negative", day(20)),
            unit("PackedRBC", "A", "positive", day(20)), // only one: low
            unit("PackedRBC", "B", "positive", day(-1)), // expired: not stock
        ];
        let summary = summarise(&units, today);
        assert_eq!(summary.expiring_unit_ids.len(), 1);
        assert!(summary.low_stock_groups.contains(&"A positive".to_string()));
        assert!(!summary.low_stock_groups.contains(&"O negative".to_string()));
        assert!(summary.low_stock_groups.contains(&"B positive".to_string()));
        assert_eq!(effective_status(&units[3], today), "expired");
        assert!(summary.thresholds_are_defaults);
    }
}
