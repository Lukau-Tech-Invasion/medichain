/**
 * The two pathology forms: the specimen order a clinician submits and the
 * report a pathologist writes against it. Pure: the patient's name, the
 * receiving user and today's date are passed in, so each rule can be tested
 * without mounting the page or reading the clock.
 */
import type { updatePathologyReport } from '@medichain/shared';

export interface PathologySpecimen {
  specimenId: string;
  patientId: string;
  patientName: string;
  collectionDate: string;
  collectionTime: string;
  clinician: string;
  specimenType: 'surgical' | 'cytology' | 'biopsy' | 'bone-marrow' | 'autopsy';
  site: string;
  laterality: 'left' | 'right' | 'bilateral' | 'n/a';
  clinicalHistory: string;
  clinicalDiagnosis: string;
  priority: 'routine' | 'urgent' | 'stat';
  status: 'received' | 'grossing' | 'processing' | 'embedding' | 'cutting' | 'staining' | 'prelim' | 'final' | 'addendum';
  receivedDate?: string;
  receivedBy?: string;
  container: string;
  fixative: string;
  grossDescription?: string;
  blocks?: string[];
  slides?: string[];
  specialStains?: string[];
  ihcMarkers?: string[];
  microscopicDescription?: string;
  diagnosis?: string;
  snomedCode?: string;
  reportDate?: string;
  pathologist?: string;
  isCritical?: boolean;
  communicatedTo?: string;
}

// ---------------------------------------------------------------------------
// The specimen order
// ---------------------------------------------------------------------------

export interface PathologyOrderForm {
  selectedPatientId: string;
  collectionDate: string;
  collectionTime: string;
  clinician: string;
  // Nothing is pre-selected. The form used to open on "surgical, n/a, routine,
  // 10% formalin" and file all four whether or not anyone had looked at them
  // (rule 9). Type and priority must be chosen; laterality and fixative are
  // sent only when they were.
  specimenType: PathologySpecimen['specimenType'] | '';
  site: string;
  laterality: PathologySpecimen['laterality'] | '';
  clinicalHistory: string;
  clinicalDiagnosis: string;
  priority: PathologySpecimen['priority'] | '';
  container: string;
  fixative: string;
}

export function emptyPathologyOrder(): PathologyOrderForm {
  return {
    selectedPatientId: '', collectionDate: '', collectionTime: '', clinician: '',
    specimenType: '', site: '', laterality: '',
    clinicalHistory: '', clinicalDiagnosis: '', priority: '',
    container: '', fixative: '',
  };
}

export type PathologyOrderAction =
  | { [K in keyof PathologyOrderForm]: { type: 'set'; field: K; value: PathologyOrderForm[K] } }[keyof PathologyOrderForm]
  | { type: 'reset' };

export function pathologyOrderReducer(form: PathologyOrderForm, action: PathologyOrderAction): PathologyOrderForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'reset':
      return emptyPathologyOrder();
  }
}

/** What an order is submitted as: a specimen without its accession number. */
export type PathologyOrder =
  Omit<PathologySpecimen, 'specimenId' | 'specimenType' | 'laterality' | 'priority' | 'fixative'>
  & Partial<Pick<PathologySpecimen, 'specimenType' | 'laterality' | 'priority'>>
  & { fixative?: string };

/**
 * The order as submitted. It carries no accession number: the server mints
 * one and returns it. A choice nobody made is absent, not a default.
 */
export function toPathologyOrder(
  form: PathologyOrderForm,
  receipt: { patientName: string; receivedDate: string; receivedBy: string },
): PathologyOrder {
  const { selectedPatientId, specimenType, laterality, priority, fixative, ...order } = form;
  return {
    patientId: selectedPatientId,
    patientName: receipt.patientName,
    ...order,
    specimenType: specimenType || undefined,
    laterality: laterality || undefined,
    priority: priority || undefined,
    fixative: fixative || undefined,
    status: 'received',
    receivedDate: receipt.receivedDate,
    receivedBy: receipt.receivedBy,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface PathologyReportForm {
  grossDescription: string;
  blocks: string[];
  /** The block label being typed, before it is added. */
  newBlock: string;
  slides: string[];
  newSlide: string;
  specialStains: string[];
  ihcMarkers: string[];
  microscopicDescription: string;
  diagnosis: string;
  snomedCode: string;
  isCritical: boolean;
  communicatedTo: string;
}

export function emptyPathologyReport(): PathologyReportForm {
  return {
    grossDescription: '', blocks: [], newBlock: '', slides: [], newSlide: '',
    specialStains: [], ihcMarkers: [], microscopicDescription: '', diagnosis: '',
    snomedCode: '', isCritical: false, communicatedTo: '',
  };
}

export type PathologyReportAction =
  | { [K in keyof PathologyReportForm]: { type: 'set'; field: K; value: PathologyReportForm[K] } }[keyof PathologyReportForm]
  | { type: 'open'; specimen: PathologySpecimen }
  | { type: 'addBlock' }
  | { type: 'addSlide' }
  | { type: 'toggleStain'; stain: string }
  | { type: 'toggleMarker'; marker: string };

const toggled = (list: string[], item: string): string[] =>
  list.includes(item) ? list.filter((each) => each !== item) : [...list, item];

export function pathologyReportReducer(form: PathologyReportForm, action: PathologyReportAction): PathologyReportForm {
  switch (action.type) {
    case 'set':
      return { ...form, [action.field]: action.value };
    case 'open': {
      const { specimen } = action;
      return {
        ...form,
        grossDescription: specimen.grossDescription || '',
        blocks: specimen.blocks || [],
        slides: specimen.slides || [],
        specialStains: specimen.specialStains || [],
        ihcMarkers: specimen.ihcMarkers || [],
        microscopicDescription: specimen.microscopicDescription || '',
        diagnosis: specimen.diagnosis || '',
        snomedCode: specimen.snomedCode || '',
        isCritical: specimen.isCritical || false,
        communicatedTo: specimen.communicatedTo || '',
      };
    }
    case 'addBlock': {
      const label = form.newBlock.trim();
      return label ? { ...form, blocks: [...form.blocks, label], newBlock: '' } : form;
    }
    case 'addSlide': {
      const label = form.newSlide.trim();
      return label ? { ...form, slides: [...form.slides, label], newSlide: '' } : form;
    }
    case 'toggleStain':
      return { ...form, specialStains: toggled(form.specialStains, action.stain) };
    case 'toggleMarker':
      return { ...form, ihcMarkers: toggled(form.ihcMarkers, action.marker) };
  }
}

/**
 * Why a report cannot be finalised yet, or `null` when it can. A final report
 * needs a diagnosis and a microscopic description, and a critical one must say
 * who was told.
 */
export function finalizeBlocker(form: PathologyReportForm): 'missingFields' | 'criticalNotCommunicated' | null {
  if (!form.diagnosis || !form.microscopicDescription) return 'missingFields';
  if (form.isCritical && !form.communicatedTo) return 'criticalNotCommunicated';
  return null;
}

/** The report as saved: preliminary, or final when it is being signed out. */
export function toPathologyReportUpdate(
  form: PathologyReportForm,
  finalize: boolean,
): Parameters<typeof updatePathologyReport>[1] {
  return {
    gross_description: form.grossDescription,
    microscopic_description: form.microscopicDescription,
    diagnosis: form.diagnosis,
    blocks: form.blocks,
    slides: form.slides,
    special_stains: form.specialStains,
    ihc_markers: form.ihcMarkers,
    snomed_code: form.snomedCode,
    is_critical: form.isCritical,
    communicated_to: form.communicatedTo,
    status: finalize ? 'final' : 'prelim',
  };
}
