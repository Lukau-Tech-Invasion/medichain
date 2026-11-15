use super::*;
use std::collections::BTreeMap;

/// Sum documented components; a missing measurement must remain unknown.
fn measured_total(values: &[Option<i32>]) -> Option<i64> {
    values
        .iter()
        .try_fold(0_i64, |sum, value| value.map(|v| sum + i64::from(v)))
}

/// Combine shifts for one patient without replacing unknown volumes with zero.
fn patient_totals(records: &[IORecordEntity]) -> (Option<i64>, Option<i64>) {
    let mut intake = Some(0_i64);
    let mut output = Some(0_i64);
    for record in records {
        intake = intake
            .zip(measured_total(&[
                record.oral_intake,
                record.iv_intake,
                record.tube_feeding,
                record.other_intake,
            ]))
            .map(|(sum, value)| sum + value);
        output = output
            .zip(measured_total(&[
                record.urine_output,
                record.emesis,
                record.drainage,
                record.stool,
                record.other_output,
            ]))
            .map(|(sum, value)| sum + value);
    }
    (intake, output)
}

/// Read the existing clinical I/O registry in bounded pages, refusing partial summaries.
async fn read_records(
    repository: &dyn IORecordRepository,
) -> RepositoryResult<Vec<IORecordEntity>> {
    let mut records = Vec::new();
    for page in 0..100 {
        let result = repository.list_all(Pagination::new(page, 100)).await?;
        records.extend(result.items);
        if page + 1 >= result.total_pages {
            return Ok(records);
        }
    }
    Err(RepositoryError::Internal(
        "I/O dashboard page limit exceeded".into(),
    ))
}

/// Return today's persisted UTC-date totals using the same clinical role gate as the registry.
/// The writer stores record_date in UTC; label that period explicitly rather than implying local time.
pub(super) async fn summaries(
    data: &web::Data<AppState>,
) -> RepositoryResult<Vec<serde_json::Value>> {
    let today = Utc::now().date_naive();
    let mut groups: BTreeMap<String, Vec<IORecordEntity>> = BTreeMap::new();
    for record in read_records(data.repositories.io_records.as_ref()).await? {
        if record.record_date == today {
            groups
                .entry(record.patient_id.clone())
                .or_default()
                .push(record);
        }
    }
    let mut summaries = Vec::with_capacity(groups.len());
    for (patient_id, records) in groups {
        let patient = data.repositories.patients.get_by_id(&patient_id).await?;
        let patient = super::dashboards::dashboard_patient(&patient, &data.encryption_keyring);
        let (intake, output) = patient_totals(&records);
        summaries.push(serde_json::json!({
            "patient_id": patient_id, "patient_name": patient.full_name,
            "record_date": today, "total_intake": intake, "total_output": output,
        }));
    }
    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Equal-date records cross a page boundary without duplicates or omissions.
    #[actix_web::test]
    async fn nurse_io_reads_beyond_first_page() {
        let repository = crate::repositories::memory::MemoryIORecordRepository::new();
        for index in 0..101 {
            repository
                .create(IORecordEntity {
                    id: format!("QA-{index:03}"),
                    patient_id: format!("QA-PAT-{index:03}"),
                    record_date: Utc::now().date_naive(),
                    shift: "day".into(),
                    ..Default::default()
                })
                .await
                .unwrap();
        }
        let records = read_records(&repository).await.unwrap();
        let ids: std::collections::BTreeSet<_> = records.iter().map(|r| &r.id).collect();
        assert_eq!(records.len(), 101);
        assert_eq!(ids.len(), 101);
    }

    /// Unknown components stay unknown, and sums cannot overflow the stored i32 range.
    #[test]
    fn nurse_io_measurements_preserve_unknown_and_large_totals() {
        assert_eq!(measured_total(&[Some(0), None]), None);
        assert_eq!(measured_total(&[Some(0), Some(0)]), Some(0));
        assert_eq!(measured_total(&[Some(i32::MAX), Some(1)]), Some(2147483648));
    }

    /// Both shifts contribute once; an undocumented direction remains unknown.
    #[test]
    fn nurse_io_combines_shifts_without_inventing_output() {
        let record = IORecordEntity {
            oral_intake: Some(250),
            iv_intake: Some(0),
            tube_feeding: Some(0),
            other_intake: Some(0),
            urine_output: Some(100),
            emesis: Some(0),
            drainage: Some(0),
            stool: Some(0),
            other_output: Some(0),
            ..Default::default()
        };
        assert_eq!(
            patient_totals(&[record.clone(), record.clone()]),
            (Some(500), Some(200))
        );
        let unknown = IORecordEntity {
            urine_output: None,
            ..record
        };
        assert_eq!(patient_totals(&[unknown]), (Some(250), None));
    }
}
