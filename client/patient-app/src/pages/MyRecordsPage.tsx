import { useState, useEffect, useCallback, useRef } from 'react';
import { useProviderDirectory, downloadRecordContent, getPatientDocuments, getPatientEPrescriptions, getPatientGCS, getPatientLabSubmissions, getPatientRecords, getPatientTriageAssessments, getPatientVitals, getRecordsSummary, useTranslation, formatTimestamp, SealStatusBadge, Sheet } from '@medichain/shared';
import type { SealStatus } from '@medichain/shared';
import { useToastActions } from '../components/Toast';
import {
  FileText,
  Download,
  Search,
  X,
  FlaskConical,
  Image,
  Pill,
  Stethoscope,
  FileCheck,
  Syringe,
  CheckCircle,
} from 'lucide-react';
import { usePatientAuthStore } from '../store/authStore';
import { RecordDocument } from '../components/RecordDocument';
import { HealthSubnav } from '../components/HealthSubnav';
import { useWideScreen } from '../hooks/useWideScreen';

// ux-allow(no-form): the only field is a search box that filters the list as it is typed; there is nothing to submit.

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** Records newest first, in calendar-month groups; undated ones last. */
export function groupByMonth<R extends { date: string }>(records: R[]): Array<{ key: string; label: string | null; records: R[] }> {
  const groups = new Map<string, { key: string; label: string | null; records: R[] }>();
  const sorted = [...records].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  for (const record of sorted) {
    const at = Date.parse(record.date);
    const key = Number.isNaN(at) ? 'undated' : record.date.slice(0, 7);
    const label = Number.isNaN(at) ? null : MONTH_LABEL.format(new Date(at));
    if (!groups.has(key)) groups.set(key, { key, label, records: [] });
    groups.get(key)!.records.push(record);
  }
  return [...groups.values()];
}

interface MedicalRecord {
  id: string;
  type: 'lab_result' | 'imaging' | 'prescription' | 'consultation' | 'procedure' | 'discharge_summary' | 'vaccination' | 'vital_signs' | 'assessment' | 'other';
  title: string;
  description: string;
  provider: string;
  date: string;
  contentHash: string;
  metadataHash: string;
  /**
   * Where this stored document stands in the sealed audit stream, when the
   * server reported it. Only a state the server sent may produce a badge --
   * the old badge was a hard-coded `verified: true` on nearly every record type.
   */
  sealStatus?: SealStatus | null;
  // Lab result specific fields (optional)
  labResults?: Array<{
    parameter: string;
    value: string;
    unit: string;
    reference_range: string;
    flag?: string;
  }>;
  reviewedBy?: string;
}

interface SoapNoteResponse {
  notes?: Array<{
    note_id: string;
    author_id?: string;
    created_at?: number;
    assessment?: {
      /**
       * A structured diagnosis, NOT a bare string: the API returns
       * `{ description, icd10_code, status }`. Typing it as a string here is
       * what let an object reach `title.toLowerCase()` and blank the whole app.
       */
      primary_diagnosis?: { description?: string; icd10_code?: string | null; status?: string };
      clinical_summary?: string;
    };
  }>;
}

/**
 * The record's moment as a full ISO instant. Cut to the day, every record from
 * today sorted level with every other, so a note written a minute ago could sit
 * behind a page of this morning's lab results and never be seen.
 */
/** "Level3Urgent" is the server's enum name; a patient reads "Triage level 3". */
export function triageLevelLabel(level: string | null | undefined): string | null {
  if (!level) return null;
  const n = /^Level([1-5])/.exec(level)?.[1];
  return n ? `Triage level ${n}` : level;
}

function timestampDate(value?: number | string): string {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function medicalRecordType(value: string): MedicalRecord['type'] {
  const supported: MedicalRecord['type'][] = [
    'lab_result', 'imaging', 'prescription', 'consultation', 'procedure',
    'discharge_summary', 'vaccination', 'vital_signs', 'assessment', 'other',
  ];
  return supported.includes(value as MedicalRecord['type'])
    ? value as MedicalRecord['type']
    : 'other';
}

/** Use recorded procedure descriptions; fall back to the document type when none was entered. */
function procedureDescription(item: Record<string, unknown>, label: string): string {
  const captured = item.data && typeof item.data === 'object' && !Array.isArray(item.data)
    ? item.data as Record<string, unknown> : {};
  return String(item.location || item.procedure_name || item.scheduled_surgery || item.procedure_type
    || captured.procedure || captured.procedureName || item.anesthesia_type || label);
}

/**
 * My Records Page
 *
 * View clinical records and download available encrypted documents.
 * Stored documents carry their seal state (Sealing pending, Sealed, Sealed and exported).
 *
 * © 2025-2026 Lukau Invasion (Pty) Ltd. All rights reserved.
 */
export function MyRecordsPage() {
  const { t } = useTranslation();
  const { showError } = useToastActions();
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  // Sections whose read failed. What is shown is then a partial record, and
  // the patient is told so rather than left to believe it is complete.
  const [unloadedSections, setUnloadedSections] = useState<string[]>([]);
  const patient = usePatientAuthStore(state => state.patient);
  // Records name their author by user id, which is the API's identity
  // and means nothing to a patient. The directory turns it into a name, and
  // leaves an id it cannot resolve as it is rather than guessing.
  const { providerName } = useProviderDirectory(patient?.userId);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);

    if (!patient) {
      setRecords([]);
      setIsLoading(false);
      return;
    }

    const patientId = patient.healthId;

    const allRecords: MedicalRecord[] = [];
    // One failed read used to reject the whole `Promise.all`, and the catch
    // below logged it and showed an EMPTY page: a patient with forty records
    // was told they had none because, say, the GCS read was refused. Each
    // section now fails on its own and is named.
    const failed: string[] = [];
    const settle = <T,>(section: string, read: Promise<T>, empty: T): Promise<T> =>
      read.catch((error: unknown) => {
        console.error(`Failed to load ${section}:`, error);
        failed.push(section);
        return empty;
      });
    const documents = (kind: Parameters<typeof getPatientDocuments>[1]) =>
      settle(kind, getPatientDocuments(patientId, kind), {} as Record<string, unknown>);
    // Most sections come from one summary read (WP11) instead of a request
    // each. A section the server could not read is named as not loaded, the
    // same as a failed individual read, and never shown as empty.
    const summary = await getRecordsSummary(patientId).catch((error: unknown) => {
      console.error('Failed to load the records summary:', error);
      return null;
    });
    const section = (key: string): Record<string, unknown> => {
      if (!summary || summary.unavailable.includes(key) || !summary.sections[key]) {
        failed.push(key);
        return {};
      }
      return summary.sections[key];
    };

    try {
      const [
        labData,
        genericData,
        soapData,
        prescriptionData,
        triageData,
        hpData,
        progressData,
        woundData,
        vitalsData,
        dischargeData,
        imagingData,
        pathologyData,
        consultData,
        carePlanData,
        bloodData,
        procedureData,
        amaData,
        gcsData,
        emsData,
        immunizationData,
        administrationData,
        emergencyCareData,
      ] = await Promise.all([
        settle('lab', getPatientLabSubmissions(patientId), []),
        settle('documents', getPatientRecords(patientId), []),
        documents('soap'),
        settle(
          'prescriptions',
          getPatientEPrescriptions(patientId),
          { prescriptions: [] } as unknown as Awaited<ReturnType<typeof getPatientEPrescriptions>>,
        ),
        settle(
          'triage',
          getPatientTriageAssessments(patientId),
          { assessments: [] } as unknown as Awaited<ReturnType<typeof getPatientTriageAssessments>>,
        ),
        // A History & Physical, a progress note, a wound assessment and a
        // vitals reading are all written about the patient, and none of them
        // were reachable from this page before.
        section('history-physicals'),
        section('progress-notes'),
        section('wounds'),
        // Same shape as the vitals endpoint; `readings` is empty when the
        // section did not load (and it is then named as not loaded).
        { readings: [], ...section('vitals') } as unknown as Awaited<ReturnType<typeof getPatientVitals>>,
        // The document a patient physically leaves hospital with. It was
        // reachable only by an id the patient has never seen, so it could be
        // written, approved by a second clinician, stored — and never read by
        // the person it was written for.
        section('discharges'),
        // The scan the patient was sent for, waited for and worried about.
        // The report was readable only by an id they have never seen, behind a
        // clinical-staff gate that refused them even with it.
        section('imaging'),
        // Where a cancer diagnosis, a margin status and a staging live — the
        // result a patient chases hardest, and the one they were least able to
        // reach: it was keyed by an accession number they have never seen.
        section('pathology'),
        // What the specialist actually said, and what they want done next. A
        // patient told "the specialist has seen your notes" and unable to read
        // the answer is being asked to take the recommendation on trust.
        section('consults'),
        // The one clinical document written in the second person: what the
        // goals of this admission are and what the patient is expected to do.
        section('care-plans'),
        // A blood group is the single most reusable fact in a record — asked
        // in every emergency department and on every pre-operative form.
        section('blood'),
        // "What was done to me" is one question; it was split across five
        // endpoints, none of which the patient could reach.
        section('procedures'),
        // The document most likely to be cited against the patient later.
        section('ama-discharges'),
        // Neurological observations. `POST /api/clinical/gcs` and this read had
        // both existed with no caller at either end: nothing wrote a GCS
        // assessment and nothing displayed one.
        settle(
          'gcs',
          getPatientGCS(patientId),
          { assessments: [] } as unknown as Awaited<ReturnType<typeof getPatientGCS>>,
        ),
        // What the ambulance crew found and did before the hospital door.
        section('ems-handoffs'),
        section('immunizations'),
        // Each dose the ward recorded as given, held or refused. A patient
        // could be given a drug and have no way to see that it was given.
        section('medication-administrations'),
        // Resuscitation, trauma, stroke, cardiac and sepsis care. A patient who
        // was resuscitated could not see that it happened.
        section('emergency-care'),
      ]);

      const labRecords = labData.map(sub => ({
          id: sub.id,
          type: 'lab_result' as const,
          title: sub.test_name,
          description: `${sub.test_category} - ${sub.results.length} parameter(s)`,
          provider: sub.reviewed_by || sub.submitted_by,
          date: new Date(sub.reviewed_at || sub.submitted_at).toISOString(),
          contentHash: sub.content_hash || `lab-${sub.id}`,
          metadataHash: sub.metadata_hash || `meta-${sub.id}`,
          labResults: sub.results,
          reviewedBy: sub.reviewed_by,
      }));
      allRecords.push(...labRecords);

      const medRecords = (genericData as Array<{
          content_hash: string;
          metadata_hash: string;
          record_type: string;
          uploaded_at: number;
          seal_status?: SealStatus | null;
        }>).map(rec => ({
          id: rec.content_hash,
          type: medicalRecordType(rec.record_type),
          title: rec.record_type.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          description: t('records.defaultDescription'),
          provider: 'MediChain',
          date: rec.uploaded_at ? new Date(rec.uploaded_at * 1000).toISOString() : '',
          contentHash: rec.content_hash,
          metadataHash: rec.metadata_hash,
          sealStatus: rec.seal_status ?? null,
      }));
      allRecords.push(...medRecords);

      const soapRecords = ((soapData as SoapNoteResponse).notes || []).map(note => ({
        id: note.note_id,
        type: 'consultation' as const,
        title: note.assessment?.primary_diagnosis?.description || 'SOAP Consultation',
        description: note.assessment?.clinical_summary || 'Clinical consultation note',
        provider: note.author_id || 'MediChain provider',
        date: timestampDate(note.created_at),
        contentHash: `soap-${note.note_id}`,
        metadataHash: note.note_id,
      }));
      allRecords.push(...soapRecords);

      const prescriptionRecords = (prescriptionData.prescriptions ?? []).map(rx => ({
        id: rx.prescription_id,
        type: 'prescription' as const,
        title: rx.medication.name || 'Prescription',
        description: [rx.medication.strength, rx.medication.directions, rx.patient_instructions]
          .filter(Boolean).join(' — ') || 'Electronic prescription',
        provider: rx.prescriber_name || rx.prescriber_id || 'MediChain provider',
        date: timestampDate(rx.created_at),
        contentHash: `rx-${rx.prescription_id}`,
        metadataHash: rx.prescription_id,
      }));
      allRecords.push(...prescriptionRecords);

      const triageRecords = (triageData.assessments ?? []).map(assessment => ({
        id: assessment.assessment_id,
        type: 'consultation' as const,
        title: 'Triage Assessment',
        description: [assessment.chief_complaint, triageLevelLabel(assessment.esi_level)].filter(Boolean).join(' — '),
        provider: assessment.performed_by || 'MediChain provider',
        date: timestampDate(assessment.performed_at),
        contentHash: `triage-${assessment.assessment_id}`,
        metadataHash: assessment.assessment_id,
      }));
      allRecords.push(...triageRecords);

      const dischargeRecords = (((dischargeData as {
        summaries?: Array<Record<string, unknown>>;
      }).summaries) || []).map(summary => ({
        id: String(summary.id),
        type: 'discharge_summary' as const,
        title: 'Discharge summary',
        description: String(
          (typeof summary.discharge_diagnosis === 'string' ? summary.discharge_diagnosis : (summary.discharge_diagnosis as { description?: string } | null)?.description) ||
          summary.primary_diagnosis || (summary.data as Record<string, unknown> | undefined)?.primary_diagnosis || 'Summary of this admission'
        ),
        provider: String(summary.attending_physician_id || summary.created_by || (summary.data as Record<string, unknown> | undefined)?.prepared_by || 'MediChain provider'),
        date: timestampDate((summary.discharge_date || summary.discharge_datetime || summary.created_at) as string | number | undefined),
        contentHash: `discharge-${summary.id}`,
        metadataHash: String(summary.id),
      }));
      allRecords.push(...dischargeRecords);

      const dischargeInstructionRecords = (((dischargeData as {
        instructions?: Array<Record<string, unknown>>;
      }).instructions) || []).map(item => ({
        id: String(item.id),
        type: 'discharge_summary' as const,
        title: 'Discharge instructions',
        // What to do at home is the half of a discharge a patient actually
        // acts on, so it is listed as its own record rather than folded into
        // the summary.
        description: String(
          item.activity_restrictions || item.diet_instructions || 'Instructions for going home'
        ),
        provider: String(item.created_by || 'MediChain provider'),
        date: timestampDate(item.created_at as string | number | undefined),
        contentHash: `discharge-instructions-${item.id}`,
        metadataHash: String(item.id),
      }));
      allRecords.push(...dischargeInstructionRecords);

      const imagingReports = ((imagingData as {
        reports?: Array<Record<string, unknown>>;
      }).reports) || [];
      const imagingRecords = imagingReports.map(report => ({
        id: String(report.id),
        type: 'imaging' as const,
        title: String(report.study_type || report.modality || 'Imaging report'),
        // The impression is the radiologist's conclusion — the line a patient
        // reads first and the one a clinician acts on. `status` is carried
        // because a preliminary report is not a final one, and a screen that
        // cannot say which is misleading about both.
        description: String(report.impression || report.findings || 'Imaging report'),
        provider: String(report.radiologist_id || 'MediChain radiology'),
        date: timestampDate(report.report_datetime as string | number | undefined),
        contentHash: `imaging-report-${report.id}`,
        metadataHash: String(report.status || report.id),
      }));
      allRecords.push(...imagingRecords);

      // An order with no report yet is the honest answer to "what about my
      // scan?". Omitting it makes a study that has been done but not yet read
      // look identical to one that was never ordered.
      const reportedOrderIds = new Set(imagingReports.map(r => String(r.order_id)));
      const imagingOrderRecords = (((imagingData as {
        orders?: Array<Record<string, unknown>>;
      }).orders) || [])
        .filter(order => !reportedOrderIds.has(String(order.id)))
        .map(order => ({
          id: String(order.id),
          type: 'imaging' as const,
          title: String(order.study_type || order.modality || 'Imaging study'),
          description: String(order.clinical_indication || 'Requested — no report yet'),
          provider: String(order.ordering_provider_id || 'MediChain provider'),
          date: timestampDate(
            (order.scheduled_datetime ?? order.created_at) as string | number | undefined
          ),
          contentHash: `imaging-order-${order.id}`,
          metadataHash: String(order.status || order.id),
        }));
      allRecords.push(...imagingOrderRecords);

      const pathologyRecords = (((pathologyData as {
        reports?: Array<Record<string, unknown>>;
      }).reports) || []).map(report => ({
        id: String(report.id),
        type: 'lab_result' as const,
        title: `Pathology — ${String(report.specimen_type || 'specimen')}`,
        // The diagnosis is the report. Falling back to the specimen source
        // rather than to a cheerful placeholder, because "Pathology report"
        // where a diagnosis should be reads as reassurance nobody wrote.
        description: String(report.diagnosis || report.specimen_source || 'Pathology report'),
        provider: String(report.pathologist_id || 'MediChain pathology'),
        date: timestampDate(report.report_date as string | number | undefined),
        contentHash: `pathology-${report.id}`,
        metadataHash: String(report.status || report.id),
      }));
      allRecords.push(...pathologyRecords);

      const consultRecords = (((consultData as {
        consults?: Array<Record<string, unknown>>;
      }).consults) || []).map(consult => ({
        id: String(consult.id),
        type: 'consultation' as const,
        title: `${String(consult.consultation_type || 'Specialist')} consult`,
        // The recommendation is what the patient acts on; the reason is what
        // they recognise it by. Recommendation first, falling back to the
        // reason while the consult is still only a request.
        description: String(
          consult.recommendations || consult.reason_for_consultation || 'Specialist opinion'
        ),
        provider: String(consult.consulting_provider || consult.requesting_provider || 'MediChain provider'),
        date: timestampDate(
          (consult.completed_at ?? consult.requested_at) as string | number | undefined
        ),
        contentHash: `consult-${consult.id}`,
        metadataHash: String(consult.status || consult.id),
        // A consult that has been answered is a document; one still awaiting a
        // specialist is a request, and saying otherwise overstates it.
      }));
      allRecords.push(...consultRecords);

      const carePlanRecords = (((carePlanData as {
        care_plans?: Array<Record<string, unknown>>;
      }).care_plans) || []).map(plan => ({
        id: String(plan.id),
        type: 'consultation' as const,
        title: 'Nursing care plan',
        description: String(plan.plan_name || 'Plan of care for this admission'),
        provider: String(plan.created_by || 'MediChain nursing'),
        date: timestampDate(plan.created_at as string | number | undefined),
        contentHash: `care-plan-${plan.id}`,
        metadataHash: String(plan.care_level || plan.id),
      }));
      allRecords.push(...carePlanRecords);

      // Blood-bank orders and transfusions are one subject to a patient, so
      // they are read from one response and listed under one heading.
      const bloodBody = bloodData as {
        screens?: Array<Record<string, unknown>>;
        transfusions?: Array<Record<string, unknown>>;
      };
      const bloodRecords = [
        ...((bloodBody.screens) || []).map(screen => ({
          id: String(screen.id),
          type: 'lab_result' as const,
          title: 'Blood type and screen',
          description: String(
            (screen.data as Record<string, unknown> | undefined)?.indication || 'Blood group on file'
          ),
          provider: 'MediChain blood bank',
          date: timestampDate(screen.created_at as string | number | undefined),
          contentHash: `blood-screen-${screen.id}`,
          metadataHash: String(screen.id),
        })),
        ...((bloodBody.transfusions) || []).map(tx => ({
          id: String(tx.id),
          type: 'lab_result' as const,
          title: 'Transfusion',
          description: String(
            (tx.data as Record<string, unknown> | undefined)?.product || 'Blood product given'
          ),
          provider: 'MediChain blood bank',
          date: timestampDate(tx.created_at as string | number | undefined),
          contentHash: `transfusion-${tx.id}`,
          metadataHash: String(tx.id),
        })),
      ];
      allRecords.push(...bloodRecords);

      // Surgical assessments and procedures share the patient-scoped record list.
      // A patient asking what was done to
      // them does not distinguish an intubation from a splint by which
      // endpoint served it.
      const procedureBody = procedureData as Record<string, Array<Record<string, unknown>> | undefined>;
      const procedureKinds: Array<[string, string]> = [
        ['intubations', 'Intubation'],
        ['laceration_repairs', 'Wound repair'],
        ['splints_and_casts', 'Splint or cast'],
        ['burn_assessments', 'Burn assessment'],
        ['anesthesia_records', 'Anaesthesia'],
        ['pre_op_assessments', 'Pre-operative assessment'],
        ['operative_notes', 'Operative note'],
        ['post_op_notes', 'Post-operative note'],
      ];
      const procedureRecords = procedureKinds.flatMap(([key, label]) =>
        (procedureBody[key] || []).map(item => ({
          id: String(item.id),
          type: ['pre_op_assessments', 'burn_assessments'].includes(key) ? 'assessment' as const : 'procedure' as const,
          title: label,
          description: procedureDescription(item, label),
          provider: String(item.performed_by || item.assessed_by || item.surgeon_id || item.provider_id || item.anesthesiologist_id || 'MediChain provider'),
          date: timestampDate(
            (item.performed_at ?? item.assessed_at ?? item.note_date ?? item.created_at) as string | number | undefined
          ),
          contentHash: `procedure-${key}-${item.id}`,
          metadataHash: String(item.id),
        }))
      );
      allRecords.push(...procedureRecords);

      const amaRecords = (((amaData as {
        ama_discharges?: Array<Record<string, unknown>>;
      }).ama_discharges) || []).map(record => ({
        id: String(record.id),
        type: 'discharge_summary' as const,
        title: 'Discharge against medical advice',
        description: String(
          record.recommended_treatment || record.diagnosis || 'Left against medical advice'
        ),
        provider: String(record.provider || record.attending_physician_id || 'MediChain provider'),
        date: timestampDate(record.created_at as string | number | undefined),
        contentHash: `ama-${record.id}`,
        metadataHash: String(record.id),
        // The record's evidentiary value is its signatures; until they are
        // captured it is a pending document, and saying otherwise overstates it.
      }));
      allRecords.push(...amaRecords);

      const gcsRecords = (gcsData.assessments ?? []).map(assessment => ({
        id: assessment.assessment_id,
        type: 'assessment' as const,
        title: `Glasgow Coma Scale ${assessment.total_score ?? ''}`.trim(),
        // The server's interpretation, not a phrase composed here. The total
        // and its meaning are scored server-side and displayed as returned.
        description: assessment.interpretation || 'Neurological assessment',
        provider: assessment.assessed_by || 'MediChain clinician',
        date: timestampDate(assessment.assessed_at),
        contentHash: `gcs-${assessment.assessment_id}`,
        metadataHash: assessment.assessment_id,
      }));
      allRecords.push(...gcsRecords);

      const emsRecords = (((emsData as { handoffs?: Array<Record<string, unknown>> })
        .handoffs) || []).map(handoff => ({
        id: String(handoff.id),
        type: 'other' as const,
        title: `Ambulance handover${handoff.ems_agency ? ` (${handoff.ems_agency})` : ''}`,
        description: String(handoff.chief_complaint || ''),
        provider: String(handoff.ems_agency || 'Ambulance service'),
        date: timestampDate(handoff.received_at as string | undefined),
        contentHash: `ems-${handoff.id}`,
        metadataHash: String(handoff.id),
      }));
      allRecords.push(...emsRecords);

      const DOSE_STATUS: Record<string, string> = {
        given: 'Given', held: 'Held', refused: 'Refused', 'not-given': 'Not given', missed: 'Missed',
      };
      const administrationRecords = (((administrationData as { administrations?: Array<Record<string, unknown>> })
        .administrations) || []).map(dose => ({
        id: String(dose.administration_id),
        type: 'prescription' as const,
        title: `Medication ${(DOSE_STATUS[String(dose.status)] ?? 'recorded').toLowerCase()}: ${String(dose.medication_name || 'medication not named')}`,
        description: [dose.dose, dose.route, dose.reason_not_given ? `Reason: ${dose.reason_not_given}` : null]
          .filter(Boolean).join(' · '),
        provider: String(dose.administered_by || 'Nurse not recorded'),
        date: timestampDate((dose.administered_at || dose.record_date) as string | undefined),
        contentHash: `dose-${dose.administration_id}`,
        metadataHash: String(dose.administration_id),
      }));
      allRecords.push(...administrationRecords);

      const emergencyKinds: Array<[string, string, (row: Record<string, unknown>) => string]> = [
        ['code_blues', 'Resuscitation (code blue)', (row) => row.outcome ? `Outcome: ${row.outcome}` : ''],
        ['traumas', 'Trauma assessment', (row) => String(row.mechanism || '')],
        ['strokes', 'Stroke assessment', (row) => row.nihss_total != null ? `NIHSS ${row.nihss_total}` : ''],
        ['cardiac_events', 'Cardiac event', (row) => String(row.event_type || '')],
        ['sepsis_assessments', 'Sepsis screening', (row) => String(row.severity || '')],
      ];
      for (const [field, title, describe] of emergencyKinds) {
        const rows = ((emergencyCareData as Record<string, unknown>)[field] as Array<Record<string, unknown>> | undefined) || [];
        allRecords.push(...rows.map(row => ({
          id: String(row.id),
          type: 'other' as const,
          title,
          description: describe(row),
          provider: String(row.documented_by || row.assessed_by || row.created_by || 'Emergency team'),
          date: timestampDate(row.created_at as string | undefined),
          contentHash: `${field}-${row.id}`,
          metadataHash: String(row.id),
        })));
      }

      const hpRecords = (((hpData as { history_physicals?: Array<Record<string, unknown>> })
        .history_physicals) || []).map(hp => ({
        id: String(hp.id),
        type: 'consultation' as const,
        title: `History & Physical${hp.exam_type ? ` (${hp.exam_type})` : ''}`,
        description: String(hp.chief_complaint || 'Comprehensive evaluation'),
        provider: String(hp.performed_by || 'MediChain provider'),
        date: timestampDate(hp.performed_at as string | number | undefined),
        contentHash: `hp-${hp.id}`,
        metadataHash: String(hp.id),
      }));
      allRecords.push(...hpRecords);

      const progressRecords = (((progressData as { progress_notes?: Array<Record<string, unknown>> })
        .progress_notes) || []).map(note => ({
        id: String(note.id),
        type: 'consultation' as const,
        title: `Progress note${note.note_type ? ` (${note.note_type})` : ''}`,
        description: String(note.assessment || 'Clinical progress note'),
        provider: String(note.created_by || 'MediChain provider'),
        date: timestampDate(note.created_at as string | number | undefined),
        contentHash: `progress-${note.id}`,
        metadataHash: String(note.id),
      }));
      allRecords.push(...progressRecords);

      const immunizationRecords = ((immunizationData.immunizations as Array<Record<string, unknown>>) || []).map(record => ({
        id: String(record.id),
        type: 'vaccination' as const,
        title: String(record.vaccine_name || 'Vaccination'),
        description: [record.dose_number != null ? `Dose ${record.dose_number}` : null,
          record.lot_number ? `Lot ${record.lot_number}` : null].filter(Boolean).join(' · '),
        provider: String(record.administered_by_name || record.administered_by || 'Provider not recorded'),
        date: timestampDate(record.administration_date as string | undefined),
        contentHash: `immunization-${record.id}`,
        metadataHash: String(record.id),
      }));
      allRecords.push(...immunizationRecords);

      const woundRecords = (((woundData as { wounds?: Array<Record<string, unknown>> })
        .wounds) || []).map(wound => ({
        id: String(wound.id),
        type: 'consultation' as const,
        title: `Wound assessment - ${wound.wound_location || 'site not recorded'}`,
        description: String(wound.wound_type || 'Wound assessment'),
        provider: String(wound.assessed_by || 'MediChain provider'),
        date: timestampDate(wound.assessed_at as string | number | undefined),
        contentHash: `wound-${wound.id}`,
        metadataHash: String(wound.id),
      }));
      allRecords.push(...woundRecords);

      const vitalsRecords = vitalsData.readings.map(v => ({
        id: v.reading_id,
        type: 'vital_signs' as const,
        title: 'Vital signs',
        description: [
          v.heart_rate ? `HR ${v.heart_rate}` : null,
          v.systolic_bp != null && v.diastolic_bp != null
            ? `BP ${v.systolic_bp}/${v.diastolic_bp}`
            : null,
          v.temperature_celsius != null
            ? `${v.temperature_celsius.toFixed(1)} C`
            : null,
        ].filter(Boolean).join(' · ') || 'Recorded observations',
        provider: String(v.recorded_by || 'MediChain provider'),
        date: timestampDate(v.recorded_at as string | number | undefined),
        contentHash: `vitals-${v.reading_id}`,
        metadataHash: v.reading_id,
      }));
      allRecords.push(...vitalsRecords);
    } catch (error) {
      // A read that answered with a shape this page cannot map lands here.
      console.error('Failed to fetch records:', error);
      failed.push('records');
    }

    // Sort by date descending
    allRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setRecords(allRecords);
    setUnloadedSections(failed);
    setIsLoading(false);
  }, [patient, t]);

  useEffect(() => {
    loadRecords();
  }, [patient?.healthId, loadRecords]);

  const getRecordIcon = (type: string) => {
    switch (type) {
      case 'lab_result':
        return <FlaskConical className="w-5 h-5" />;
      case 'imaging':
        return <Image className="w-5 h-5" />;
      case 'prescription':
        return <Pill className="w-5 h-5" />;
      case 'consultation':
        return <Stethoscope className="w-5 h-5" />;
      case 'procedure':
        return <FileCheck className="w-5 h-5" />;
      case 'discharge_summary':
        return <FileCheck className="w-5 h-5" />;
      case 'vaccination':
        return <Syringe className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  const getRecordColor = (type: string) => {
    switch (type) {
      case 'lab_result':
        return 'bg-info-light text-info';
      case 'imaging':
        return 'bg-surface-sunken text-content-secondary';
      case 'prescription':
        return 'bg-ok-subtle text-ok-subtle-fg';
      case 'consultation':
        return 'bg-brand-subtle text-brand';
      case 'procedure':
        return 'bg-info-light text-info';
      case 'discharge_summary':
        return 'bg-caution-subtle text-caution';
      case 'vaccination':
        return 'bg-critical-subtle text-critical-subtle-fg';
      default:
        return 'bg-surface-sunken text-content-muted';
    }
  };

  const formatRecordType = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Localized label for a record type code, falling back to the formatted code.
  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      lab_result: t('records.typeLabResult'),
      imaging: t('records.typeImaging'),
      prescription: t('records.typePrescription'),
      consultation: t('records.typeConsultation'),
      procedure: t('records.typeProcedure'),
      discharge_summary: t('records.typeDischarge'),
      vaccination: t('records.typeVaccination'),
      vital_signs: t('records.typeVitalSigns'),
      assessment: t('records.typeAssessment'),
      other: t('records.typeOther'),
    };
    return map[type] || formatRecordType(type);
  };

  const formatDate = (dateString: string) => {
    return formatTimestamp(dateString, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  /**
   * The open record's contents (mockup p5). Tapping a record opens the
   * document itself -- there is no details step before it -- through the same
   * authorised download endpoint the Download button uses.
   */
  const [preview, setPreview] = useState<RecordPreview | null>(null);
  const [isViewing, setIsViewing] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const wide = useWideScreen();
  const viewRequest = useRef(0);
  useEffect(() => () => { viewRequest.current += 1; }, []);
  const previewUrl = preview?.url;
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  /** Close the reader and drop any document still on its way. */
  const closeDetails = () => {
    viewRequest.current += 1;
    setIsViewing(false);
    setPreview(null);
    setSelectedRecord(null);
  };

  const openRecord = async (record: MedicalRecord) => {
    const ticket = ++viewRequest.current;
    setSelectedRecord(record);
    setPreview(null);
    setIsViewing(true);
    try {
      const { blob, contentType } = await downloadRecordContent(record.contentHash);
      if (viewRequest.current !== ticket) return;
      if (contentType.startsWith('text/') || contentType.includes('json')) {
        const text = await blob.text();
        if (viewRequest.current === ticket) setPreview({ kind: 'text', text, contentType });
      } else if (contentType.startsWith('image/')) {
        setPreview({ kind: 'image', url: URL.createObjectURL(blob), contentType });
      } else if (contentType.includes('pdf')) {
        setPreview({ kind: 'pdf', url: URL.createObjectURL(blob), contentType });
      } else {
        // Say so rather than rendering bytes as mojibake; Download still works.
        setPreview({ kind: 'unsupported', contentType });
      }
    } catch {
      if (viewRequest.current === ticket) setPreview({ kind: 'failed', contentType: '' });
    } finally {
      if (viewRequest.current === ticket) setIsViewing(false);
    }
  };

  const handleDownload = async (record: MedicalRecord) => {
    setIsDownloading(record.id);
    try {
      let blob: Blob;
      try {
        ({ blob } = await downloadRecordContent(record.contentHash));
      } catch (error) {
        console.error('Failed to download record:', error);
        showError(t('records.downloadFailed', { title: record.title }));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.title;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading record:', error);
      showError(t('records.downloadError', { title: record.title }));
    } finally {
      setIsDownloading(null);
    }
  };

  const filteredRecords = records.filter(record => {
    const needle = searchQuery.toLowerCase();
    const hit = (value: unknown) => String(value ?? '').toLowerCase().includes(needle);
    const matchesSearch = hit(record.title) || hit(record.description) || hit(record.id) || hit(providerName(record.provider));
    const matchesFilter = filterType === 'all' || record.type === filterType;
    return matchesSearch && matchesFilter;
  });

  // Newest first, grouped by month (mockup p4): a patient looks for "the visit
  // in March", not for record number 37 of 80. A page at a time, so 75
  // records are not 12 screens of scrolling.
  const visible = byNewest(filteredRecords).slice(0, shown);
  const monthCounts = new Map(groupByMonth(filteredRecords).map((g) => [g.key, g.records.length]));
  const byMonth = groupByMonth(visible);

  const recordTypes = ['all', 'lab_result', 'imaging', 'prescription', 'consultation', 'procedure', 'discharge_summary', 'vaccination', 'vital_signs', 'assessment', 'other'];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-12 bg-surface-sunken rounded-xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-surface-sunken rounded-xl" />
        ))}
      </div>
    );
  }

  const downloadButton = (record: MedicalRecord, wideButton: boolean) => (
    <button
      type="button"
      onClick={() => void handleDownload(record)}
      aria-disabled={isDownloading === record.id || undefined}
      aria-label={wideButton ? undefined : t('records.downloadNamed', { title: record.title })}
      className={wideButton
        ? 'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-brand-fg hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus'
        : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus'}
    >
      {isDownloading === record.id
        ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-transparent" aria-hidden="true" />
        : <Download className="h-5 w-5" aria-hidden="true" />}
      {wideButton && t('records.download')}
    </button>
  );

  const reader = selectedRecord && (
    <RecordReader
      record={selectedRecord}
      preview={preview}
      loading={isViewing}
      typeLabel={typeLabel(selectedRecord.type)}
      provider={providerName(selectedRecord.provider)}
      date={formatDate(selectedRecord.date)}
      reviewer={selectedRecord.reviewedBy ? providerName(selectedRecord.reviewedBy) : null}
      onRetry={() => void openRecord(selectedRecord)}
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)] lg:gap-0">
      <aside className="hidden self-start border-r border-border p-4 lg:sticky lg:top-16 lg:block">
        <HealthSubnav />
      </aside>

      <div className="space-y-4 p-4 pb-6 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-content">{t('records.pageTitle')}</h1>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-muted" aria-hidden="true" />
            <input aria-label={t('records.search')}
              type="search"
              placeholder={t('records.search')}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShown(PAGE_SIZE); }}
              className="min-h-[44px] w-full rounded-xl border border-border-interactive bg-surface pl-12 pr-4 text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </div>
        </div>

        {unloadedSections.length > 0 && (
          <div role="alert" className="rounded-xl bg-caution-subtle text-caution-subtle-fg p-4 flex items-start justify-between gap-4">
            <p>{t('records.partialLoad')}</p>
            <button type="button" onClick={() => void loadRecords()} className="shrink-0 font-medium underline">
              {t('records.retry')}
            </button>
          </div>
        )}

        {/* Filter chips stay in reach while the list scrolls. */}
        <div className="sticky top-16 z-20 -mx-4 flex gap-2 overflow-x-auto bg-surface-sunken lg:flex-wrap lg:overflow-visible px-4 py-2 md:-mx-5 md:px-5">
          {recordTypes.map(type => (
            <button
              key={type}
              type="button"
              aria-pressed={filterType === type}
              onClick={() => { setFilterType(type); setShown(PAGE_SIZE); }}
              className={`min-h-[40px] whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                filterType === type
                  ? 'border-selected bg-selected text-selected-fg'
                  : 'border-border-interactive bg-surface text-content hover:bg-surface-sunken'
              }`}
            >
              {type === 'all' ? t('records.allRecords') : typeLabel(type)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {byMonth.map((group) => (
            <section key={group.key} aria-labelledby={`records-${group.key}`} className="space-y-2">
              <h2 id={`records-${group.key}`} className="px-1 text-sm font-semibold uppercase tracking-wide text-content-secondary">
                {t('records.monthCount', { month: group.label ?? t('records.undated'), n: String(monthCounts.get(group.key) ?? group.records.length) })}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {group.records.map(record => {
                  const open = selectedRecord?.id === record.id;
                  return (
                    <li key={record.id} className={`flex items-center gap-1 pr-2 ${open ? 'bg-selected text-selected-fg' : ''}`}>
                      <button
                        type="button"
                        onClick={() => void openRecord(record)}
                        aria-current={open ? 'true' : undefined}
                        className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${getRecordColor(record.type)}`} aria-hidden="true">
                          {getRecordIcon(record.type)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate font-semibold ${open ? '' : 'text-content'}`}>{record.title}</span>
                          <span className={`block truncate text-sm ${open ? '' : 'text-content-muted'}`}>
                            {[record.description !== record.title ? record.description : null, formatDate(record.date), providerName(record.provider)]
                              .filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                      {!wide && downloadButton(record, false)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {filteredRecords.length === 0 && (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-content-muted mx-auto mb-4" aria-hidden="true" />
              <p className="text-content-muted">{t('records.noRecords')}</p>
            </div>
          )}

          {filteredRecords.length > 0 && (
            <div className="space-y-2 text-center">
              <p className="text-sm text-content-muted">
                {t('records.tapToRead')} · {t('records.showing', { shown: String(visible.length), total: String(filteredRecords.length) })}
              </p>
              {visible.length < filteredRecords.length && (
                <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)}
                  className="min-h-[44px] rounded-xl border border-border-interactive px-5 font-semibold text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  {t('records.showMore')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Laptop: the document opens beside the list, no pop-up (mockup p6). */}
      {wide && (
        <aside aria-label={selectedRecord?.title ?? t('records.recordDetails')}
          className="sticky top-16 flex h-[calc(100dvh-4rem)] flex-col border-l border-border bg-surface">
          {selectedRecord ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <h2 className="text-xl font-bold text-content">{selectedRecord.title}</h2>
                <button type="button" onClick={closeDetails} aria-label={t('common.close')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{reader}</div>
              <div className="border-t border-border px-5 py-3">{downloadButton(selectedRecord, true)}</div>
            </>
          ) : (
            <p className="p-6 text-content-muted">{t('records.chooseRecord')}</p>
          )}
        </aside>
      )}

      {/* Phone and tablet: one sheet, never two, with Download pinned. */}
      {!wide && selectedRecord && (
        <Sheet title={selectedRecord.title} onClose={closeDetails} actions={downloadButton(selectedRecord, true)}>
          {reader}
        </Sheet>
      )}
    </div>
  );
}

type RecordPreview = {
  kind: 'text' | 'image' | 'pdf' | 'unsupported' | 'failed';
  text?: string;
  url?: string;
  contentType: string;
};

const PAGE_SIZE = 20;

/** Newest first; undated last. */
function byNewest<R extends { date: string }>(records: R[]): R[] {
  return [...records].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

/** The open record: who and when, any lab table, then the document itself. */
function RecordReader({ record, preview, loading, typeLabel, provider, date, reviewer, onRetry }: {
  record: MedicalRecord;
  preview: RecordPreview | null;
  loading: boolean;
  typeLabel: string;
  provider: string;
  date: string;
  reviewer: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-content-muted">
        <span>{[typeLabel, date, provider].filter(Boolean).join(' · ')}</span>
        {record.sealStatus && <SealStatusBadge status={record.sealStatus} />}
      </p>
      {record.description && record.description !== record.title && (
        <p className="text-content">{record.description}</p>
      )}

      {record.type === 'lab_result' && record.labResults && record.labResults.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-content-muted">{t('records.parameter')}</th>
                <th className="px-3 py-2 text-right font-medium text-content-muted">{t('records.value')}</th>
                <th className="px-3 py-2 text-right font-medium text-content-muted">{t('records.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {record.labResults.map((result, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="px-3 py-2 text-content">{result.parameter}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-medium text-content">{result.value} {result.unit}</span>
                    {result.flag && (
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        result.flag.toLowerCase() === 'normal' ? 'bg-ok-subtle text-ok-subtle-fg' :
                        result.flag.toLowerCase().startsWith('critical') ? 'bg-critical-subtle text-critical-subtle-fg' :
                        ['high', 'low'].includes(result.flag.toLowerCase()) ? 'bg-caution-subtle text-caution-subtle-fg' :
                        'bg-surface-sunken text-content-secondary'
                      }`}>{result.flag}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-content-muted">{result.reference_range}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reviewer && (
            <p className="flex items-center gap-1 border-t border-border px-3 py-2 text-xs text-content-muted">
              <CheckCircle className="h-3 w-3 text-ok-subtle-fg" aria-hidden="true" />
              {t('records.reviewedByName', { name: reviewer })}
            </p>
          )}
        </div>
      )}

      {loading && <p role="status" className="text-content-muted">{t('records.opening')}</p>}
      {preview?.kind === 'text' && preview.text && <RecordDocument text={preview.text} />}
      {preview?.kind === 'image' && <img src={preview.url} alt={record.title} className="mx-auto h-auto max-w-full" />}
      {preview?.kind === 'pdf' && <iframe src={preview.url} title={record.title} className="h-[60vh] w-full" />}
      {preview?.kind === 'unsupported' && (
        <p className="text-sm text-content-muted">{t('records.viewUnsupported', { type: preview.contentType })}</p>
      )}
      {preview?.kind === 'failed' && (
        <div role="alert" className="rounded-xl bg-caution-subtle p-3 text-sm text-caution-subtle-fg">
          <p>{t('records.viewFailed', { title: record.title })}</p>
          <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">{t('records.retry')}</button>
        </div>
      )}
    </div>
  );
}
