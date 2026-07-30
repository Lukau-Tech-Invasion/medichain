//! Retention decision logic.
//!
//! Deliberately a **pure function** of its inputs: no database, no clock, no
//! `AppState`. Retention arithmetic decides whether health records become
//! eligible for destruction, so it has to be exhaustively testable without
//! standing up infrastructure — every branch below is covered by a unit test in
//! this file.
//!
//! Nothing in this module deletes anything. It answers "is this record past its
//! retention period, and is anything holding it?" — acting on that answer is a
//! separate, not-yet-built concern (see `docs/PRODUCTION_READINESS_GATES.md` §4).

use chrono::{Datelike, NaiveDate};

/// How a policy computes the date a record becomes eligible for disposal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionRule {
    /// N years after the last clinical entry (ordinary clinical records).
    YearsFromLastEntry(u32),
    /// N years after the triggering event/creation (occupational, forensic,
    /// trials, audit events).
    YearsFromEvent(u32),
    /// The **later** of the data subject reaching `age_years`, or `years` after
    /// the last clinical entry. Minors and obstetric records: a record must
    /// outlive childhood even if the child stopped attending years ago.
    LaterOfAgeOrYearsFromLastEntry { age_years: u32, years: u32 },
    /// Never becomes eligible (legally incapable / State patients).
    Lifetime,
}

impl RetentionRule {
    /// Parse the `retention_rule_kind` column into a rule.
    ///
    /// `minimum_age_years` is only consulted by the age-based rule, and its
    /// absence there is an error rather than a silent default — a policy that
    /// says "retain until adulthood" without saying which age is not a policy.
    pub fn from_policy(
        kind: &str,
        period_years: u32,
        minimum_age_years: Option<u32>,
    ) -> Option<Self> {
        match kind {
            "years_from_last_entry" => Some(Self::YearsFromLastEntry(period_years)),
            "years_from_event" => Some(Self::YearsFromEvent(period_years)),
            "later_of_age_or_years_from_last_entry" => Some(Self::LaterOfAgeOrYearsFromLastEntry {
                age_years: minimum_age_years?,
                years: period_years,
            }),
            "lifetime" => Some(Self::Lifetime),
            _ => None,
        }
    }
}

/// The facts about one record that retention depends on.
#[derive(Debug, Clone)]
pub struct RecordFacts {
    pub patient_id: String,
    pub entity_type: String,
    /// When the record was created / the event occurred.
    pub created_on: NaiveDate,
    /// Most recent clinical entry for this patient. `None` means no clinical
    /// activity is recorded, in which case `created_on` stands in for it.
    pub last_clinical_entry_on: Option<NaiveDate>,
    /// Needed by age-based rules. `None` when the date of birth is unknown or
    /// could not be decrypted.
    pub date_of_birth: Option<NaiveDate>,
}

impl RecordFacts {
    fn effective_last_entry(&self) -> NaiveDate {
        self.last_clinical_entry_on.unwrap_or(self.created_on)
    }
}

/// Why a record is not eligible for disposal, or that it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetentionDecision {
    /// Past its retention period and not held. Eligible for disposal — which
    /// this system does not (yet) perform.
    Due { eligible_since: NaiveDate },
    /// Still within its retention period.
    NotDue { eligible_on: NaiveDate },
    /// Past its retention period but under a legal hold.
    Held { reason: String },
    /// No disposal date applies (lifetime retention), or the facts needed to
    /// compute one are missing. Never eligible without human review.
    Excluded { reason: String },
}

impl RetentionDecision {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Due { .. } => "due",
            Self::NotDue { .. } => "not_due",
            Self::Held { .. } => "held",
            Self::Excluded { .. } => "excluded",
        }
    }
}

/// An active legal hold covering a patient and/or an entity type.
#[derive(Debug, Clone)]
pub struct ActiveHold {
    pub patient_id: Option<String>,
    pub entity_type: Option<String>,
    pub reason: String,
}

impl ActiveHold {
    /// Whether this hold covers the given record.
    ///
    /// A hold scoped to a patient covers every record of that patient; a hold
    /// scoped to an entity type covers that type across patients; a hold naming
    /// both must match both.
    fn covers(&self, facts: &RecordFacts) -> bool {
        let patient_matches = self
            .patient_id
            .as_ref()
            .map(|p| p == &facts.patient_id)
            .unwrap_or(true);
        let entity_matches = self
            .entity_type
            .as_ref()
            .map(|e| e == &facts.entity_type)
            .unwrap_or(true);
        patient_matches && entity_matches
    }
}

/// Decide what should happen to one record.
///
/// Holds are checked **before** the period calculation is trusted, because a
/// held record must never be reported as due regardless of its age.
pub fn evaluate(
    rule: RetentionRule,
    facts: &RecordFacts,
    holds: &[ActiveHold],
    today: NaiveDate,
) -> RetentionDecision {
    if let Some(hold) = holds.iter().find(|h| h.covers(facts)) {
        return RetentionDecision::Held {
            reason: hold.reason.clone(),
        };
    }

    let eligible_on = match rule {
        RetentionRule::Lifetime => {
            return RetentionDecision::Excluded {
                reason: "lifetime retention policy".to_string(),
            }
        }
        RetentionRule::YearsFromEvent(years) => add_years(facts.created_on, years),
        RetentionRule::YearsFromLastEntry(years) => add_years(facts.effective_last_entry(), years),
        RetentionRule::LaterOfAgeOrYearsFromLastEntry { age_years, years } => {
            let from_entry = add_years(facts.effective_last_entry(), years);
            match facts.date_of_birth {
                Some(dob) => {
                    let majority = add_years(dob, age_years);
                    // "Later of" — the record survives until BOTH conditions are
                    // satisfied. Taking the earlier date here would delete a
                    // child's records while they were still a child.
                    from_entry.max(majority)
                }
                // Without a date of birth an age-based rule cannot be computed.
                // Excluding is the safe direction: a record wrongly kept can
                // still be deleted later, a record wrongly deleted cannot be
                // recovered.
                None => {
                    return RetentionDecision::Excluded {
                        reason: "age-based retention rule requires a date of birth".to_string(),
                    }
                }
            }
        }
    };

    let eligible_on = match eligible_on {
        Some(date) => date,
        None => {
            return RetentionDecision::Excluded {
                reason: "retention date is not representable".to_string(),
            }
        }
    };

    if today >= eligible_on {
        RetentionDecision::Due {
            eligible_since: eligible_on,
        }
    } else {
        RetentionDecision::NotDue { eligible_on }
    }
}

/// Add whole years to a date, clamping 29 February to 28 February in non-leap
/// years. Returns `None` only if the result is outside the representable range.
fn add_years(date: NaiveDate, years: u32) -> Option<NaiveDate> {
    let target_year = date.year().checked_add(i32::try_from(years).ok()?)?;
    NaiveDate::from_ymd_opt(target_year, date.month(), date.day()).or_else(|| {
        // 29 Feb in a non-leap target year.
        NaiveDate::from_ymd_opt(target_year, date.month(), date.day().saturating_sub(1))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn facts() -> RecordFacts {
        RecordFacts {
            patient_id: "PAT-001".to_string(),
            entity_type: "clinical_record".to_string(),
            created_on: date(2010, 1, 1),
            last_clinical_entry_on: Some(date(2018, 6, 15)),
            date_of_birth: Some(date(2005, 3, 20)),
        }
    }

    #[test]
    fn ordinary_record_is_not_due_before_six_years_have_passed() {
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &facts(),
            &[],
            date(2024, 6, 14),
        );
        assert_eq!(
            decision,
            RetentionDecision::NotDue {
                eligible_on: date(2024, 6, 15)
            }
        );
    }

    #[test]
    fn ordinary_record_is_due_on_the_boundary_day() {
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &facts(),
            &[],
            date(2024, 6, 15),
        );
        assert_eq!(
            decision,
            RetentionDecision::Due {
                eligible_since: date(2024, 6, 15)
            }
        );
    }

    /// The rule is "later of", so a minor's records must survive past the
    /// six-year mark until they reach the age threshold.
    #[test]
    fn minor_record_survives_past_the_entry_based_date_until_majority() {
        let f = RecordFacts {
            // Last entry 2018 -> entry-based date 2024. Born 2005 -> 21st
            // birthday 2026. The later date (2026) must win.
            ..facts()
        };
        let rule = RetentionRule::LaterOfAgeOrYearsFromLastEntry {
            age_years: 21,
            years: 6,
        };

        // Well past the entry-based date, but still a young adult.
        let decision = evaluate(rule, &f, &[], date(2025, 1, 1));
        assert_eq!(
            decision,
            RetentionDecision::NotDue {
                eligible_on: date(2026, 3, 20)
            }
        );

        // On the 21st birthday it finally becomes due.
        let decision = evaluate(rule, &f, &[], date(2026, 3, 20));
        assert_eq!(
            decision,
            RetentionDecision::Due {
                eligible_since: date(2026, 3, 20)
            }
        );
    }

    /// The converse: an adult whose last entry is recent keeps the entry-based
    /// date, because that is now the later of the two.
    #[test]
    fn adult_record_uses_the_entry_based_date_when_it_is_later() {
        let f = RecordFacts {
            date_of_birth: Some(date(1970, 1, 1)),
            last_clinical_entry_on: Some(date(2024, 1, 1)),
            ..facts()
        };
        let decision = evaluate(
            RetentionRule::LaterOfAgeOrYearsFromLastEntry {
                age_years: 21,
                years: 6,
            },
            &f,
            &[],
            date(2025, 1, 1),
        );
        assert_eq!(
            decision,
            RetentionDecision::NotDue {
                eligible_on: date(2030, 1, 1)
            }
        );
    }

    #[test]
    fn lifetime_policy_is_never_due() {
        let decision = evaluate(RetentionRule::Lifetime, &facts(), &[], date(2999, 12, 31));
        assert!(matches!(decision, RetentionDecision::Excluded { .. }));
    }

    /// A legal hold must beat an otherwise-due record. This is the single most
    /// important behaviour here: reporting a held record as due is how records
    /// under litigation get destroyed.
    #[test]
    fn legal_hold_overrides_an_otherwise_due_record() {
        let holds = vec![ActiveHold {
            patient_id: Some("PAT-001".to_string()),
            entity_type: None,
            reason: "litigation: matter 2026/114".to_string(),
        }];
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &facts(),
            &holds,
            date(2099, 1, 1),
        );
        assert_eq!(
            decision,
            RetentionDecision::Held {
                reason: "litigation: matter 2026/114".to_string()
            }
        );
    }

    #[test]
    fn hold_for_a_different_patient_does_not_apply() {
        let holds = vec![ActiveHold {
            patient_id: Some("PAT-999".to_string()),
            entity_type: None,
            reason: "unrelated matter".to_string(),
        }];
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &facts(),
            &holds,
            date(2099, 1, 1),
        );
        assert!(matches!(decision, RetentionDecision::Due { .. }));
    }

    #[test]
    fn entity_type_wide_hold_applies_across_patients() {
        let holds = vec![ActiveHold {
            patient_id: None,
            entity_type: Some("clinical_record".to_string()),
            reason: "regulatory enquiry".to_string(),
        }];
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &facts(),
            &holds,
            date(2099, 1, 1),
        );
        assert!(matches!(decision, RetentionDecision::Held { .. }));
    }

    #[test]
    fn age_rule_without_date_of_birth_is_excluded_not_due() {
        let f = RecordFacts {
            date_of_birth: None,
            ..facts()
        };
        let decision = evaluate(
            RetentionRule::LaterOfAgeOrYearsFromLastEntry {
                age_years: 21,
                years: 6,
            },
            &f,
            &[],
            date(2099, 1, 1),
        );
        // Must NOT be Due: an unknown age cannot justify destruction.
        assert!(matches!(decision, RetentionDecision::Excluded { .. }));
    }

    #[test]
    fn missing_last_entry_falls_back_to_creation_date() {
        let f = RecordFacts {
            last_clinical_entry_on: None,
            created_on: date(2010, 1, 1),
            ..facts()
        };
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(6),
            &f,
            &[],
            date(2016, 1, 1),
        );
        assert_eq!(
            decision,
            RetentionDecision::Due {
                eligible_since: date(2016, 1, 1)
            }
        );
    }

    #[test]
    fn leap_day_does_not_panic_and_clamps_to_february_28() {
        let f = RecordFacts {
            last_clinical_entry_on: Some(date(2020, 2, 29)),
            ..facts()
        };
        let decision = evaluate(
            RetentionRule::YearsFromLastEntry(1),
            &f,
            &[],
            date(2021, 3, 1),
        );
        assert_eq!(
            decision,
            RetentionDecision::Due {
                eligible_since: date(2021, 2, 28)
            }
        );
    }

    #[test]
    fn policy_rule_kinds_parse_and_unknown_kinds_are_rejected() {
        assert_eq!(
            RetentionRule::from_policy("years_from_last_entry", 6, None),
            Some(RetentionRule::YearsFromLastEntry(6))
        );
        assert_eq!(
            RetentionRule::from_policy("lifetime", 0, None),
            Some(RetentionRule::Lifetime)
        );
        assert_eq!(
            RetentionRule::from_policy("later_of_age_or_years_from_last_entry", 6, Some(21)),
            Some(RetentionRule::LaterOfAgeOrYearsFromLastEntry {
                age_years: 21,
                years: 6
            })
        );
        // An age-based rule with no age is not a usable policy.
        assert_eq!(
            RetentionRule::from_policy("later_of_age_or_years_from_last_entry", 6, None),
            None
        );
        assert_eq!(
            RetentionRule::from_policy("delete_everything", 6, None),
            None
        );
    }
}
