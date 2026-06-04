//! Actix-web route registration.
//!
//! Split out of `main.rs` (Phase 10.2). Holds the full service table so the
//! entry point stays thin; call via `App::new()....configure(routes::configure)`.

use crate::clinical_endpoints;
use crate::handlers::*;
use actix_web::web;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg
        // Observability (Phase 8.2): Prometheus scrape endpoint
        .route(
            "/api/metrics",
            web::get().to(crate::middleware::metrics::metrics_endpoint),
        )
        .service(health_check)
        .service(readiness_check)
        .service(db_health_check)
        .service(detailed_health_check)
        .service(register_patient)
        .service(update_patient)
        .service(add_emergency_contact)
        .service(emergency_access)
        .service(simulate_nfc_tap)
        .service(get_all_access_logs)
        .service(get_access_logs)
        .service(list_patients)
        .service(get_patient_by_id)
        .service(demo_info)
        .service(demo_login)
        // RBAC endpoints
        .service(assign_role)
        .service(revoke_role)
        .service(get_user_with_profile) // Must be before list_users (specific before generic)
        .service(list_users)
        .service(get_user_details)
        .service(update_user_profile)
        .service(get_my_records)
        // Wallet authentication endpoints
        .service(get_auth_challenge) // SEC-005: Auth challenge for signing
        .service(bootstrap_admin)
        .service(wallet_register)
        .service(wallet_login)
        .service(wallet_login_get)
        .service(wallet_lookup)
        // Session token endpoints
        .service(create_session_token) // POST /api/auth/session
        .service(verify_session_token) // GET  /api/auth/verify
        // JWT auth (Phase 9.4)
        .service(issue_jwt) // POST /api/auth/jwt
        .service(refresh_jwt) // POST /api/auth/jwt/refresh
        // MFA / TOTP (Phase 11.3)
        .service(mfa_enroll) // POST /api/auth/mfa/enroll
        .service(mfa_verify) // POST /api/auth/mfa/verify
        .service(mfa_challenge) // POST /api/auth/mfa/challenge
        .service(mfa_status) // GET  /api/auth/mfa/status
        .service(mfa_disable) // POST /api/auth/mfa/disable
        // Security alerts & breach declaration (Phase 11.4)
        .service(list_security_alerts) // GET  /api/admin/security/alerts
        .service(declare_breach) // POST /api/admin/security/breach
        // Insurance cards CRUD (Phase 13.4)
        .service(create_insurance_card) // POST   /api/insurance/cards
        .service(list_insurance_cards) // GET    /api/insurance/cards/{patient_id}
        .service(update_insurance_card) // PUT    /api/insurance/cards/{id}
        .service(delete_insurance_card) // DELETE /api/insurance/cards/{id}
        .service(upload_insurance_card_image) // POST /api/insurance/cards/{id}/image
        // PDF export (Phase 13.3)
        .service(export_pdf_document) // POST /api/pdf/document
        .service(register_device)
        .service(get_current_user_info)
        .service(get_all_staff)
        .service(get_providers)
        .service(save_settings)
        // IPFS medical record endpoints
        .service(ipfs_health_check)
        .service(upload_medical_record)
        .service(download_medical_record)
        .service(list_patient_records)
        // Lab result submission endpoints (approval workflow)
        .service(submit_lab_results)
        .service(get_pending_lab_results)
        .service(get_all_lab_submissions)
        .service(get_lab_submission)
        .service(review_lab_results)
        .service(review_lab_submission_path)
        .service(get_patient_lab_submissions)
        // NFC card simulation endpoints
        .service(generate_nfc_card)
        .service(nfc_tap)
        .service(verify_qr_code)
        .service(get_card_info)
        .service(suspend_card)
        .service(list_nfc_cards)
        // Clinical documentation endpoints (Phase 1)
        // IMPORTANT: get_triage_queue must be registered BEFORE get_triage_assessment
        // otherwise /api/clinical/triage/queue matches {assessment_id} as "queue"
        .service(get_triage_queue)
        .service(create_triage_assessment)
        .service(get_triage_assessment)
        .service(get_patient_triage_assessments)
        .service(create_soap_note)
        .service(get_soap_note)
        .service(get_patient_soap_notes)
        .service(add_soap_addendum)
        .service(create_sample_history)
        .service(get_sample_history)
        .service(create_gcs_assessment)
        .service(get_gcs_assessment)
        .service(get_patient_gcs_assessments)
        .service(add_vital_signs)
        .service(get_patient_vitals)
        .service(get_vitals_flowsheet)
        .service(get_patient_latest_vitals)
        .service(get_lab_panels)
        .service(get_lab_panel)
        // Emergency protocol endpoints (Phase 2) - from clinical_endpoints module
        .service(clinical_endpoints::create_code_blue)
        .service(clinical_endpoints::get_code_blue)
        .service(clinical_endpoints::list_patient_code_blues)
        .service(clinical_endpoints::create_trauma)
        .service(clinical_endpoints::get_trauma)
        .service(clinical_endpoints::create_stroke)
        .service(clinical_endpoints::get_stroke)
        .service(clinical_endpoints::create_cardiac)
        .service(clinical_endpoints::get_cardiac)
        .service(clinical_endpoints::create_sepsis)
        .service(clinical_endpoints::get_sepsis)
        .service(clinical_endpoints::create_ems_handoff)
        .service(clinical_endpoints::get_ems_handoff)
        .service(clinical_endpoints::get_patient_emergency_records)
        // Nursing documentation endpoints (Phase 3)
        .service(clinical_endpoints::create_mar)
        .service(clinical_endpoints::get_mar)
        .service(clinical_endpoints::create_io)
        .service(clinical_endpoints::get_io)
        .service(clinical_endpoints::create_care_plan)
        .service(clinical_endpoints::get_care_plan)
        .service(clinical_endpoints::create_wound)
        .service(clinical_endpoints::get_wound)
        .service(clinical_endpoints::list_wound_assessments)
        .service(clinical_endpoints::create_iv_site)
        .service(clinical_endpoints::get_iv_site)
        .service(clinical_endpoints::create_shift_handoff)
        .service(clinical_endpoints::get_shift_handoff)
        .service(clinical_endpoints::create_incident)
        .service(clinical_endpoints::get_incident)
        .service(clinical_endpoints::create_fall_risk)
        .service(clinical_endpoints::get_fall_risk)
        // Specialized assessment endpoints (Phase 4)
        .service(clinical_endpoints::create_burn)
        .service(clinical_endpoints::get_burn)
        .service(clinical_endpoints::create_psych)
        .service(clinical_endpoints::get_psych)
        .service(clinical_endpoints::create_tox)
        .service(clinical_endpoints::get_tox)
        .service(clinical_endpoints::create_mci)
        .service(clinical_endpoints::get_mci)
        // Procedure endpoints (Phase 5)
        .service(clinical_endpoints::create_intubation)
        .service(clinical_endpoints::get_intubation)
        .service(clinical_endpoints::create_laceration)
        .service(clinical_endpoints::get_laceration)
        .service(clinical_endpoints::list_laceration_repairs)
        .service(clinical_endpoints::create_splint)
        .service(clinical_endpoints::get_splint)
        // Specialty population endpoints (Phase 6)
        .service(clinical_endpoints::create_peds)
        .service(clinical_endpoints::get_peds)
        .service(clinical_endpoints::create_ob)
        .service(clinical_endpoints::get_ob)
        // Laboratory endpoints (Phase 7)
        .service(clinical_endpoints::create_specimen)
        .service(clinical_endpoints::get_specimen)
        .service(clinical_endpoints::list_specimens)
        .service(clinical_endpoints::create_chain_of_custody)
        .service(clinical_endpoints::get_chain_of_custody)
        .service(clinical_endpoints::create_lab_qc)
        .service(clinical_endpoints::get_lab_qc)
        .service(clinical_endpoints::create_critical_value)
        .service(clinical_endpoints::get_critical_value)
        .service(clinical_endpoints::create_specimen_rejection)
        .service(clinical_endpoints::get_specimen_rejection)
        // Physician documentation endpoints (Phase 8)
        .service(clinical_endpoints::create_order)
        .service(clinical_endpoints::get_order)
        .service(clinical_endpoints::create_discharge_summary)
        .service(clinical_endpoints::get_discharge_summary)
        .service(clinical_endpoints::create_discharge_instructions)
        .service(clinical_endpoints::get_discharge_instructions)
        .service(clinical_endpoints::create_ama)
        .service(clinical_endpoints::get_ama)
        .service(clinical_endpoints::create_hp)
        .service(clinical_endpoints::get_hp)
        .service(clinical_endpoints::list_hps)
        .service(clinical_endpoints::create_consult)
        .service(clinical_endpoints::get_consult)
        .service(clinical_endpoints::create_progress_note)
        .service(clinical_endpoints::get_progress_note)
        // Phase 9: Surgical Documentation endpoints
        .service(clinical_endpoints::create_pre_op)
        .service(clinical_endpoints::get_pre_op)
        .service(clinical_endpoints::create_operative_note)
        .service(clinical_endpoints::get_operative_note)
        .service(clinical_endpoints::create_post_op)
        .service(clinical_endpoints::get_post_op)
        // Phase 10: Anesthesia endpoints
        .service(clinical_endpoints::create_anesthesia)
        .service(clinical_endpoints::get_anesthesia)
        .service(clinical_endpoints::list_anesthesia)
        // Phase 11: Radiology endpoints
        .service(clinical_endpoints::create_radiology_order)
        .service(clinical_endpoints::get_radiology_order)
        .service(clinical_endpoints::create_radiology_report)
        .service(clinical_endpoints::get_radiology_report)
        // Phase 12: Pathology endpoints
        .service(clinical_endpoints::create_pathology)
        .service(clinical_endpoints::get_pathology)
        // Phase 13: Immunization endpoints
        .service(clinical_endpoints::create_immunization)
        .service(clinical_endpoints::get_immunization)
        // Phase 14: Family History endpoints
        .service(clinical_endpoints::create_family_history)
        .service(clinical_endpoints::get_family_history)
        // Phase 15: Blood Bank endpoints
        .service(clinical_endpoints::create_blood_type_screen)
        .service(clinical_endpoints::get_blood_type_screen)
        .service(clinical_endpoints::create_transfusion)
        .service(clinical_endpoints::get_transfusion)
        // Phase 16: E-Prescribing endpoints
        .service(clinical_endpoints::create_e_prescription)
        .service(clinical_endpoints::get_e_prescription)
        // Phase 17: Appointment endpoints
        .service(clinical_endpoints::create_appointment)
        .service(clinical_endpoints::get_appointment)
        // Phase 18: Death Certificate & Autopsy endpoints
        .service(clinical_endpoints::create_death_certificate)
        .service(clinical_endpoints::get_death_certificate)
        .service(clinical_endpoints::create_autopsy_request)
        .service(clinical_endpoints::get_autopsy_request)
        // Phase 19: Patient Satisfaction endpoints
        .service(clinical_endpoints::create_satisfaction_survey)
        .service(clinical_endpoints::get_satisfaction_survey)
        // HL7 FHIR R4 endpoints
        .service(clinical_endpoints::fhir_get_patient)
        .service(clinical_endpoints::fhir_get_allergies)
        .service(clinical_endpoints::fhir_get_medications)
        .service(clinical_endpoints::fhir_get_conditions)
        .service(clinical_endpoints::fhir_get_observations)
        .service(clinical_endpoints::fhir_get_encounters)
        .service(clinical_endpoints::fhir_get_diagnostic_reports)
        .service(clinical_endpoints::fhir_get_procedures)
        .service(clinical_endpoints::fhir_get_immunizations)
        .service(clinical_endpoints::fhir_capability_statement)
        // Insurance Verification endpoints
        .service(clinical_endpoints::verify_insurance)
        .service(clinical_endpoints::check_eligibility)
        // Dashboard & Workflow endpoints
        .service(clinical_endpoints::patient_dashboard)
        .service(clinical_endpoints::doctor_dashboard)
        .service(clinical_endpoints::nurse_dashboard)
        .service(clinical_endpoints::lab_dashboard)
        .service(clinical_endpoints::admin_dashboard)
        .service(clinical_endpoints::pharmacist_dashboard)
        .service(clinical_endpoints::get_patient_list)
        .service(clinical_endpoints::get_order_sets)
        .service(clinical_endpoints::get_notifications)
        .service(clinical_endpoints::get_medication_reminders)
        .service(clinical_endpoints::get_nurse_tasks)
        // Symptom Tracker endpoints
        .service(clinical_endpoints::log_symptom)
        .service(clinical_endpoints::get_symptom_history)
        // Secure Messaging endpoints
        .service(clinical_endpoints::send_message)
        .service(clinical_endpoints::get_messages)
        // Consent Form endpoints
        .service(clinical_endpoints::get_consent_types)
        .service(clinical_endpoints::sign_consent)
        .service(clinical_endpoints::get_patient_consents)
        // Barcode/Sample Tracking endpoints
        .service(clinical_endpoints::generate_barcode)
        .service(clinical_endpoints::scan_barcode)
        .service(clinical_endpoints::track_barcode)
        .service(clinical_endpoints::get_barcode_scan_history)
        // Quick Note Templates endpoints
        .service(clinical_endpoints::get_note_templates)
        .service(clinical_endpoints::use_note_template)
        // Medical ID Card endpoints
        .service(clinical_endpoints::get_medical_id)
        .service(clinical_endpoints::get_medical_id_qr)
        .service(clinical_endpoints::get_emergency_medical_id)
        .service(clinical_endpoints::get_lockscreen_medical_id)
        .service(clinical_endpoints::update_medical_id_preferences)
        .service(clinical_endpoints::trigger_emergency_notification)
        // Phase 20: Medication Reminder endpoints
        .service(clinical_endpoints::create_medication_reminder)
        .service(clinical_endpoints::get_patient_reminders)
        .service(clinical_endpoints::log_medication_adherence)
        .service(clinical_endpoints::delete_medication_reminder)
        // Phase 21: Drug Interaction Checking endpoints
        .service(clinical_endpoints::get_drug_database)
        .service(clinical_endpoints::get_interaction_database)
        .service(clinical_endpoints::check_drug_interactions)
        .service(clinical_endpoints::get_interaction_history)
        // Phase 22: Family Account Linking endpoints
        .service(clinical_endpoints::create_family_group)
        .service(clinical_endpoints::add_family_member)
        .service(clinical_endpoints::get_family_group)
        .service(clinical_endpoints::get_my_family_groups)
        .service(clinical_endpoints::remove_family_member)
        // Phase 23: Appointment Booking System endpoints
        .service(clinical_endpoints::book_appointment)
        .service(clinical_endpoints::get_patient_appointments)
        .service(clinical_endpoints::get_provider_appointments)
        .service(clinical_endpoints::cancel_appointment)
        .service(clinical_endpoints::check_in_appointment)
        .service(clinical_endpoints::get_available_slots)
        // Phase 24: Wearable Device Integration endpoints
        .service(clinical_endpoints::get_supported_wearables)
        .service(clinical_endpoints::register_wearable_device)
        .service(clinical_endpoints::get_wearable_devices)
        .service(clinical_endpoints::submit_wearable_reading)
        .service(clinical_endpoints::get_wearable_readings)
        .service(clinical_endpoints::create_wearable_alert_rule)
        .service(clinical_endpoints::get_wearable_alerts)
        // Phase 25: AI Symptom Checker
        .service(clinical_endpoints::start_symptom_check)
        .service(clinical_endpoints::submit_symptom_answers)
        .service(clinical_endpoints::get_symptom_session)
        .service(clinical_endpoints::get_symptom_checker_history)
        .service(clinical_endpoints::analyze_symptoms)
        // Phase 26: Telehealth Integration endpoints
        .service(clinical_endpoints::telehealth_health) // GET /api/health/telehealth (Phase 5)
        .service(clinical_endpoints::create_telehealth_session)
        .service(clinical_endpoints::get_telehealth_session)
        .service(clinical_endpoints::join_telehealth_session)
        .service(clinical_endpoints::telehealth_event) // POST /…/event (Phase 7 SSE relay + audit)
        .service(clinical_endpoints::telehealth_recording) // POST /…/recording (Phase 6)
        .service(clinical_endpoints::end_telehealth_session)
        .service(clinical_endpoints::submit_device_check)
        .service(clinical_endpoints::get_patient_telehealth_sessions)
        .service(clinical_endpoints::telehealth_join_redirect) // GET /…/join/{id} 302 in-app (Phase 4)
        .service(clinical_endpoints::telehealth_join_qr) // GET /…/{id}/qr  in-app QR (Phase 4)
        // Phase 27: Clinical Decision Support endpoints
        .service(clinical_endpoints::create_cds_alert)
        .service(clinical_endpoints::get_cds_alerts)
        .service(clinical_endpoints::get_cds_alert)
        .service(clinical_endpoints::respond_to_cds_alert)
        .service(clinical_endpoints::get_patient_cds_alerts)
        // Phase 28: Lab Result Trending endpoints
        .service(clinical_endpoints::get_lab_trends)
        .service(clinical_endpoints::analyze_lab_trends)
        .service(clinical_endpoints::get_lab_trend_result)
        // Phase 29: E-Prescription with Signing endpoints
        .service(clinical_endpoints::create_esignature_prescription)
        .service(clinical_endpoints::sign_e_prescription)
        .service(clinical_endpoints::transmit_e_prescription)
        .service(clinical_endpoints::get_esignature_prescription)
        .service(clinical_endpoints::get_patient_e_prescriptions)
        // Phase 30: Insurance Claim Integration endpoints
        .service(clinical_endpoints::create_insurance_claim)
        .service(clinical_endpoints::submit_insurance_claim)
        .service(clinical_endpoints::get_insurance_claim)
        .service(clinical_endpoints::get_patient_insurance_claims)
        .service(clinical_endpoints::check_insurance_eligibility)
        // Phase 31: Analytics Dashboard endpoints
        .service(clinical_endpoints::get_dashboard_metrics)
        .service(clinical_endpoints::get_patient_analytics)
        .service(clinical_endpoints::get_appointment_analytics)
        .service(clinical_endpoints::get_quality_metrics)
        // Phase 32: Multi-language Support endpoints
        .service(clinical_endpoints::get_supported_languages)
        .service(clinical_endpoints::set_language_preference)
        .service(clinical_endpoints::get_language_preference)
        .service(clinical_endpoints::translate_content)
        // Phase 33: Offline Mode Sync endpoints
        .service(clinical_endpoints::get_sync_status)
        .service(clinical_endpoints::register_sync_device)
        .service(clinical_endpoints::perform_sync)
        .service(clinical_endpoints::get_sync_conflicts)
        .service(clinical_endpoints::resolve_sync_conflict)
        .service(clinical_endpoints::get_sync_queue)
        .service(clinical_endpoints::download_offline_data)
        // Phase 34: List/Queue endpoints for frontend
        .service(clinical_endpoints::list_orders)
        .service(clinical_endpoints::list_discharges)
        .service(clinical_endpoints::approve_discharge)
        .service(clinical_endpoints::list_mar)
        .service(clinical_endpoints::administer_medication)
        .service(clinical_endpoints::list_io)
        .service(clinical_endpoints::record_fluid)
        .service(clinical_endpoints::list_care_plans)
        // Phase 35: Additional list endpoints for frontend pages
        .service(clinical_endpoints::list_chain_of_custody)
        .service(clinical_endpoints::list_lab_qc)
        .service(clinical_endpoints::list_critical_values)
        .service(clinical_endpoints::list_radiology_orders)
        .service(clinical_endpoints::list_pathology)
        .service(clinical_endpoints::list_immunizations)
        .service(clinical_endpoints::list_blood_bank)
        .service(clinical_endpoints::list_autopsy)
        .service(clinical_endpoints::list_consults)
        .service(clinical_endpoints::list_cds_alerts)
        // Additional frontend-compatible endpoints
        .service(clinical_endpoints::record_vital_signs)
        .service(clinical_endpoints::list_progress_notes)
        .service(clinical_endpoints::list_incident_reports)
        .service(clinical_endpoints::list_intake_output)
        .service(clinical_endpoints::list_ama_discharges)
        // SSE push-notification endpoint
        .service(crate::websocket::sse_events)
        // Item 5: National ID verification
        .service(verify_national_id);
}
