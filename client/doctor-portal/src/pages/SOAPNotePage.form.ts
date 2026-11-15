/**
 * The SOAP note form: what the clinician has typed, how each control changes
 * it, and the request body it becomes. Pure: nothing here renders, fetches or
 * reads the clock, so each rule can be tested without mounting the page.
 */

export interface PhysicalExamFinding {
  system: string;
  findings: string;
  is_normal: boolean;
}

export type DiagnosisStatus = 'confirmed' | 'provisional' | 'rule-out';

export interface DiagnosisEntry {
  description: string;
  icd10_code?: string;
  status: DiagnosisStatus;
}

export interface PrescriptionEntry {
  medication: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity?: number;
  refills?: number;
  instructions?: string;
}

export interface CreateSOAPNoteRequest {
  patient_id: string;
  encounter_type: string;
  subjective: {
    chief_complaint: string;
    history_of_present_illness: string;
    symptoms: string[];
    social_history?: string;
    family_history?: string;
    symptom_duration?: string;
    review_of_systems?: string;
    modifying_factors?: string;
    previous_treatments?: string;
  };
  objective: {
    vital_signs?: null;
    general_appearance?: string;
    physical_exam: PhysicalExamFinding[];
    lab_results: string[];
    imaging_results: string[];
    diagnostic_tests: string[];
  };
  assessment: {
    primary_diagnosis?: DiagnosisEntry;
    secondary_diagnoses: DiagnosisEntry[];
    clinical_summary: string;
    severity?: string;
    prognosis?: string;
  };
  plan: {
    treatment_plan: string;
    medications: PrescriptionEntry[];
    procedures: string[];
    lab_orders: string[];
    imaging_orders: string[];
    referrals: string[];
    patient_education: string[];
    follow_up?: string;
    return_precautions: string[];
    activity_restrictions?: string;
  };
}

/** Everything the clinician enters. The patient is chosen outside the note. */
export interface SoapForm {
  encounterType: string;
  // Subjective
  chiefComplaint: string;
  hpi: string;
  symptoms: string;
  symptomDuration: string;
  reviewOfSystems: string;
  modifyingFactors: string;
  previousTreatments: string;
  // Objective
  generalAppearance: string;
  physicalExams: PhysicalExamFinding[];
  labResults: string;
  imagingResults: string;
  // Assessment
  primaryDiagnosis: string;
  primaryICD10: string;
  primaryStatus: DiagnosisStatus;
  clinicalSummary: string;
  severity: string;
  // Plan
  treatmentPlan: string;
  medications: PrescriptionEntry[];
  procedures: string;
  labOrders: string;
  imagingOrders: string;
  referrals: string;
  patientEducation: string;
  followUp: string;
  returnPrecautions: string;
  activityRestrictions: string;
}

export function emptySoapForm(): SoapForm {
  return {
    encounterType: 'initial',
    chiefComplaint: '', hpi: '', symptoms: '', symptomDuration: '',
    reviewOfSystems: '', modifyingFactors: '', previousTreatments: '',
    generalAppearance: '', physicalExams: [], labResults: '', imagingResults: '',
    primaryDiagnosis: '', primaryICD10: '', primaryStatus: 'confirmed',
    clinicalSummary: '', severity: '',
    treatmentPlan: '', medications: [], procedures: '', labOrders: '', imagingOrders: '',
    referrals: '', patientEducation: '', followUp: '', returnPrecautions: '', activityRestrictions: '',
  };
}

/** Every field, in form order. The draft keeps exactly these. */
export const SOAP_FIELDS = Object.keys(emptySoapForm()) as (keyof SoapForm)[];

/** The four free-text sections a note template can add to. */
export interface SoapSections {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export type SoapFormAction =
  | { [K in keyof SoapForm]: { type: 'set'; field: K; value: SoapForm[K] } }[keyof SoapForm]
  | { type: 'reset' }
  /** A template arriving with the page: each non-empty section replaces its field. */
  | { type: 'fillSections'; sections: Partial<SoapSections> }
  /** A template inserted into a note in progress: added to what is written, replacing nothing. */
  | { type: 'appendSections'; sections: SoapSections }
  | { type: 'addExam'; system: string }
  | { type: 'updateExam'; index: number; field: keyof PhysicalExamFinding; value: string | boolean }
  | { type: 'removeExam'; index: number }
  | { type: 'addMedication' }
  | { type: 'updateMedication'; index: number; field: keyof PrescriptionEntry; value: string | number }
  | { type: 'removeMedication'; index: number };

const SECTION_FIELD = {
  subjective: 'hpi',
  objective: 'generalAppearance',
  assessment: 'clinicalSummary',
  plan: 'treatmentPlan',
} as const satisfies Record<keyof SoapSections, keyof SoapForm>;

const appended = (current: string, text: string) =>
  text ? (current.trim() ? `${current}\n\n${text}` : text) : current;

const replacedAt = <T>(list: T[], index: number, next: (item: T) => T) =>
  list.map((item, i) => (i === index ? next(item) : item));

export function soapFormReducer(form: SoapForm, action: SoapFormAction): SoapForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'reset':
      return emptySoapForm();
    case 'fillSections': {
      const next = { ...form };
      for (const section of Object.keys(SECTION_FIELD) as (keyof SoapSections)[]) {
        const text = action.sections[section];
        if (text) next[SECTION_FIELD[section]] = text;
      }
      return next;
    }
    case 'appendSections': {
      const next = { ...form };
      for (const section of Object.keys(SECTION_FIELD) as (keyof SoapSections)[]) {
        const field = SECTION_FIELD[section];
        next[field] = appended(form[field], action.sections[section]);
      }
      return next;
    }
    case 'addExam':
      return { ...form, physicalExams: [...form.physicalExams, { system: action.system, findings: '', is_normal: true }] };
    case 'updateExam':
      return {
        ...form,
        physicalExams: replacedAt(form.physicalExams, action.index, (exam) => ({ ...exam, [action.field]: action.value })),
      };
    case 'removeExam':
      return { ...form, physicalExams: form.physicalExams.filter((_, i) => i !== action.index) };
    case 'addMedication':
      return {
        ...form,
        medications: [...form.medications, { medication: '', dosage: '', route: 'PO', frequency: '', duration: '' }],
      };
    case 'updateMedication':
      return {
        ...form,
        medications: replacedAt(form.medications, action.index, (med) => ({ ...med, [action.field]: action.value })),
      };
    case 'removeMedication':
      return { ...form, medications: form.medications.filter((_, i) => i !== action.index) };
  }
}

/** A comma-separated box as a list: trimmed, blanks dropped. */
const listOf = (text: string) => text.split(',').map((s) => s.trim()).filter((s) => s);

/** A free-text box as an optional value: absent when nothing was typed (rule 9). */
const optional = (text: string) => text.trim() || undefined;

/**
 * The request the note is filed as. Only what was entered is sent: an empty
 * optional box is absent, an examination row with no findings and a
 * medication row with no name are dropped, and a diagnosis exists only if one
 * was written.
 */
export function toSoapNoteRequest(form: SoapForm, patientId: string): CreateSOAPNoteRequest {
  const diagnosis = form.primaryDiagnosis.trim();
  return {
    patient_id: patientId,
    encounter_type: form.encounterType,
    subjective: {
      chief_complaint: form.chiefComplaint.trim(),
      history_of_present_illness: form.hpi.trim(),
      symptoms: listOf(form.symptoms),
      social_history: undefined,
      family_history: undefined,
      symptom_duration: optional(form.symptomDuration),
      review_of_systems: optional(form.reviewOfSystems),
      modifying_factors: optional(form.modifyingFactors),
      previous_treatments: optional(form.previousTreatments),
    },
    objective: {
      vital_signs: null,
      general_appearance: optional(form.generalAppearance),
      physical_exam: form.physicalExams.filter((pe) => pe.findings.trim()),
      lab_results: listOf(form.labResults),
      imaging_results: listOf(form.imagingResults),
      diagnostic_tests: [],
    },
    assessment: {
      primary_diagnosis: diagnosis
        ? { description: diagnosis, icd10_code: optional(form.primaryICD10), status: form.primaryStatus }
        : undefined,
      secondary_diagnoses: [],
      clinical_summary: form.clinicalSummary.trim(),
      severity: optional(form.severity),
      prognosis: undefined,
    },
    plan: {
      treatment_plan: form.treatmentPlan.trim(),
      medications: form.medications.filter((m) => m.medication.trim()),
      procedures: listOf(form.procedures),
      lab_orders: listOf(form.labOrders),
      imaging_orders: listOf(form.imagingOrders),
      referrals: listOf(form.referrals),
      patient_education: listOf(form.patientEducation),
      follow_up: optional(form.followUp),
      return_precautions: listOf(form.returnPrecautions),
      activity_restrictions: optional(form.activityRestrictions),
    },
  };
}
