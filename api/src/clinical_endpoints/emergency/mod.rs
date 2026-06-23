pub use super::*;
use chrono::{DateTime, NaiveDate};
use serde_json::Value;

mod assessments;
mod crisis;
mod management;

pub use assessments::*;
pub use crisis::*;
pub use management::*;

fn json_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or_default()
}

fn json_label<T: serde::Serialize>(value: &T) -> String {
    match json_value(value) {
        Value::String(label) => label,
        other => other.to_string(),
    }
}

fn parse_date_or_today(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive())
}

fn timestamp_to_datetime(value: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(value, 0).unwrap_or_else(Utc::now)
}

fn timestamp_to_date(value: i64) -> NaiveDate {
    timestamp_to_datetime(value).date_naive()
}

fn u32_to_i32(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn access_log_entity(
    accessor_id: String,
    accessor_role: &str,
    action: &str,
    patient_id: Option<String>,
) -> AccessLogEntity {
    AccessLogEntity {
        id: uuid::Uuid::new_v4().to_string(),
        accessor_id,
        accessor_role: accessor_role.to_string(),
        patient_id,
        resource_type: "emergency_record".to_string(),
        resource_id: None,
        action: action.to_string(),
        access_reason: Some("emergency workflow".to_string()),
        is_emergency_access: true,
        ip_address: None,
        user_agent: None,
        blockchain_tx_hash: None,
        accessed_at: Utc::now(),
        facility_id: None,
    }
}

fn code_blue_entity(record: &CodeBlueRecord, data: Value) -> CodeBlueEntity {
    let now = Utc::now();
    CodeBlueEntity {
        id: record.event_id.clone(),
        patient_id: record.patient_id.clone(),
        location: record.location.clone(),
        code_called_at: record.code_called_at,
        team_arrived_at: record.team_arrived_at,
        initial_rhythm: json_label(&record.initial_rhythm),
        witnessed: record.witnessed,
        outcome: json_label(&record.outcome),
        code_leader: record.code_leader.clone(),
        documented_by: record.documented_by.clone(),
        documented_at: record.documented_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn trauma_entity(assessment: &TraumaAssessment, data: Value) -> TraumaAssessmentEntity {
    let now = Utc::now();
    TraumaAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        mechanism: json_label(&assessment.mechanism),
        gcs: assessment.gcs,
        trauma_level: assessment.trauma_level,
        mtp_activated: assessment.mtp_activated,
        disposition: json_label(&assessment.disposition),
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn stroke_entity(assessment: &StrokeAssessment, data: Value) -> StrokeAssessmentEntity {
    let now = Utc::now();
    StrokeAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        nihss_total: assessment.nihss_total,
        stroke_type: json_label(&assessment.stroke_type),
        tpa_eligible: assessment.tpa_eligible,
        tpa_given: assessment.tpa_given,
        hemorrhage: assessment.hemorrhage,
        lvo_suspected: assessment.lvo_suspected,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn cardiac_entity(event: &CardiacEvent, data: Value) -> CardiacEventEntity {
    let now = Utc::now();
    CardiacEventEntity {
        id: event.event_id.clone(),
        patient_id: event.patient_id.clone(),
        event_type: json_label(&event.event_type),
        cath_lab_activated: event.cath_lab_activated,
        pci_performed: event.pci_performed,
        door_to_balloon_minutes: event.door_to_balloon_minutes,
        documented_by: event.documented_by.clone(),
        documented_at: event.documented_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn sepsis_entity(assessment: &SepsisAssessment, data: Value) -> SepsisAssessmentEntity {
    let now = Utc::now();
    SepsisAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        severity: json_label(&assessment.severity),
        suspected_source: assessment.suspected_source.clone(),
        qsofa_score: assessment.qsofa.score(),
        sofa_score: assessment.sofa_score,
        vasopressors_required: assessment.vasopressors_required,
        icu_admission: assessment.icu_admission,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: assessment.assessed_at,
        data,
        created_at: now,
        updated_at: now,
    }
}

fn ems_handoff_entity(handoff: &EMSHandoff, data: Value) -> EmsHandoffEntity {
    let now = Utc::now();
    EmsHandoffEntity {
        id: handoff.report_id.clone(),
        patient_id: handoff.patient_id.clone(),
        receiving_provider_id: handoff.receiving_physician.clone().unwrap_or_default(),
        handoff_datetime: timestamp_to_datetime(handoff.handoff_time),
        ems_agency: "EMS".to_string(),
        ems_unit_number: Some(handoff.unit_number.clone()),
        crew_members: json_value(&handoff.crew),
        run_number: None,
        dispatch_time: Some(timestamp_to_datetime(handoff.dispatch_time)),
        on_scene_time: Some(timestamp_to_datetime(handoff.on_scene_time)),
        transport_start_time: Some(timestamp_to_datetime(handoff.depart_scene_time)),
        arrival_time: timestamp_to_datetime(handoff.arrival_time),
        scene_address: Some(handoff.scene_location.clone()),
        incident_type: Some(handoff.dispatch_reason.clone()),
        chief_complaint: handoff.chief_complaint.clone(),
        mechanism_of_injury: handoff.mechanism.clone(),
        patient_found: None,
        mental_status_on_scene: None,
        gcs_on_scene: handoff.gcs.map(i32::from),
        vital_signs_on_scene: handoff.vital_signs.first().map(json_value),
        vital_signs_transport: Some(json_value(&handoff.vital_signs)),
        vital_signs_arrival: handoff.vital_signs.last().map(json_value),
        interventions_performed: Some(json_value(&handoff.interventions)),
        medications_given: Some(json_value(&handoff.medications)),
        iv_access_obtained: !handoff.iv_access.is_empty(),
        iv_details: Some(json_value(&handoff.iv_access)),
        airway_management: None,
        cpr_performed: false,
        aed_used: false,
        shocks_delivered: None,
        spinal_immobilization: false,
        splinting_performed: false,
        tourniquet_applied: false,
        bleeding_controlled: None,
        patient_belongings: None,
        family_at_scene: false,
        family_contact_info: None,
        police_at_scene: false,
        police_report_number: None,
        trauma_alert: handoff.trauma_alert,
        stroke_alert: handoff.stroke_alert,
        stemi_alert: handoff.stemi_alert,
        sepsis_alert: false,
        report_received_by: handoff.receiving_physician.clone(),
        report_received_time: Some(timestamp_to_datetime(handoff.handoff_time)),
        verbal_report_complete: true,
        ems_documentation_received: false,
        notes: handoff.notes.clone(),
        created_at: now,
        updated_at: now,
        data,
    }
}

fn medication_record_entity(
    id: String,
    record: &MedicationAdministrationRecord,
    documented_by: String,
    data: Value,
) -> MedicationRecordEntity {
    let now = Utc::now();
    MedicationRecordEntity {
        id,
        patient_id: record.patient_id.clone(),
        record_date: parse_date_or_today(&record.date),
        scheduled_medications: json_value(&record.scheduled_medications),
        prn_medications: json_value(&record.prn_medications),
        infusions: json_value(&record.infusions),
        completion_status: None,
        completion_percentage: None,
        primary_nurse: Some(documented_by),
        created_at: now,
        updated_at: now,
        facility_id: None,
        is_active: true,
        data,
    }
}

fn io_record_entity(id: String, record: &IntakeOutputRecord, data: Value) -> IORecordEntity {
    let now = Utc::now();
    IORecordEntity {
        id,
        patient_id: record.patient_id.clone(),
        record_date: parse_date_or_today(&record.date),
        shift: record.shift.clone(),
        oral_intake: Some(u32_to_i32(record.totals.oral_intake_ml)),
        iv_intake: Some(u32_to_i32(record.totals.iv_intake_ml)),
        tube_feeding: None,
        other_intake: None,
        total_intake: u32_to_i32(record.totals.total_intake_ml),
        urine_output: Some(u32_to_i32(record.totals.urine_output_ml)),
        emesis: None,
        drainage: None,
        stool: None,
        other_output: Some(u32_to_i32(record.totals.other_output_ml)),
        total_output: u32_to_i32(record.totals.total_output_ml),
        net_balance: record.totals.net_balance_ml,
        intake_items: Some(json_value(&record.intake)),
        output_items: Some(json_value(&record.output)),
        notes: None,
        recorded_by: record.documented_by.clone(),
        verified_by: None,
        created_at: now,
        updated_at: now,
        facility_id: None,
        data,
    }
}

fn nursing_care_plan_entity(plan: &NursingCarePlan, data: Value) -> NursingCarePlanEntity {
    NursingCarePlanEntity {
        id: plan.care_plan_id.clone(),
        patient_id: plan.patient_id.clone(),
        plan_name: plan.care_plan_id.clone(),
        care_level: None,
        nursing_diagnoses: json_value(&plan.nursing_diagnoses),
        goals: json_value(&plan.goals),
        interventions: json_value(&plan.interventions),
        evaluation_notes: None,
        status: Some("active".to_string()),
        start_date: parse_date_or_today(&plan.admission_date),
        target_end_date: None,
        actual_end_date: None,
        created_by: plan.created_by.clone(),
        updated_by: Some(plan.updated_by.clone()),
        created_at: timestamp_to_datetime(plan.created_at),
        updated_at: timestamp_to_datetime(plan.updated_at),
        facility_id: None,
        is_active: true,
        data,
    }
}

fn wound_assessment_entity(assessment: &WoundAssessment, data: Value) -> WoundAssessmentEntity {
    let now = Utc::now();
    WoundAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        wound_id: assessment.wound_id.clone(),
        wound_location: assessment.location.body_part.clone(),
        wound_type: json_label(&assessment.wound_type),
        length_cm: None,
        width_cm: None,
        depth_cm: None,
        tissue_type: Some(assessment.wound_bed.description.clone()),
        drainage_amount: Some(json_label(&assessment.drainage.amount)),
        drainage_type: Some(json_label(&assessment.drainage.drainage_type)),
        periwound_condition: Some(assessment.periwound.clone()),
        pain_level: assessment.pain_level.map(i32::from),
        treatment_applied: Some(assessment.treatment.primary_dressing.clone()),
        dressing_type: Some(
            assessment
                .treatment
                .secondary_dressing
                .clone()
                .unwrap_or_default(),
        ),
        notes: assessment.treatment.instructions.clone(),
        photo_taken: Some(assessment.photo_documented),
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: timestamp_to_datetime(assessment.assessed_at),
        created_at: now,
        updated_at: now,
        facility_id: None,
        data,
    }
}

fn iv_assessment_entity(assessment: &IVSiteAssessment, data: Value) -> IVAssessmentEntity {
    let now = Utc::now();
    IVAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        site_id: assessment.line_id.clone(),
        site_location: assessment.insertion_site.clone(),
        catheter_type: Some(json_label(&assessment.line_type)),
        catheter_gauge: Some(assessment.catheter_size.clone()),
        insertion_date: Some(timestamp_to_date(assessment.insertion_time)),
        patency: None,
        site_appearance: assessment.site_assessment.notes.clone(),
        infiltration_grade: None,
        phlebitis_grade: assessment.site_assessment.vip_score.map(i32::from),
        current_infusions: Some(json_value(&assessment.current_infusions)),
        dressing_intact: Some(assessment.site_assessment.dressing_intact),
        dressing_change_due: NaiveDate::parse_from_str(&assessment.dressing_date, "%Y-%m-%d").ok(),
        pain_level: None,
        notes: assessment.site_assessment.notes.clone(),
        actions_taken: None,
        site_discontinued: Some(false),
        discontinuation_reason: None,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: timestamp_to_datetime(assessment.assessed_at),
        created_at: now,
        updated_at: now,
        facility_id: None,
        data,
    }
}

fn shift_handoff_entity(handoff: &ShiftHandoff, data: Value) -> ShiftHandoffEntity {
    let now = Utc::now();
    ShiftHandoffEntity {
        id: handoff.handoff_id.clone(),
        patient_id: handoff.patient_id.clone(),
        outgoing_provider_id: handoff.from_nurse.clone(),
        incoming_provider_id: handoff.to_nurse.clone(),
        handoff_datetime: timestamp_to_datetime(handoff.handoff_time),
        handoff_type: "shift".to_string(),
        location_from: Some(handoff.situation.room_bed.clone()),
        location_to: None,
        situation: json_value(&handoff.situation).to_string(),
        background: json_value(&handoff.background).to_string(),
        assessment: json_value(&handoff.assessment).to_string(),
        recommendation: json_value(&handoff.recommendation).to_string(),
        pending_tasks: json_value(&handoff.pending_tasks),
        pending_results: Some(json_value(&handoff.assessment.pending_labs)),
        pending_consults: None,
        critical_values: None,
        code_status: Some(handoff.situation.code_status.clone()),
        isolation_precautions: handoff.situation.isolation.as_ref().map(json_value),
        fall_risk_level: Some(handoff.safety_checks.fall_risk_level.clone()),
        skin_integrity_issues: None,
        iv_access: Some(json_value(&handoff.assessment.iv_access)),
        drains_tubes: None,
        family_concerns: handoff.recommendation.family_concerns.clone(),
        anticipated_disposition: handoff.recommendation.expected_discharge.clone(),
        contingency_plans: Some(json_value(&handoff.recommendation.watch_for).to_string()),
        questions_asked: handoff.questions.as_ref().map(json_value),
        read_back_confirmed: handoff.acknowledged,
        acknowledged_by_incoming: handoff.acknowledged,
        acknowledged_at: handoff.acknowledged.then_some(now),
        handoff_tool_used: Some("SBAR".to_string()),
        created_at: now,
        updated_at: now,
        data,
    }
}

fn incident_report_entity(report: &IncidentReport, data: Value) -> IncidentReportEntity {
    let now = Utc::now();
    IncidentReportEntity {
        id: report.report_id.clone(),
        patient_id: report.patient_id.clone(),
        reporter_id: report.reported_by.clone(),
        incident_datetime: timestamp_to_datetime(report.incident_time),
        discovery_datetime: timestamp_to_datetime(report.reported_at),
        incident_type: json_label(&report.incident_type),
        severity: "reported".to_string(),
        location: report.location.clone(),
        department: None,
        description: report.description.clone(),
        immediate_actions_taken: Some(json_value(&report.immediate_actions).to_string()),
        patient_outcome: Some(report.outcome.clone()),
        patient_notified: false,
        patient_notified_by: None,
        family_notified: report.family_notified,
        attending_notified: report.physician_notified,
        supervisor_notified: report.supervisor_reviewed,
        risk_management_notified: false,
        witnesses: Some(json_value(&report.witnesses)),
        contributing_factors: Some(json_value(&report.contributing_factors)),
        root_cause: None,
        preventable: None,
        similar_incidents_prior: false,
        corrective_actions: Some(json_value(&report.preventive_measures)),
        follow_up_required: false,
        follow_up_assigned_to: None,
        follow_up_due_date: None,
        follow_up_completed: false,
        follow_up_completed_at: None,
        investigation_status: Some("open".to_string()),
        reviewed_by: report.supervisor_name.clone(),
        reviewed_at: report.review_time.map(timestamp_to_datetime),
        review_comments: None,
        regulatory_reportable: false,
        reported_to_agencies: None,
        confidential: true,
        created_at: now,
        updated_at: now,
        data,
    }
}

fn fall_risk_entity(assessment: &FallRiskAssessment, data: Value) -> FallRiskAssessmentEntity {
    let now = Utc::now();
    FallRiskAssessmentEntity {
        id: assessment.assessment_id.clone(),
        patient_id: assessment.patient_id.clone(),
        assessment_tool: Some("Morse Fall Scale".to_string()),
        history_of_falling: Some(i32::from(assessment.history_of_falling.score)),
        secondary_diagnosis: Some(i32::from(assessment.secondary_diagnosis.score)),
        ambulatory_aid: Some(i32::from(assessment.ambulatory_aid.score)),
        iv_therapy: Some(i32::from(assessment.iv_heparin_lock.score)),
        gait_status: Some(i32::from(assessment.gait.score)),
        mental_status: Some(i32::from(assessment.mental_status.score)),
        total_score: i32::from(assessment.total_score),
        risk_level: json_label(&assessment.risk_level),
        additional_factors: None,
        interventions: Some(json_value(&assessment.interventions)),
        notes: None,
        assessed_by: assessment.assessed_by.clone(),
        assessed_at: timestamp_to_datetime(assessment.assessed_at),
        next_assessment_due: None,
        created_at: now,
        updated_at: now,
        facility_id: None,
        data,
    }
}
