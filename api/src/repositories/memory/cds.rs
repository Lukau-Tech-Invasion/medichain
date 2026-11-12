//! In-memory repositories for clinical decision support alerts.

use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::RwLock;

use crate::repositories::traits::*;

/// In-memory CDS alert repository
#[derive(Debug, Default)]
pub struct MemoryCdsAlertRepository {
    alerts: RwLock<HashMap<String, CdsAlertEntity>>,
}

impl MemoryCdsAlertRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CdsAlertRepository for MemoryCdsAlertRepository {
    async fn create(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        alerts.insert(alert.id.clone(), alert.clone());
        Ok(alert)
    }

    async fn get_by_id(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let alerts = self.alerts.read().unwrap();
        alerts
            .get(id)
            .cloned()
            .ok_or_else(|| RepositoryError::NotFound(format!("CDS alert {} not found", id)))
    }

    async fn update(&self, alert: CdsAlertEntity) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if !alerts.contains_key(&alert.id) {
            return Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                alert.id
            )));
        }
        alerts.insert(alert.id.clone(), alert.clone());
        Ok(alert)
    }

    async fn get_by_patient(
        &self,
        patient_id: &str,
        active_only: bool,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| a.patient_id == patient_id)
            .filter(|a| !active_only || a.status == "active")
            .cloned()
            .collect();
        Ok(result)
    }

    async fn acknowledge(
        &self,
        id: &str,
        by: &str,
        reason: Option<&str>,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "acknowledged".to_string();
            alert.acknowledged_by = Some(by.to_string());
            alert.acknowledged_datetime = Some(Utc::now());
            if let Some(r) = reason {
                alert.action_taken = Some(r.to_string());
            }
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn override_alert(
        &self,
        id: &str,
        by: &str,
        reason: &str,
    ) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "overridden".to_string();
            alert.override_justification = Some(by.to_string());
            alert.override_reason = Some(reason.to_string());
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn get_by_encounter(&self, encounter_id: &str) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| {
                a.encounter_id
                    .as_ref()
                    .map(|e| e == encounter_id)
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn get_unacknowledged(
        &self,
        patient_id: Option<&str>,
    ) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| a.acknowledged_by.is_none() && a.status == "active")
            .filter(|a| patient_id.map(|pid| a.patient_id == pid).unwrap_or(true))
            .cloned()
            .collect();
        Ok(result)
    }

    async fn dismiss(&self, id: &str) -> RepositoryResult<CdsAlertEntity> {
        let mut alerts = self.alerts.write().unwrap();
        if let Some(alert) = alerts.get_mut(id) {
            alert.status = "dismissed".to_string();
            alert.updated_at = Utc::now();
            Ok(alert.clone())
        } else {
            Err(RepositoryError::NotFound(format!(
                "CDS alert {} not found",
                id
            )))
        }
    }

    async fn get_by_rule(
        &self,
        rule_id: &str,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let filtered: Vec<_> = alerts
            .values()
            .filter(|a| a.rule_id.as_deref() == Some(rule_id))
            .cloned()
            .collect();
        let total = filtered.len() as u64;
        let items: Vec<_> = filtered
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }

    async fn get_high_severity(&self) -> RepositoryResult<Vec<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let result: Vec<_> = alerts
            .values()
            .filter(|a| {
                a.status == "active"
                    && a.acknowledged_by.is_none()
                    && (a.severity == "critical" || a.severity == "high")
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn list_all(
        &self,
        pagination: Pagination,
    ) -> RepositoryResult<PaginatedResult<CdsAlertEntity>> {
        let alerts = self.alerts.read().unwrap();
        let all: Vec<_> = alerts.values().cloned().collect();
        let total = all.len() as u64;
        let items: Vec<_> = all
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.limit() as usize)
            .collect();
        Ok(PaginatedResult::new(items, total, &pagination))
    }
    async fn count_by_severity(&self) -> RepositoryResult<(u64, u64)> {
        let alerts = self
            .alerts
            .read()
            .map_err(|e| RepositoryError::Internal(e.to_string()))?;
        let total = alerts.len() as u64;
        let critical = alerts
            .values()
            .filter(|a| a.severity.eq_ignore_ascii_case("critical"))
            .count() as u64;
        Ok((total, critical))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------- Phase 2.2 coverage: billing code methods --------

    // -------- Phase 2.2 coverage: CDS alert methods --------
    fn make_alert(id: &str, severity: &str, encounter: Option<&str>, rule: &str) -> CdsAlertEntity {
        CdsAlertEntity {
            id: id.to_string(),
            patient_id: "pat-1".to_string(),
            encounter_id: encounter.map(|e| e.to_string()),
            provider_id: "prov-1".to_string(),
            alert_datetime: Utc::now(),
            alert_type: "drug_interaction".to_string(),
            alert_category: "safety".to_string(),
            severity: severity.to_string(),
            alert_title: "Test".to_string(),
            alert_message: "msg".to_string(),
            clinical_evidence: None,
            recommendation: None,
            source_system: None,
            rule_id: Some(rule.to_string()),
            rule_version: None,
            trigger_data: None,
            related_order_id: None,
            related_medication_id: None,
            related_lab_id: None,
            status: "active".to_string(),
            acknowledged_by: None,
            acknowledged_datetime: None,
            override_reason: None,
            override_justification: None,
            action_taken: None,
            action_datetime: None,
            auto_resolved: None,
            resolution_reason: None,
            was_helpful: None,
            feedback_notes: None,
            displayed_duration_seconds: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_cds_alert_workflow() {
        let repo = MemoryCdsAlertRepository::new();

        let alert = CdsAlertEntity {
            id: "alert-001".to_string(),
            patient_id: "patient-001".to_string(),
            encounter_id: None,
            provider_id: "provider-001".to_string(),
            alert_datetime: Utc::now(),
            alert_type: "drug_interaction".to_string(),
            alert_category: "safety".to_string(),
            severity: "critical".to_string(),
            alert_title: "Drug Interaction".to_string(),
            alert_message: "Potential interaction between medications".to_string(),
            clinical_evidence: None,
            recommendation: Some("Consider alternative".to_string()),
            source_system: Some("CDS Engine".to_string()),
            rule_id: Some("DI-001".to_string()),
            rule_version: Some("1.0".to_string()),
            trigger_data: None,
            related_order_id: None,
            related_medication_id: None,
            related_lab_id: None,
            status: "active".to_string(),
            acknowledged_by: None,
            acknowledged_datetime: None,
            override_reason: None,
            override_justification: None,
            action_taken: None,
            action_datetime: None,
            auto_resolved: None,
            resolution_reason: None,
            was_helpful: None,
            feedback_notes: None,
            displayed_duration_seconds: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let created = repo.create(alert).await.unwrap();
        assert_eq!(created.status, "active");

        let acknowledged = repo
            .acknowledge("alert-001", "provider-001", Some("Reviewed"))
            .await
            .unwrap();
        assert_eq!(acknowledged.status, "acknowledged");
        assert!(acknowledged.acknowledged_datetime.is_some());
    }

    #[tokio::test]
    async fn test_cds_alert_dismiss_and_filters() {
        let repo = MemoryCdsAlertRepository::new();
        repo.create(make_alert("a-1", "critical", Some("enc-1"), "R-A"))
            .await
            .unwrap();
        repo.create(make_alert("a-2", "low", Some("enc-1"), "R-B"))
            .await
            .unwrap();
        repo.create(make_alert("a-3", "high", None, "R-A"))
            .await
            .unwrap();

        // get_by_encounter
        let in_enc = repo.get_by_encounter("enc-1").await.unwrap();
        assert_eq!(in_enc.len(), 2);

        // get_unacknowledged (with patient filter and without)
        let all_unack = repo.get_unacknowledged(None).await.unwrap();
        assert_eq!(all_unack.len(), 3);
        let pat_unack = repo.get_unacknowledged(Some("pat-1")).await.unwrap();
        assert_eq!(pat_unack.len(), 3);

        // get_high_severity (critical + high, excludes low)
        let high = repo.get_high_severity().await.unwrap();
        assert_eq!(high.len(), 2);

        // get_by_rule pagination
        let by_rule = repo
            .get_by_rule("R-A", Pagination::new(0, 10))
            .await
            .unwrap();
        assert_eq!(by_rule.total, 2);

        // dismiss
        let dismissed = repo.dismiss("a-2").await.unwrap();
        assert_eq!(dismissed.status, "dismissed");
    }
}
