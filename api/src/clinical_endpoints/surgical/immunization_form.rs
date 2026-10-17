use crate::repositories::traits::ImmunizationRecordEntity;
use serde::Deserialize;

/// Accept a recorded calendar date or an older timestamp without substituting today.
fn recorded_date(value: &str) -> Result<chrono::NaiveDate, &'static str> {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .or_else(|_| {
            chrono::DateTime::parse_from_rfc3339(value).map(|timestamp| timestamp.date_naive())
        })
        .map_err(|_| "Recorded date must be a valid date")
}

/// Vaccine administration input; omitted observations remain unknown in storage.
#[derive(Deserialize)]
pub struct CreateImmunizationRequest {
    pub patient_id: String,
    pub vaccine_name: String,
    pub administration_date: String,
    pub lot_number: String,
    pub route: String,
    pub site: String,
    pub dose_number: u8,
    pub vaccine_type: Option<String>,
    pub manufacturer: Option<String>,
    pub cvx_code: Option<String>,
    pub expiration_date: Option<String>,
    pub dose_amount: Option<String>,
    pub total_doses: Option<u8>,
    pub next_dose_due: Option<String>,
    pub patient_consent: Option<bool>,
    pub consent_by: Option<String>,
    pub vfc_eligible: Option<bool>,
    pub funding_source: Option<String>,
    pub registry_reported: Option<bool>,
    pub vis_date: Option<String>,
    pub adverse_reaction: Option<String>,
    pub notes: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Synthetic form submission exercising observations and absent metadata.
    fn submission(date: &str) -> CreateImmunizationRequest {
        serde_json::from_value(serde_json::json!({
            "patient_id": "PAT-QA", "vaccine_name": "Fictional QA vaccine",
            "administration_date": date, "lot_number": "QA-LOT",
            "route": "Intramuscular", "site": "left-deltoid", "dose_number": 2,
            "dose_amount": "0.5 mL", "total_doses": 3, "patient_consent": false,
            "consent_by": "", "vfc_eligible": false, "next_dose_due": "2026-11-10",
            "record_id": "SPOOF", "administered_by": "SPOOF"
        }))
        .unwrap()
    }

    #[test]
    fn vaccine_form_preserves_observations_without_inventing_clinical_metadata() {
        let record = submission("2026-10-10").into_entity("NURSE-QA").unwrap();
        assert_eq!(record.administered_by.as_deref(), Some("NURSE-QA"));
        assert_ne!(record.id, "SPOOF");
        assert_eq!(record.patient_consent, Some(false));
        assert_eq!(record.dose_amount.as_deref(), Some("0.5 mL"));
        assert_eq!(record.data["total_doses"], 3);
        assert_eq!(record.data["next_dose_due"], "2026-11-10");
        assert!(record.cvx_code.is_none());
        assert!(record.vis_given.is_none());
        assert!(record.vis_date.is_none());
        assert!(record.funding_source.is_none());
        assert!(record.reaction_observed.is_none());
    }

    #[test]
    fn vaccine_form_rejects_invalid_dates_instead_of_substituting_today() {
        assert!(submission("2026-02-30").into_entity("NURSE-QA").is_err());
        assert!(submission("").into_entity("NURSE-QA").is_err());
        let record = submission("2020-01-02").into_entity("NURSE-QA").unwrap();
        assert_eq!(record.administration_date.to_string(), "2020-01-02");
    }
}

impl CreateImmunizationRequest {
    /// Bound submitted text and reject unsupported administration routes.
    fn validate(&self) -> Result<(), &'static str> {
        let required = [
            &self.patient_id,
            &self.vaccine_name,
            &self.lot_number,
            &self.site,
        ];
        let optional = [
            &self.vaccine_type,
            &self.manufacturer,
            &self.cvx_code,
            &self.dose_amount,
            &self.consent_by,
            &self.funding_source,
            &self.adverse_reaction,
            &self.notes,
        ];
        if required
            .iter()
            .any(|value| value.trim().is_empty() || value.len() > 5000)
            || optional
                .iter()
                .filter_map(|value| value.as_deref())
                .any(|value| value.len() > 5000)
            || self.dose_number == 0
            || self.total_doses == Some(0)
        {
            return Err("Required vaccine fields are missing or exceed their limits");
        }
        if ![
            "Intramuscular",
            "Subcutaneous",
            "Intradermal",
            "Oral",
            "Intranasal",
        ]
        .contains(&self.route.as_str())
        {
            return Err("Choose a supported administration route");
        }
        for value in [&self.expiration_date, &self.next_dose_due] {
            if let Some(value) = value.as_deref().filter(|value| !value.is_empty()) {
                chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| "Expiry and next-dose dates must be valid dates")?;
            }
        }
        Ok(())
    }

    /// Validate the submitted date and bind storage identity to the server caller.
    pub fn into_entity(self, caller_id: &str) -> Result<ImmunizationRecordEntity, &'static str> {
        self.validate()?;
        let date = recorded_date(&self.administration_date)?;
        if self.patient_id.trim().is_empty()
            || self.vaccine_name.trim().is_empty()
            || self.lot_number.trim().is_empty()
            || self.dose_number == 0
        {
            return Err("Patient, vaccine, lot and positive dose number are required");
        }
        let now = chrono::Utc::now();
        Ok(ImmunizationRecordEntity {
            id: crate::middleware::error_handling::secure_tokens::generate_access_id()
                .replacen("ACC-", "IMM-", 1),
            patient_id: self.patient_id,
            vaccine_type: self.vaccine_type.unwrap_or_default(),
            vaccine_name: self.vaccine_name,
            manufacturer: self.manufacturer,
            lot_number: Some(self.lot_number),
            cvx_code: self.cvx_code.filter(|value| !value.is_empty()),
            administration_date: date,
            administered_by: Some(caller_id.to_owned()),
            administration_site: Some(self.site),
            route: Some(self.route),
            dose_amount: self.dose_amount,
            dose_number: Some(i32::from(self.dose_number)),
            patient_consent: self.patient_consent,
            funding_source: self.funding_source,
            reaction_details: self.adverse_reaction,
            vis_date: self
                .vis_date
                .as_deref()
                .filter(|value| !value.is_empty())
                .map(recorded_date)
                .transpose()
                .map_err(|_| "VIS date must be a valid date")?,
            notes: self.notes,
            created_at: Some(now),
            updated_at: Some(now),
            data: serde_json::json!({
                "expiration_date": self.expiration_date,
                "total_doses": self.total_doses,
                "next_dose_due": self.next_dose_due,
                "consent_by": self.consent_by,
                "vfc_eligible": self.vfc_eligible,
                "registry_reported": self.registry_reported,
            }),
            ..Default::default()
        })
    }
}
