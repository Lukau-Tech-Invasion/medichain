//! Supplemental form sections retained with a certificate draft or filed record.
use std::collections::BTreeMap;

/// Known form sections only; business identity, status and attribution stay server-owned.
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateFormSections {
    pub decedent: BTreeMap<String, serde_json::Value>,
    pub death: BTreeMap<String, serde_json::Value>,
    pub cause: BTreeMap<String, serde_json::Value>,
    pub certifier: BTreeMap<String, serde_json::Value>,
}

/// Validate bounded, non-executable form values before retaining supplemental details.
pub fn valid_sections(sections: &CertificateFormSections) -> bool {
    let fields = [
        (&sections.decedent, "firstName middleName lastName ssn dateOfBirth sex race maritalStatus occupation birthplace residence"),
        (&sections.death, "dateOfDeath timeOfDeath placeOfDeath facilityName countyOfDeath cityOfDeath stateOfDeath pronouncedBy pronouncedDate pronouncedTime"),
        (&sections.cause, "immediateCause immediateDuration underlyingCauses mannerOfDeath autopsy autopsyUsed tobaccoContributed pregnancyStatus injuryDate injuryTime injuryPlace injuryDescription"),
        (&sections.certifier, "certifierType certifierName licenseNumber certifierTitle certifierAddress dateSigned timeSigned signature"),
    ];
    fields.iter().all(|(section, allowed)| {
        section.len() <= 12
            && section.iter().all(|(key, value)| {
                allowed.split_whitespace().any(|field| field == key) && valid_field(key, value)
            })
    })
}

/// Accept only strings, the two collected boolean answers, and bounded cause entries.
fn valid_field(key: &str, value: &serde_json::Value) -> bool {
    if matches!(key, "autopsy" | "autopsyUsed") {
        return value.is_boolean() || value.is_null();
    }
    if key == "underlyingCauses" {
        return value.as_array().is_some_and(|causes| {
            causes.len() <= 4
                && causes.iter().all(|cause| {
                    cause.as_object().is_some_and(|fields| {
                        fields.len() <= 2
                            && fields.iter().all(|(field, text)| {
                                matches!(field.as_str(), "cause" | "duration") && bounded_text(text)
                            })
                    })
                })
        });
    }
    bounded_text(value)
}

fn bounded_text(value: &serde_json::Value) -> bool {
    value.as_str().is_some_and(|text| text.len() <= 5_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certificate_sections_preserve_details_and_reject_unbounded_or_unexpected_values() {
        let mut form = CertificateFormSections::default();
        form.decedent
            .insert("middleName".into(), serde_json::json!("QA middle name"));
        form.decedent
            .insert("sex".into(), serde_json::json!("female"));
        form.cause.insert(
            "underlyingCauses".into(),
            serde_json::json!([{"cause":"QA cause","duration":"2 days"}]),
        );
        assert!(valid_sections(&form));
        let round_trip: CertificateFormSections =
            serde_json::from_value(serde_json::to_value(&form).unwrap()).unwrap();
        assert_eq!(round_trip.decedent["middleName"], "QA middle name");
        form.decedent
            .insert("status".into(), serde_json::json!("filed"));
        assert!(!valid_sections(&form));
        form.decedent.remove("status");
        form.decedent
            .insert("occupation".into(), serde_json::json!("x".repeat(5_001)));
        assert!(!valid_sections(&form));
        form.decedent.remove("occupation");
        form.cause.insert(
            "underlyingCauses".into(),
            serde_json::json!([{}, {}, {}, {}, {}]),
        );
        assert!(!valid_sections(&form));
    }
}
