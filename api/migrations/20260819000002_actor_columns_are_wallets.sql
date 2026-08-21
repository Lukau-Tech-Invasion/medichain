-- Wallet addresses are the canonical caller identity throughout this API; they
-- are SS58 strings, not UUIDs. Every clinical table below constrained its actor
-- column to `users.id` (a UUID), so on PostgreSQL every real submission failed
-- with, for example:
--
--     column "assessed_by" is of type uuid but expression is of type text
--
-- Each such feature could be exercised against the in-memory backend and looked
-- correct, then silently refused to save once PostgreSQL was enabled — exactly
-- the drift the in-memory backend hides. This generalises the fix already applied
-- to vital_signs and progress_notes (20260814000002), appointments
-- (20260814000001) and history_physicals (20260819000001) to the remaining 35
-- clinical tables.
--
-- The table/column list is derived from the schema itself: every column with a
-- FOREIGN KEY to users(id) whose type is uuid.
--
-- Seven reporting views join users on these columns, so they are dropped first
-- and recreated afterwards against `users.wallet_address` — the join
-- `v_pending_radiology` already used. They are also recreated as LEFT JOINs: an
-- INNER JOIN silently hides a clinical record whose author is not a registered
-- user row, which for a wound-care or pending-orders alert list is a safety
-- problem rather than a tidy filter.

--
-- Deliberately NOT converted: sessions.user_id and user_profiles.user_id. Those
-- are account-linkage foreign keys that correctly reference users.id (a UUID);
-- only the clinical ACTOR columns carry wallet addresses. Converting them broke
-- v_active_users with `operator does not exist: uuid = character varying`.

-- ---------------------------------------------------------------- drop views

DROP VIEW IF EXISTS v_healthcare_providers;
DROP VIEW IF EXISTS v_active_users;
DROP VIEW IF EXISTS v_blood_products_status;
DROP VIEW IF EXISTS v_mci_active;
DROP VIEW IF EXISTS v_transfusion_reactions;
DROP VIEW IF EXISTS v_active_nursing_care_plans;
DROP VIEW IF EXISTS v_controlled_substances;
DROP VIEW IF EXISTS v_high_fall_risk_patients;
DROP VIEW IF EXISTS v_high_risk_patients;
DROP VIEW IF EXISTS v_pending_labs;
DROP VIEW IF EXISTS v_pending_orders;
DROP VIEW IF EXISTS v_wound_care_alerts;

-- ------------------------------------------------------- convert actor columns
-- ama_discharges: attending_physician_id
ALTER TABLE ama_discharges DROP CONSTRAINT IF EXISTS ama_discharges_attending_physician_id_fkey;
ALTER TABLE ama_discharges ALTER COLUMN attending_physician_id TYPE VARCHAR(66) USING attending_physician_id::text;

-- blood_type_screens: performed_by, verified_by
ALTER TABLE blood_type_screens DROP CONSTRAINT IF EXISTS blood_type_screens_performed_by_fkey;
ALTER TABLE blood_type_screens DROP CONSTRAINT IF EXISTS blood_type_screens_verified_by_fkey;
ALTER TABLE blood_type_screens ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;
ALTER TABLE blood_type_screens ALTER COLUMN verified_by TYPE VARCHAR(66) USING verified_by::text;

-- burn_assessments: assessed_by
ALTER TABLE burn_assessments DROP CONSTRAINT IF EXISTS burn_assessments_assessed_by_fkey;
ALTER TABLE burn_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- cardiac_events: performed_by
ALTER TABLE cardiac_events DROP CONSTRAINT IF EXISTS cardiac_events_performed_by_fkey;
ALTER TABLE cardiac_events ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;

-- consultation_notes: consulting_provider, requesting_provider
ALTER TABLE consultation_notes DROP CONSTRAINT IF EXISTS consultation_notes_consulting_provider_fkey;
ALTER TABLE consultation_notes DROP CONSTRAINT IF EXISTS consultation_notes_requesting_provider_fkey;
ALTER TABLE consultation_notes ALTER COLUMN consulting_provider TYPE VARCHAR(66) USING consulting_provider::text;
ALTER TABLE consultation_notes ALTER COLUMN requesting_provider TYPE VARCHAR(66) USING requesting_provider::text;

-- crossmatch_records: issued_to, performed_by, verified_by
ALTER TABLE crossmatch_records DROP CONSTRAINT IF EXISTS crossmatch_records_issued_to_fkey;
ALTER TABLE crossmatch_records DROP CONSTRAINT IF EXISTS crossmatch_records_performed_by_fkey;
ALTER TABLE crossmatch_records DROP CONSTRAINT IF EXISTS crossmatch_records_verified_by_fkey;
ALTER TABLE crossmatch_records ALTER COLUMN issued_to TYPE VARCHAR(66) USING issued_to::text;
ALTER TABLE crossmatch_records ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;
ALTER TABLE crossmatch_records ALTER COLUMN verified_by TYPE VARCHAR(66) USING verified_by::text;

-- discharge_instructions: provided_by
ALTER TABLE discharge_instructions DROP CONSTRAINT IF EXISTS discharge_instructions_provided_by_fkey;
ALTER TABLE discharge_instructions ALTER COLUMN provided_by TYPE VARCHAR(66) USING provided_by::text;

-- discharge_summaries: addendum_by, attending_physician_id, dictated_by, signed_by
ALTER TABLE discharge_summaries DROP CONSTRAINT IF EXISTS discharge_summaries_addendum_by_fkey;
ALTER TABLE discharge_summaries DROP CONSTRAINT IF EXISTS discharge_summaries_attending_physician_id_fkey;
ALTER TABLE discharge_summaries DROP CONSTRAINT IF EXISTS discharge_summaries_dictated_by_fkey;
ALTER TABLE discharge_summaries DROP CONSTRAINT IF EXISTS discharge_summaries_signed_by_fkey;
ALTER TABLE discharge_summaries ALTER COLUMN addendum_by TYPE VARCHAR(66) USING addendum_by::text;
ALTER TABLE discharge_summaries ALTER COLUMN attending_physician_id TYPE VARCHAR(66) USING attending_physician_id::text;
ALTER TABLE discharge_summaries ALTER COLUMN dictated_by TYPE VARCHAR(66) USING dictated_by::text;
ALTER TABLE discharge_summaries ALTER COLUMN signed_by TYPE VARCHAR(66) USING signed_by::text;

-- drug_interactions: acknowledged_by
ALTER TABLE drug_interactions DROP CONSTRAINT IF EXISTS drug_interactions_acknowledged_by_fkey;
ALTER TABLE drug_interactions ALTER COLUMN acknowledged_by TYPE VARCHAR(66) USING acknowledged_by::text;

-- e_prescriptions: prescriber_id
ALTER TABLE e_prescriptions DROP CONSTRAINT IF EXISTS e_prescriptions_prescriber_id_fkey;
ALTER TABLE e_prescriptions ALTER COLUMN prescriber_id TYPE VARCHAR(66) USING prescriber_id::text;

-- ems_handoffs: receiving_provider_id, report_received_by
ALTER TABLE ems_handoffs DROP CONSTRAINT IF EXISTS ems_handoffs_receiving_provider_id_fkey;
ALTER TABLE ems_handoffs DROP CONSTRAINT IF EXISTS ems_handoffs_report_received_by_fkey;
ALTER TABLE ems_handoffs ALTER COLUMN receiving_provider_id TYPE VARCHAR(66) USING receiving_provider_id::text;
ALTER TABLE ems_handoffs ALTER COLUMN report_received_by TYPE VARCHAR(66) USING report_received_by::text;

-- fall_risk_assessments: assessed_by
ALTER TABLE fall_risk_assessments DROP CONSTRAINT IF EXISTS fall_risk_assessments_assessed_by_fkey;
ALTER TABLE fall_risk_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- gcs_assessments: assessed_by
ALTER TABLE gcs_assessments DROP CONSTRAINT IF EXISTS gcs_assessments_assessed_by_fkey;
ALTER TABLE gcs_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- incident_reports: follow_up_assigned_to, patient_notified_by, reporter_id, reviewed_by
ALTER TABLE incident_reports DROP CONSTRAINT IF EXISTS incident_reports_follow_up_assigned_to_fkey;
ALTER TABLE incident_reports DROP CONSTRAINT IF EXISTS incident_reports_patient_notified_by_fkey;
ALTER TABLE incident_reports DROP CONSTRAINT IF EXISTS incident_reports_reporter_id_fkey;
ALTER TABLE incident_reports DROP CONSTRAINT IF EXISTS incident_reports_reviewed_by_fkey;
ALTER TABLE incident_reports ALTER COLUMN follow_up_assigned_to TYPE VARCHAR(66) USING follow_up_assigned_to::text;
ALTER TABLE incident_reports ALTER COLUMN patient_notified_by TYPE VARCHAR(66) USING patient_notified_by::text;
ALTER TABLE incident_reports ALTER COLUMN reporter_id TYPE VARCHAR(66) USING reporter_id::text;
ALTER TABLE incident_reports ALTER COLUMN reviewed_by TYPE VARCHAR(66) USING reviewed_by::text;

-- intubation_records: assistant_id, intubator_id
ALTER TABLE intubation_records DROP CONSTRAINT IF EXISTS intubation_records_assistant_id_fkey;
ALTER TABLE intubation_records DROP CONSTRAINT IF EXISTS intubation_records_intubator_id_fkey;
ALTER TABLE intubation_records ALTER COLUMN assistant_id TYPE VARCHAR(66) USING assistant_id::text;
ALTER TABLE intubation_records ALTER COLUMN intubator_id TYPE VARCHAR(66) USING intubator_id::text;

-- iv_assessments: assessed_by
ALTER TABLE iv_assessments DROP CONSTRAINT IF EXISTS iv_assessments_assessed_by_fkey;
ALTER TABLE iv_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- lab_panels: technician_id, verified_by
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS lab_panels_technician_id_fkey;
ALTER TABLE lab_panels DROP CONSTRAINT IF EXISTS lab_panels_verified_by_fkey;
ALTER TABLE lab_panels ALTER COLUMN technician_id TYPE VARCHAR(66) USING technician_id::text;
ALTER TABLE lab_panels ALTER COLUMN verified_by TYPE VARCHAR(66) USING verified_by::text;

-- lab_qc_records: performed_by, reviewed_by
ALTER TABLE lab_qc_records DROP CONSTRAINT IF EXISTS lab_qc_records_performed_by_fkey;
ALTER TABLE lab_qc_records DROP CONSTRAINT IF EXISTS lab_qc_records_reviewed_by_fkey;
ALTER TABLE lab_qc_records ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;
ALTER TABLE lab_qc_records ALTER COLUMN reviewed_by TYPE VARCHAR(66) USING reviewed_by::text;

-- lab_submissions: ordering_provider_id
ALTER TABLE lab_submissions DROP CONSTRAINT IF EXISTS lab_submissions_ordering_provider_id_fkey;
ALTER TABLE lab_submissions ALTER COLUMN ordering_provider_id TYPE VARCHAR(66) USING ordering_provider_id::text;

-- laceration_repairs: performed_by
ALTER TABLE laceration_repairs DROP CONSTRAINT IF EXISTS laceration_repairs_performed_by_fkey;
ALTER TABLE laceration_repairs ALTER COLUMN performed_by TYPE VARCHAR(66) USING performed_by::text;

-- mci_records: created_by
ALTER TABLE mci_records DROP CONSTRAINT IF EXISTS mci_records_created_by_fkey;
ALTER TABLE mci_records ALTER COLUMN created_by TYPE VARCHAR(66) USING created_by::text;

-- nursing_care_plans: created_by, updated_by
ALTER TABLE nursing_care_plans DROP CONSTRAINT IF EXISTS nursing_care_plans_created_by_fkey;
ALTER TABLE nursing_care_plans DROP CONSTRAINT IF EXISTS nursing_care_plans_updated_by_fkey;
ALTER TABLE nursing_care_plans ALTER COLUMN created_by TYPE VARCHAR(66) USING created_by::text;
ALTER TABLE nursing_care_plans ALTER COLUMN updated_by TYPE VARCHAR(66) USING updated_by::text;

-- obstetric_emergencies: assessed_by, ob_physician_id
ALTER TABLE obstetric_emergencies DROP CONSTRAINT IF EXISTS obstetric_emergencies_assessed_by_fkey;
ALTER TABLE obstetric_emergencies DROP CONSTRAINT IF EXISTS obstetric_emergencies_ob_physician_id_fkey;
ALTER TABLE obstetric_emergencies ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;
ALTER TABLE obstetric_emergencies ALTER COLUMN ob_physician_id TYPE VARCHAR(66) USING ob_physician_id::text;

-- pediatric_assessments: assessed_by
ALTER TABLE pediatric_assessments DROP CONSTRAINT IF EXISTS pediatric_assessments_assessed_by_fkey;
ALTER TABLE pediatric_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- physician_orders: cosigned_by, discontinued_by, executed_by, ordering_provider_id, verified_by
ALTER TABLE physician_orders DROP CONSTRAINT IF EXISTS physician_orders_cosigned_by_fkey;
ALTER TABLE physician_orders DROP CONSTRAINT IF EXISTS physician_orders_discontinued_by_fkey;
ALTER TABLE physician_orders DROP CONSTRAINT IF EXISTS physician_orders_executed_by_fkey;
ALTER TABLE physician_orders DROP CONSTRAINT IF EXISTS physician_orders_ordering_provider_id_fkey;
ALTER TABLE physician_orders DROP CONSTRAINT IF EXISTS physician_orders_verified_by_fkey;
ALTER TABLE physician_orders ALTER COLUMN cosigned_by TYPE VARCHAR(66) USING cosigned_by::text;
ALTER TABLE physician_orders ALTER COLUMN discontinued_by TYPE VARCHAR(66) USING discontinued_by::text;
ALTER TABLE physician_orders ALTER COLUMN executed_by TYPE VARCHAR(66) USING executed_by::text;
ALTER TABLE physician_orders ALTER COLUMN ordering_provider_id TYPE VARCHAR(66) USING ordering_provider_id::text;
ALTER TABLE physician_orders ALTER COLUMN verified_by TYPE VARCHAR(66) USING verified_by::text;

-- psychiatric_assessments: assessed_by, psychiatrist_id
ALTER TABLE psychiatric_assessments DROP CONSTRAINT IF EXISTS psychiatric_assessments_assessed_by_fkey;
ALTER TABLE psychiatric_assessments DROP CONSTRAINT IF EXISTS psychiatric_assessments_psychiatrist_id_fkey;
ALTER TABLE psychiatric_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;
ALTER TABLE psychiatric_assessments ALTER COLUMN psychiatrist_id TYPE VARCHAR(66) USING psychiatrist_id::text;

-- sample_histories: collected_by
ALTER TABLE sample_histories DROP CONSTRAINT IF EXISTS sample_histories_collected_by_fkey;
ALTER TABLE sample_histories ALTER COLUMN collected_by TYPE VARCHAR(66) USING collected_by::text;

-- specimen_collections: collector_id, received_by
ALTER TABLE specimen_collections DROP CONSTRAINT IF EXISTS specimen_collections_collector_id_fkey;
ALTER TABLE specimen_collections DROP CONSTRAINT IF EXISTS specimen_collections_received_by_fkey;
ALTER TABLE specimen_collections ALTER COLUMN collector_id TYPE VARCHAR(66) USING collector_id::text;
ALTER TABLE specimen_collections ALTER COLUMN received_by TYPE VARCHAR(66) USING received_by::text;

-- specimen_rejections: rejected_by
ALTER TABLE specimen_rejections DROP CONSTRAINT IF EXISTS specimen_rejections_rejected_by_fkey;
ALTER TABLE specimen_rejections ALTER COLUMN rejected_by TYPE VARCHAR(66) USING rejected_by::text;

-- splint_cast_records: applied_by
ALTER TABLE splint_cast_records DROP CONSTRAINT IF EXISTS splint_cast_records_applied_by_fkey;
ALTER TABLE splint_cast_records ALTER COLUMN applied_by TYPE VARCHAR(66) USING applied_by::text;

-- toxicology_assessments: assessed_by
ALTER TABLE toxicology_assessments DROP CONSTRAINT IF EXISTS toxicology_assessments_assessed_by_fkey;
ALTER TABLE toxicology_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- transfusion_records: administering_nurse_id, ordering_provider_id, verifying_nurse_id
ALTER TABLE transfusion_records DROP CONSTRAINT IF EXISTS transfusion_records_administering_nurse_id_fkey;
ALTER TABLE transfusion_records DROP CONSTRAINT IF EXISTS transfusion_records_ordering_provider_id_fkey;
ALTER TABLE transfusion_records DROP CONSTRAINT IF EXISTS transfusion_records_verifying_nurse_id_fkey;
ALTER TABLE transfusion_records ALTER COLUMN administering_nurse_id TYPE VARCHAR(66) USING administering_nurse_id::text;
ALTER TABLE transfusion_records ALTER COLUMN ordering_provider_id TYPE VARCHAR(66) USING ordering_provider_id::text;
ALTER TABLE transfusion_records ALTER COLUMN verifying_nurse_id TYPE VARCHAR(66) USING verifying_nurse_id::text;

-- wound_assessments: assessed_by
ALTER TABLE wound_assessments DROP CONSTRAINT IF EXISTS wound_assessments_assessed_by_fkey;
ALTER TABLE wound_assessments ALTER COLUMN assessed_by TYPE VARCHAR(66) USING assessed_by::text;

-- ------------------------------------------------------------- recreate views

CREATE VIEW v_active_nursing_care_plans AS
 SELECT ncp.patient_id, p.health_id, ncp.plan_name, ncp.care_level, ncp.status,
        ncp.start_date, ncp.target_end_date, u.name AS created_by_name, ncp.created_at
   FROM nursing_care_plans ncp
   JOIN patients p ON ncp.patient_id::text = p.id::text
   LEFT JOIN users u ON ncp.created_by::text = u.wallet_address::text
  WHERE ncp.status::text = 'active'::text AND ncp.is_active = true
  ORDER BY ncp.start_date DESC;

CREATE VIEW v_controlled_substances AS
 SELECT ep.id, ep.patient_id, p.health_id, ep.medication_name, ep.schedule, ep.quantity,
        ep.refills_authorized, ep.refills_remaining, ep.prescriber_id,
        u.name AS prescriber_name, ep.created_at, ep.status
   FROM e_prescriptions ep
   JOIN patients p ON ep.patient_id::text = p.id::text
   LEFT JOIN users u ON ep.prescriber_id::text = u.wallet_address::text
  WHERE ep.is_controlled = true
  ORDER BY ep.created_at DESC;

CREATE VIEW v_high_fall_risk_patients AS
 SELECT fra.patient_id, p.health_id, fra.total_score, fra.risk_level, fra.assessed_at,
        fra.next_assessment_due, u.name AS assessed_by_name, fra.interventions
   FROM fall_risk_assessments fra
   JOIN patients p ON fra.patient_id::text = p.id::text
   LEFT JOIN users u ON fra.assessed_by::text = u.wallet_address::text
  WHERE (fra.risk_level::text = ANY (ARRAY['moderate'::character varying, 'high'::character varying]::text[]))
    AND fra.assessed_at = (SELECT max(fra2.assessed_at) FROM fall_risk_assessments fra2
                            WHERE fra2.patient_id::text = fra.patient_id::text)
  ORDER BY fra.total_score DESC;

CREATE VIEW v_high_risk_patients AS
 SELECT p.id AS patient_id, p.health_id, 'psychiatric'::text AS risk_type, pa.risk_level,
        pa.assessment_datetime AS last_assessment, pa.assessed_by
   FROM patients p
   JOIN psychiatric_assessments pa ON p.id::text = pa.patient_id::text
  WHERE (pa.risk_level::text = ANY (ARRAY['high'::character varying, 'imminent'::character varying]::text[]))
    AND pa.assessment_datetime = (SELECT max(psychiatric_assessments.assessment_datetime)
                                    FROM psychiatric_assessments
                                   WHERE psychiatric_assessments.patient_id::text = p.id::text)
UNION ALL
 SELECT p.id AS patient_id, p.health_id, 'burn'::text AS risk_type,
        CASE WHEN ba.tbsa_percentage >= 20::numeric THEN 'high'::text ELSE 'moderate'::text END AS risk_level,
        ba.assessment_datetime AS last_assessment, ba.assessed_by
   FROM patients p
   JOIN burn_assessments ba ON p.id::text = ba.patient_id::text
  WHERE ba.tbsa_percentage >= 10::numeric
    AND ba.assessment_datetime = (SELECT max(burn_assessments.assessment_datetime)
                                    FROM burn_assessments
                                   WHERE burn_assessments.patient_id::text = p.id::text);

CREATE VIEW v_pending_labs AS
 SELECT ls.id, ls.patient_id, p.health_id, ls.priority, ls.status, ls.order_date,
        ls.expected_completion, u.name AS ordering_provider,
        jsonb_array_length(ls.tests_ordered) AS test_count,
        CASE WHEN ls.priority::text = 'stat'::text THEN 1
             WHEN ls.priority::text = 'asap'::text THEN 2
             WHEN ls.priority::text = 'urgent'::text THEN 3
             ELSE 4 END AS priority_order
   FROM lab_submissions ls
   JOIN patients p ON ls.patient_id::text = p.id::text
   LEFT JOIN users u ON ls.ordering_provider_id::text = u.wallet_address::text
  WHERE ls.status::text = ANY (ARRAY['pending'::character varying, 'collected'::character varying, 'in_progress'::character varying]::text[])
  ORDER BY (CASE WHEN ls.priority::text = 'stat'::text THEN 1
                 WHEN ls.priority::text = 'asap'::text THEN 2
                 WHEN ls.priority::text = 'urgent'::text THEN 3
                 ELSE 4 END), ls.order_date;

CREATE VIEW v_pending_orders AS
 SELECT po.id, po.patient_id, p.health_id, po.ordering_provider_id,
        u.name AS ordering_provider, po.order_type, po.priority, po.order_datetime,
        po.order_details,
        EXTRACT(epoch FROM now() - po.order_datetime) / 3600::numeric AS hours_pending
   FROM physician_orders po
   JOIN patients p ON po.patient_id::text = p.id::text
   LEFT JOIN users u ON po.ordering_provider_id::text = u.wallet_address::text
  WHERE po.status::text = 'pending'::text
  ORDER BY (CASE po.priority WHEN 'stat'::text THEN 1
                             WHEN 'asap'::text THEN 2
                             WHEN 'urgent'::text THEN 3
                             ELSE 4 END), po.order_datetime;

CREATE VIEW v_wound_care_alerts AS
 SELECT wa.patient_id, p.health_id, wa.wound_id, wa.wound_location, wa.wound_type,
        wa.drainage_amount, wa.pain_level, wa.assessed_at, wa.notes,
        u.name AS assessed_by_name
   FROM wound_assessments wa
   JOIN patients p ON wa.patient_id::text = p.id::text
   LEFT JOIN users u ON wa.assessed_by::text = u.wallet_address::text
  WHERE ((wa.drainage_amount::text = ANY (ARRAY['moderate'::character varying, 'heavy'::character varying]::text[]))
         OR wa.pain_level >= 7
         OR wa.periwound_condition::text <> 'intact'::text)
    AND wa.assessed_at >= (now() - '24:00:00'::interval)
  ORDER BY wa.assessed_at DESC;

CREATE VIEW v_active_users AS
 SELECT u.id, u.wallet_address, u.email, u.role, u.name, u.username, u.is_active,
        u.created_at, u.last_login_at, u.login_count,
        p.first_name, p.last_name, p.specialty, p.department, p.phone, p.license_number
   FROM users u
   LEFT JOIN user_profiles p ON u.id = p.user_id
  WHERE u.is_active = true;

CREATE VIEW v_blood_products_status AS
 SELECT product_type, product_abo, product_rh,
        count(*) FILTER (WHERE result::text = 'compatible'::text AND issued_at IS NULL AND returned_at IS NULL) AS reserved_count,
        count(*) FILTER (WHERE issued_at IS NOT NULL AND returned_at IS NULL) AS issued_count,
        min(expiration_date) AS earliest_expiration
   FROM crossmatch_records cr
  WHERE reserved_until > now() OR issued_at IS NOT NULL
  GROUP BY product_type, product_abo, product_rh
  ORDER BY product_type, product_abo, product_rh;

CREATE VIEW v_mci_active AS
 SELECT incident_id, incident_name, incident_datetime, incident_type, activation_level,
        count(DISTINCT patient_id) AS patient_count,
        sum(CASE WHEN triage_category::text = 'red'::text THEN 1 ELSE 0 END) AS red_count,
        sum(CASE WHEN triage_category::text = 'yellow'::text THEN 1 ELSE 0 END) AS yellow_count,
        sum(CASE WHEN triage_category::text = 'green'::text THEN 1 ELSE 0 END) AS green_count,
        sum(CASE WHEN triage_category::text = 'black'::text THEN 1 ELSE 0 END) AS black_count
   FROM mci_records
  WHERE activation_level::text <> 'deactivated'::text
  GROUP BY incident_id, incident_name, incident_datetime, incident_type, activation_level
  ORDER BY incident_datetime DESC;

CREATE VIEW v_transfusion_reactions AS
 SELECT tr.id, tr.patient_id, p.health_id, tr.product_type, tr.unit_number,
        tr.reaction_type, tr.reaction_severity, tr.reaction_time, tr.start_time,
        tr.reaction_symptoms, tr.reaction_interventions
   FROM transfusion_records tr
   JOIN patients p ON tr.patient_id::text = p.id::text
  WHERE tr.reaction_occurred = true
  ORDER BY tr.reaction_time DESC;

CREATE VIEW v_healthcare_providers AS
 SELECT id, wallet_address, email, role, name, username, is_active, created_at,
        last_login_at, login_count, first_name, last_name, specialty, department,
        phone, license_number
   FROM v_active_users
  WHERE role::text = ANY (ARRAY['Doctor'::character varying, 'Nurse'::character varying, 'LabTechnician'::character varying, 'Pharmacist'::character varying]::text[]);
