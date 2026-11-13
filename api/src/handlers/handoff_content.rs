//! What a shift handoff draft says about one patient (mockup c2).
//!
//! The draft used to list only which kinds of record the nurse wrote, so the
//! handoff itself was still retyped from memory. Owner decision 2026-11-08: the
//! draft now carries the content, as SBAR lines, each naming where it came from
//! and when, so the receiving nurse can check any line against its record.
//!
//! Only what was recorded is said. A vital nobody took is absent from the line,
//! not "normal"; a patient with no allergies on file reads "No allergies
//! recorded", never "No known allergies", because nobody may have asked. Code
//! status is stated only when a DNR is on file: the absence of one is not a
//! documented full-code decision.
//!
//! The builders here are pure (entities in, lines out) so each rule can be
//! tested without storage; `patient_sbar` does the reading.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::repositories::traits::{
    IORecordEntity, MedicationRecordEntity, Pagination, PhysicianOrderEntity, ProgressNoteEntity,
    RepositoryResult, VitalSignsEntity,
};
use crate::state::AppState;
use crate::types::PatientProfile;

/// Records of each kind read per patient. A shift is twelve hours; these are
/// far above what one shift writes and bound the work per draft.
const READ_PAGE: u32 = 50;
/// Doses given this shift that are named; held or refused doses are all named.
const GIVEN_DOSES_SHOWN: usize = 3;
/// Longest note excerpt quoted.
const NOTE_EXCERPT_CHARS: usize = 160;

/// Where a draft line came from: the receiving nurse's way back to the record.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineSource {
    Vitals,
    Mar,
    Chart,
    Io,
    Note,
    Order,
}

/// One line of the draft.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct DraftLine {
    pub text: String,
    pub source: LineSource,
    /// When the source was recorded; `None` for standing chart facts.
    pub at: Option<DateTime<Utc>>,
}

impl DraftLine {
    fn new(text: String, source: LineSource, at: Option<DateTime<Utc>>) -> Self {
        Self { text, source, at }
    }
}

/// The draft for one patient, by SBAR section.
#[derive(Debug, Serialize, Default, PartialEq)]
pub struct Sbar {
    pub situation: Vec<DraftLine>,
    pub background: Vec<DraftLine>,
    pub assessment: Vec<DraftLine>,
    pub recommendation: Vec<DraftLine>,
}

/// "BP 148/92 · HR 104 · RR 18 · SpO₂ 97% · T 37.2 °C", from what was measured.
pub fn vitals_summary(v: &VitalSignsEntity) -> Option<String> {
    let mut parts: Vec<String> = Vec::with_capacity(6);
    if let (Some(s), Some(d)) = (v.blood_pressure_systolic, v.blood_pressure_diastolic) {
        parts.push(format!("BP {s}/{d}"));
    }
    if let Some(hr) = v.heart_rate {
        parts.push(format!("HR {hr}"));
    }
    if let Some(rr) = v.respiratory_rate {
        parts.push(format!("RR {rr}"));
    }
    if let Some(spo2) = v.oxygen_saturation {
        parts.push(format!("SpO₂ {spo2}%"));
    }
    if let Some(t) = v.temperature {
        parts.push(format!("T {t:.1} °C"));
    }
    // Only a change from alert is worth a line of its own in a handoff.
    if let Some(level) = v.consciousness.as_deref().filter(|c| *c != "alert") {
        parts.push(format!("ACVPU {level}"));
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

/// The latest vitals this shift, with the first of the shift beside them so a
/// trend is visible, and the latest pain score.
pub fn vitals_lines(readings: &[VitalSignsEntity], since: DateTime<Utc>) -> Vec<DraftLine> {
    let mut shift: Vec<&VitalSignsEntity> =
        readings.iter().filter(|v| v.recorded_at >= since).collect();
    shift.sort_by_key(|v| v.recorded_at);
    let mut lines = Vec::with_capacity(2);
    let with_values: Vec<(&VitalSignsEntity, String)> = shift
        .iter()
        .filter_map(|v| vitals_summary(v).map(|s| (*v, s)))
        .collect();
    if let Some((latest, text)) = with_values.last() {
        let text = match with_values.first() {
            Some((first, earlier)) if first.id != latest.id && earlier != text => {
                format!("{text} (first this shift: {earlier})")
            }
            _ => text.clone(),
        };
        lines.push(DraftLine::new(
            text,
            LineSource::Vitals,
            Some(latest.recorded_at),
        ));
    }
    if let Some(pain) = shift.iter().rev().find(|v| v.pain_scale.is_some()) {
        let score = pain.pain_scale.unwrap_or_default();
        lines.push(DraftLine::new(
            format!("Pain {score}/10"),
            LineSource::Vitals,
            Some(pain.recorded_at),
        ));
    }
    lines
}

fn text_of<'a>(event: &'a Value, key: &str) -> Option<&'a str> {
    event
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn time_of(event: &Value, keys: &[&str]) -> Option<DateTime<Utc>> {
    keys.iter()
        .find_map(|k| text_of(event, k))
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&Utc))
}

/// One dose as a line: "Given paracetamol 1 g oral", or "Held metformin: NBM".
fn dose_line(event: &Value, at: DateTime<Utc>) -> Option<(bool, DraftLine)> {
    let name = text_of(event, "medication_name")?;
    let status = text_of(event, "status")
        .unwrap_or("given")
        .to_ascii_lowercase();
    let given = status == "given";
    let text = if given {
        let detail: Vec<&str> = ["dose", "route"]
            .iter()
            .filter_map(|k| text_of(event, k))
            .collect();
        format!("Given {name} {}", detail.join(" "))
            .trim_end()
            .to_string()
    } else {
        let reason = text_of(event, "reason_not_given").unwrap_or("no reason recorded");
        let word = match status.as_str() {
            "refused" => "Refused",
            "held" => "Held",
            _ => "Not given",
        };
        format!("{word} {name}: {reason}")
    };
    Some((given, DraftLine::new(text, LineSource::Mar, Some(at))))
}

/// Doses this shift: every held or refused one, and the last few given.
pub fn mar_lines(records: &[MedicationRecordEntity], since: DateTime<Utc>) -> Vec<DraftLine> {
    let mut doses: Vec<(bool, DraftLine)> = Vec::new();
    for record in records {
        let events = record.data.get("administrations").and_then(Value::as_array);
        for event in events.into_iter().flatten() {
            let Some(at) = time_of(event, &["actual_time", "administered_at"]) else {
                continue;
            };
            if at < since {
                continue;
            }
            if let Some(dose) = dose_line(event, at) {
                doses.push(dose);
            }
        }
    }
    doses.sort_by_key(|(_, line)| line.at);
    let given_from = doses
        .iter()
        .filter(|(given, _)| *given)
        .count()
        .saturating_sub(GIVEN_DOSES_SHOWN);
    let mut seen_given = 0usize;
    let mut lines = Vec::with_capacity(doses.len());
    for (given, line) in doses {
        if given {
            seen_given += 1;
            if seen_given <= given_from {
                continue;
            }
        }
        lines.push(line);
    }
    lines
}

/// Allergies, conditions and a DNR, from the chart.
pub fn background_lines(profile: &PatientProfile) -> Vec<DraftLine> {
    let info = &profile.emergency_info;
    let mut lines = Vec::with_capacity(3);
    let allergies: Vec<&str> = info.allergies.iter().map(|a| a.name.as_str()).collect();
    lines.push(DraftLine::new(
        if allergies.is_empty() {
            "No allergies recorded".to_string()
        } else {
            format!("Allergies: {}", allergies.join(", "))
        },
        LineSource::Chart,
        None,
    ));
    if !info.chronic_conditions.is_empty() {
        lines.push(DraftLine::new(
            format!("Conditions: {}", info.chronic_conditions.join(", ")),
            LineSource::Chart,
            None,
        ));
    }
    if info.dnr_status {
        lines.push(DraftLine::new(
            "Do not resuscitate".to_string(),
            LineSource::Chart,
            None,
        ));
    }
    lines
}

/// Sum of the fluid events in `items` charted since `since`, and the latest time.
fn fluid_since(items: Option<&Value>, since: DateTime<Utc>) -> (i64, Option<DateTime<Utc>>) {
    let mut total = 0i64;
    let mut latest = None;
    for event in items.and_then(Value::as_array).into_iter().flatten() {
        let Some(at) = time_of(event, &["recorded_at"]) else {
            continue;
        };
        if at < since {
            continue;
        }
        total += event.get("amount_ml").and_then(Value::as_i64).unwrap_or(0);
        latest = latest.max(Some(at));
    }
    (total, latest)
}

/// "In 1450 mL · Out 900 mL · balance +550 mL", from fluids charted this shift.
pub fn io_line(records: &[IORecordEntity], since: DateTime<Utc>) -> Option<DraftLine> {
    let (mut intake, mut output, mut latest) = (0i64, 0i64, None);
    for record in records {
        let (i, at_i) = fluid_since(record.intake_items.as_ref(), since);
        let (o, at_o) = fluid_since(record.output_items.as_ref(), since);
        intake += i;
        output += o;
        latest = latest.max(at_i).max(at_o);
    }
    let at = latest?;
    let balance = intake - output;
    Some(DraftLine::new(
        format!("In {intake} mL · Out {output} mL · balance {balance:+} mL"),
        LineSource::Io,
        Some(at),
    ))
}

fn excerpt(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= NOTE_EXCERPT_CHARS {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(NOTE_EXCERPT_CHARS).collect();
    format!("{}…", cut.trim_end())
}

/// The latest note this shift, quoted: its assessment, else what it says first.
pub fn note_line(notes: &[ProgressNoteEntity], since: DateTime<Utc>) -> Option<DraftLine> {
    let note = notes
        .iter()
        .filter(|n| n.is_active && n.created_at >= since)
        .max_by_key(|n| n.created_at)?;
    let body = [
        &note.assessment,
        &note.subjective,
        &note.objective,
        &note.plan_content,
    ]
    .into_iter()
    .find_map(|t| t.as_deref().map(str::trim).filter(|t| !t.is_empty()))?;
    Some(DraftLine::new(
        format!("\u{201c}{}\u{201d}", excerpt(body)),
        LineSource::Note,
        Some(note.created_at),
    ))
}

/// Orders still open, whenever they were written: they are the next shift's work.
pub fn order_lines(orders: &[PhysicianOrderEntity]) -> Vec<DraftLine> {
    let mut open: Vec<&PhysicianOrderEntity> = orders
        .iter()
        .filter(|o| matches!(o.status.as_str(), "pending" | "active" | "on_hold"))
        .collect();
    open.sort_by_key(|o| o.order_datetime);
    open.into_iter()
        .filter_map(|o| {
            let what = o
                .order_details
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|t| !t.is_empty())?;
            let status = if o.status == "on_hold" {
                " (on hold)"
            } else {
                ""
            };
            Some(DraftLine::new(
                format!("{what} — {} order pending{status}", o.order_type),
                LineSource::Order,
                Some(o.order_datetime),
            ))
        })
        .collect()
}

/// Read one patient's records and draft their SBAR. A read that fails is an
/// error, never an empty section: "nothing recorded" must not stand in for
/// "could not be read".
pub async fn patient_sbar(
    data: &AppState,
    profile: &PatientProfile,
    since: DateTime<Utc>,
) -> RepositoryResult<Sbar> {
    let id = profile.patient_id.as_str();
    let page = Pagination::new(0, READ_PAGE);
    let r = &data.repositories;
    let vitals = r.vital_signs.get_by_patient(id, page).await?.items;
    let doses = r
        .medication_records
        .get_by_patient(id, None, page)
        .await?
        .items;
    let fluids = r.io_records.get_by_patient(id, None, page).await?.items;
    let notes = r.progress_notes.get_by_patient(id, page).await?.items;
    let orders = r.physician_orders.get_by_patient(id, page).await?.items;

    let mut situation = vitals_lines(&vitals, since);
    situation.extend(mar_lines(&doses, since));
    Ok(Sbar {
        situation,
        background: background_lines(profile),
        assessment: io_line(&fluids, since)
            .into_iter()
            .chain(note_line(&notes, since))
            .collect(),
        recommendation: order_lines(&orders),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use serde_json::json;

    fn since() -> DateTime<Utc> {
        Utc::now() - Duration::hours(10)
    }

    fn hours_ago(h: i64) -> String {
        (Utc::now() - Duration::hours(h)).to_rfc3339()
    }

    fn reading(id: &str, h: i64, extra: Value) -> VitalSignsEntity {
        let at = hours_ago(h);
        let mut body = json!({
            "id": id, "patient_id": "P1", "is_critical": false,
            "recorded_at": at, "recorded_by": "nurse", "created_at": at,
        });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        serde_json::from_value(body).unwrap()
    }

    #[test]
    fn a_vitals_line_states_only_what_was_measured_and_shows_the_trend() {
        let readings = [
            reading("old", 20, json!({ "heart_rate": 70 })),
            reading(
                "a",
                8,
                json!({ "blood_pressure_systolic": 128, "blood_pressure_diastolic": 82, "heart_rate": 88 }),
            ),
            reading(
                "b",
                1,
                json!({ "blood_pressure_systolic": 148, "blood_pressure_diastolic": 92, "heart_rate": 104, "pain_scale": 6 }),
            ),
        ];
        let lines = vitals_lines(&readings, since());
        assert_eq!(
            lines[0].text,
            "BP 148/92 · HR 104 (first this shift: BP 128/82 · HR 88)"
        );
        assert_eq!(lines[0].source, LineSource::Vitals);
        assert_eq!(lines[1].text, "Pain 6/10");
        // Nothing measured this shift: no line at all, not a line of blanks.
        assert!(vitals_lines(&readings[..1], since()).is_empty());
    }

    #[test]
    fn a_held_dose_keeps_its_reason_and_only_recent_given_doses_are_named() {
        let record = MedicationRecordEntity {
            data: json!({ "administrations": [
                { "medication_name": "Morphine", "status": "given", "administered_at": hours_ago(9) },
                { "medication_name": "Paracetamol", "dose": "1 g", "route": "oral", "status": "given", "administered_at": hours_ago(6) },
                { "medication_name": "Metformin", "status": "held", "reason_not_given": "Nil by mouth", "administered_at": hours_ago(5) },
                { "medication_name": "Ondansetron", "status": "given", "administered_at": hours_ago(4) },
                { "medication_name": "Heparin", "status": "given", "administered_at": hours_ago(3) },
                { "medication_name": "Yesterday", "status": "given", "administered_at": hours_ago(30) },
            ] }),
            ..Default::default()
        };
        let texts: Vec<String> = mar_lines(&[record], since())
            .into_iter()
            .map(|l| l.text)
            .collect();
        assert_eq!(
            texts,
            [
                "Given Paracetamol 1 g oral",
                "Held Metformin: Nil by mouth",
                "Given Ondansetron",
                "Given Heparin"
            ]
        );
    }

    #[test]
    fn the_chart_says_no_allergies_recorded_and_never_assumes_full_code() {
        let mut profile = crate::test_fixtures::patient_profile("P1", "Test");
        let lines = background_lines(&profile);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "No allergies recorded");
        profile.emergency_info.dnr_status = true;
        profile.emergency_info.chronic_conditions = vec!["Type 2 diabetes".into()];
        let texts: Vec<String> = background_lines(&profile)
            .into_iter()
            .map(|l| l.text)
            .collect();
        assert_eq!(
            texts,
            [
                "No allergies recorded",
                "Conditions: Type 2 diabetes",
                "Do not resuscitate"
            ]
        );
    }

    #[test]
    fn fluids_count_only_this_shift_and_say_nothing_when_none_were_charted() {
        let record = IORecordEntity {
            intake_items: Some(json!([
                { "amount_ml": 1000, "recorded_at": hours_ago(5) },
                { "amount_ml": 450, "recorded_at": hours_ago(2) },
                { "amount_ml": 700, "recorded_at": hours_ago(20) },
            ])),
            output_items: Some(json!([{ "amount_ml": 900, "recorded_at": hours_ago(1) }])),
            ..Default::default()
        };
        assert_eq!(
            io_line(&[record], since()).unwrap().text,
            "In 1450 mL · Out 900 mL · balance +550 mL"
        );
        assert!(io_line(&[IORecordEntity::default()], since()).is_none());
    }

    #[test]
    fn the_latest_note_is_quoted_and_open_orders_are_the_next_shifts_work() {
        let note = ProgressNoteEntity {
            assessment: Some("Wound dressing clean and dry".into()),
            created_at: Utc::now() - Duration::hours(2),
            is_active: true,
            ..Default::default()
        };
        assert_eq!(
            note_line(&[note], since()).unwrap().text,
            "\u{201c}Wound dressing clean and dry\u{201d}"
        );
        let order = |status: &str, text: &str| PhysicianOrderEntity {
            status: status.into(),
            order_type: "lab".into(),
            order_details: json!({ "text": text }),
            ..Default::default()
        };
        let lines = order_lines(&[
            order("pending", "HbA1c"),
            order("completed", "FBC"),
            order("on_hold", "CT head"),
        ]);
        let texts: Vec<String> = lines.into_iter().map(|l| l.text).collect();
        assert_eq!(
            texts,
            [
                "HbA1c — lab order pending",
                "CT head — lab order pending (on hold)"
            ]
        );
    }
}
