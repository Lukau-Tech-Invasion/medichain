/**
 * The sepsis assessment form: what the clinician has entered, how each control
 * changes it, and the request it is filed as. Pure: who ticked a bundle item
 * and when, a lactate reading's time and the protocol clock are all passed in,
 * so each rule can be tested without mounting the page or reading the clock.
 *
 * No score is computed here. qSOFA and SOFA are the server's (rule 8); this
 * module only carries the measurements they are scored from.
 */
import type { createSepsis } from '@medichain/shared';

export interface BundleItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
}

export interface LactateReading {
  timestamp: string;
  value: number;
  source: string;
}

export type SepsisClassification = 'sirs' | 'sepsis' | 'severe_sepsis' | 'septic_shock';

export interface SepsisForm {
  // qSOFA observations; null until entered.
  respiratoryRate: number | null;
  systolicBP: number | null;
  gcsScore: number | null;
  // SOFA measurements, kept as typed. An empty box is "not measured", and is
  // sent as absent: an organ nobody measured is not an organ that is working.
  pao2fio2: string;
  respiratorySupport: boolean;
  platelets: string;
  bilirubin: string;
  map: string;
  creatinine: string;
  urineOutput: string;
  noradrenaline: string;
  lactateReadings: LactateReading[];
  /** The lactate value being typed, before it is added. */
  newLactate: string;
  classification: SepsisClassification;
  hour1Bundle: BundleItem[];
  hour3Bundle: BundleItem[];
  infectionSource: string;
  suspectedOrganism: string;
  antibioticsGiven: string[];
  fluidVolume: number;
  vasopressorType: string;
  narrative: string;
}

/** The SOFA measurements that are typed numbers. */
export type SofaField = 'pao2fio2' | 'platelets' | 'bilirubin' | 'map' | 'creatinine' | 'urineOutput' | 'noradrenaline';

export function emptySepsisForm(): SepsisForm {
  return {
    respiratoryRate: null, systolicBP: null, gcsScore: null,
    pao2fio2: '', respiratorySupport: false, platelets: '', bilirubin: '', map: '',
    creatinine: '', urineOutput: '', noradrenaline: '',
    lactateReadings: [], newLactate: '',
    classification: 'sepsis',
    hour1Bundle: [
      { id: 'lactate', label: 'Measure Lactate Level', description: 'Draw initial lactate level', completed: false },
      { id: 'blood_cultures', label: 'Obtain Blood Cultures', description: 'Before antibiotics if possible', completed: false },
      { id: 'antibiotics', label: 'Administer Broad-Spectrum Antibiotics', description: 'Within 1 hour of recognition', completed: false },
      { id: 'fluids', label: 'Begin 30mL/kg Crystalloid', description: 'For hypotension or lactate ≥4', completed: false },
      { id: 'vasopressors', label: 'Apply Vasopressors', description: 'If hypotensive during/after fluid', completed: false },
    ],
    // 3-hour bundle (legacy but still tracked)
    hour3Bundle: [
      { id: 'repeat_lactate', label: 'Repeat Lactate', description: 'If initial lactate >2', completed: false },
      { id: 'reassess_volume', label: 'Reassess Volume Status', description: 'Document hemodynamic response', completed: false },
      { id: 'perfusion_check', label: 'Reassess Tissue Perfusion', description: 'Check cap refill, skin mottling', completed: false },
    ],
    infectionSource: '', suspectedOrganism: '', antibioticsGiven: [],
    fluidVolume: 0, vasopressorType: '', narrative: '',
  };
}

export type SepsisFormAction =
  | { [K in keyof SepsisForm]: { type: 'set'; field: K; value: SepsisForm[K] } }[keyof SepsisForm]
  | { type: 'toggleBundleItem'; bundle: 'hour1' | 'hour3'; id: string; at: string; by: string | undefined }
  | { type: 'addLactate'; timestamp: string };

const toggleItem = (items: BundleItem[], id: string, at: string, by: string | undefined): BundleItem[] =>
  items.map((item) => (item.id !== id ? item : {
    ...item,
    completed: !item.completed,
    completedAt: !item.completed ? at : undefined,
    completedBy: !item.completed ? by : undefined,
  }));

export function sepsisFormReducer(form: SepsisForm, action: SepsisFormAction): SepsisForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'toggleBundleItem':
      return action.bundle === 'hour1'
        ? { ...form, hour1Bundle: toggleItem(form.hour1Bundle, action.id, action.at, action.by) }
        : { ...form, hour3Bundle: toggleItem(form.hour3Bundle, action.id, action.at, action.by) };
    case 'addLactate': {
      const value = parseFloat(form.newLactate);
      if (Number.isNaN(value)) return form;
      return {
        ...form,
        lactateReadings: [...form.lactateReadings, { timestamp: action.timestamp, value, source: 'venous' }],
        newLactate: '',
      };
    }
  }
}

/** A number the clinician entered, or nothing when the box was left empty. */
export function measured(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

/**
 * The assessment as filed. Neither score is sent: qSOFA and SOFA are computed
 * by the API from these measurements.
 */
export function toSepsisRequest(
  form: SepsisForm,
  filing: { patientId: string; protocolStartTime: string | undefined; elapsedMinutes: number },
): Parameters<typeof createSepsis>[0] {
  return {
    patient_id: filing.patientId,
    severity: form.classification,
    suspected_source: form.infectionSource,
    vital_signs: {
      respiratory_rate: form.respiratoryRate,
      systolic_blood_pressure: form.systolicBP,
      glasgow_coma_scale: form.gcsScore,
      mean_arterial_pressure: measured(form.map),
    },
    sofa_inputs: {
      pao2_fio2: measured(form.pao2fio2),
      respiratory_support: form.respiratorySupport,
      platelets: measured(form.platelets),
      bilirubin_umol_l: measured(form.bilirubin),
      mean_arterial_pressure: measured(form.map),
      creatinine_umol_l: measured(form.creatinine),
      urine_output_ml_24h: measured(form.urineOutput),
      vasopressors: {
        noradrenaline_mcg_kg_min: measured(form.noradrenaline),
      },
    },
    labs: {
      lactate_readings: form.lactateReadings,
    },
    infection: {
      source: form.infectionSource,
      suspected_organism: form.suspectedOrganism,
      antibiotics: form.antibioticsGiven,
    },
    bundle_completion: {
      hour_1: form.hour1Bundle,
      hour_3: form.hour3Bundle,
      all_hour1_complete: form.hour1Bundle.every((item) => item.completed),
      all_hour3_complete: form.hour3Bundle.every((item) => item.completed),
    },
    treatment: {
      fluid_volume_ml: form.fluidVolume,
      vasopressor: form.vasopressorType,
    },
    vasopressors_required: Boolean(form.vasopressorType),
    protocol_start_time: filing.protocolStartTime,
    elapsed_minutes: filing.elapsedMinutes,
    narrative: form.narrative,
  };
}
